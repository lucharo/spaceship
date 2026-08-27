import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;

beforeEach(() => {
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(() => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
});

it("lists Codex sessions as metadata without leaking previews, paths, or turns", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: 2,
    client: { name: "test", version: "1" },
    grammarVersions: [3, 3],
  });
  await expect(harness.waitForResponse(1)).resolves.toMatchObject({
    result: { capabilities: { nativeSessions: { list: true } } },
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
});
