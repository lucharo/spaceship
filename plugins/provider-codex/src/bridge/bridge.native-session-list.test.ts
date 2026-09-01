import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createBridgeRecorder,
  setBridgeRecorderForTesting,
  type BridgeRecorder,
} from "@bb/provider-bridge-protocol/bridge-kit";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let recorder: BridgeRecorder;
let recordingDir: string;
let codexHomeDir: string;

beforeEach(() => {
  recordingDir = mkdtempSync(join(tmpdir(), "spaceship-native-catalogue-"));
  codexHomeDir = mkdtempSync(join(tmpdir(), "spaceship-codex-home-"));
  writeFileSync(
    join(codexHomeDir, ".codex-global-state.json"),
    JSON.stringify({
      "thread-workspace-root-hints": {
        "codex-native-1": "/workspace-root",
        "codex-archived-1": "/archived-workspace-root",
      },
    }),
  );
  recorder = createBridgeRecorder({ dir: recordingDir });
  setBridgeRecorderForTesting(recorder);
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv("CODEX_HOME", codexHomeDir);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(() => {
  experimental_killAllChildrenForTests();
  harness.restore();
  recorder.close();
  setBridgeRecorderForTesting(null);
  rmSync(recordingDir, { recursive: true, force: true });
  rmSync(codexHomeDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("lists Codex sessions as metadata without leaking previews, paths, or turns", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await expect(harness.waitForResponse(1)).resolves.toMatchObject({
    result: {
      capabilities: {
        nativeSessions: { list: true, read: true, history: true },
      },
    },
  });

  harness.sendRequest(2, "native/session/list", {
    archived: true,
    cursor: "cursor-1",
    limit: 25,
    cwd: "/workspace",
    searchTerm: "release",
  });

  await expect(harness.waitForResponse(2)).resolves.toEqual({
    jsonrpc: "2.0",
    id: 2,
    result: {
      sessions: [
        {
          providerThreadId: "codex-native-1",
          title: "Release checklist",
          cwd: "/workspace",
          projectId: "project-spaceship",
          workspaceRoot: "/workspace-root",
          repositoryUrl: null,
          status: "active",
          createdAt: 1_777_000_000,
          updatedAt: 1_777_000_100,
          archived: true,
          source: "cli",
        },
      ],
      nextCursor: "cursor-2",
      backwardsCursor: "cursor-0",
    },
  });
  expect(readdirSync(recordingDir)).toEqual([]);
});

it("reads authoritative active-session metadata without returning transcript fields", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await harness.waitForResponse(1);

  harness.sendRequest(2, "native/session/read", {
    providerThreadId: "codex-native-1",
  });

  await expect(harness.waitForResponse(2)).resolves.toEqual({
    jsonrpc: "2.0",
    id: 2,
    result: {
      providerThreadId: "codex-native-1",
      title: "Release checklist",
      cwd: "/workspace",
      projectId: "project-spaceship",
      workspaceRoot: "/workspace-root",
      repositoryUrl: null,
      status: "active",
      createdAt: 1_777_000_000,
      updatedAt: 1_777_000_100,
      archived: false,
      source: "cli",
    },
  });
  expect(readdirSync(recordingDir)).toEqual([]);
});

it("reads native history only when explicitly requested", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await harness.waitForResponse(1);

  harness.sendRequest(2, "native/session/history", {
    providerThreadId: "codex-native-1",
  });

  const response = await harness.waitForResponse(2);
  expect(response).toMatchObject({
    result: {
      session: {
        providerThreadId: "codex-native-1",
        archived: false,
      },
      turns: [
        {
          providerTurnId: "private-turn",
          deltas: [
            { kind: "turn.open", providerTurnId: "private-turn" },
            { kind: "input.provider", providerTurnId: "private-turn" },
            { kind: "item.close", providerTurnId: "private-turn" },
            {
              kind: "turn.boundary",
              providerTurnId: "private-turn",
              status: "completed",
            },
          ],
        },
      ],
    },
  });
  expect(JSON.stringify(response)).not.toContain("private preview");
  expect(JSON.stringify(response)).not.toContain("/private/rollout.jsonl");
  expect(readdirSync(recordingDir)).toEqual([]);
});

it("reports archived state from the native Codex catalogue", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await harness.waitForResponse(1);

  harness.sendRequest(2, "native/session/read", {
    providerThreadId: "codex-archived-1",
  });

  await expect(harness.waitForResponse(2)).resolves.toMatchObject({
    result: {
      providerThreadId: "codex-archived-1",
      archived: true,
    },
  });
  expect(readdirSync(recordingDir)).toEqual([]);
});

it("does not expose app-server error details while reading native metadata", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await harness.waitForResponse(1);

  harness.sendRequest(2, "native/session/read", {
    providerThreadId: "codex-sensitive-error",
  });

  const response = await harness.waitForResponse(2);
  expect(response).toMatchObject({
    error: { message: "Could not read native Codex session metadata" },
  });
  expect(JSON.stringify(response)).not.toContain("private preview");
  expect(JSON.stringify(response)).not.toContain("/Users/example");
  expect(readdirSync(recordingDir)).toEqual([]);
});

it("keeps missing Codex installation guidance actionable", async () => {
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", "/definitely/missing/codex");
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_ARGS", "[]");

  harness.sendRequest(1, "native/session/read", {
    providerThreadId: "codex-native-1",
  });

  await expect(harness.waitForResponse(1)).resolves.toMatchObject({
    error: { message: expect.stringContaining("Install Codex") },
  });
});
