import { getEnvironment, getLastStoredProviderThreadId } from "@bb/db";
import { adoptNativeThreadResponseSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function postAdoptNativeThread(
  harness: TestAppHarness,
  body: Record<string, unknown>,
  nativeSession: {
    providerThreadId: string;
    title: string | null;
    cwd: string | null;
    archived?: boolean;
  } = {
    providerThreadId: String(body.providerThreadId),
    title: "Recovered session",
    cwd: "/tmp/native-adoption",
  },
) {
  const responsePromise = harness.app.request("/api/v1/threads/adopt-native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const read = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "provider.native_sessions.read" &&
      command.providerThreadId === body.providerThreadId,
  );
  await reportQueuedCommandSuccess(harness, read, {
    providerThreadId: nativeSession.providerThreadId,
    title: nativeSession.title,
    cwd: nativeSession.cwd,
    createdAt: 1_777_000_000,
    updatedAt: 1_777_000_100,
    archived: nativeSession.archived ?? false,
    source: "cli",
  });
  if (nativeSession.archived || nativeSession.cwd === null) {
    return responsePromise;
  }
  const inspection = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "project.inspect" && command.path === nativeSession.cwd,
  );
  await reportQueuedCommandSuccess(harness, inspection, {
    path: nativeSession.cwd,
    gitRemoteUrl: null,
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    defaultBranch: "main",
  });
  return responsePromise;
}

describe("public native thread adoption", () => {
  it("links one local thread to a native provider session idempotently", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-adoption",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-1",
      };
      const emitThreadCreated = vi.spyOn(
        harness.pluginService.events,
        "emitThreadCreated",
      );
      let providerIdentityAtPluginNotification: string | null = null;
      emitThreadCreated.mockImplementation((thread) => {
        providerIdentityAtPluginNotification = getLastStoredProviderThreadId(
          harness.db,
          thread.id,
        );
      });

      const firstResponse = await postAdoptNativeThread(harness, request);
      expect(firstResponse.status).toBe(200);
      const first = adoptNativeThreadResponseSchema.parse(
        await readJson(firstResponse),
      );

      const secondResponse = await harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      expect(secondResponse.status).toBe(200);
      const second = adoptNativeThreadResponseSchema.parse(
        await readJson(secondResponse),
      );

      expect(first.created).toBe(true);
      expect(first.thread).toMatchObject({
        environmentId: expect.any(String),
        providerId: "codex",
        status: "idle",
        title: "Recovered session",
      });
      expect(second).toEqual({ created: false, thread: first.thread });
      expect(emitThreadCreated).toHaveBeenCalledTimes(1);
      expect(emitThreadCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: first.thread.id }),
      );
      expect(providerIdentityAtPluginNotification).toBe("native-thread-1");
      expect(getLastStoredProviderThreadId(harness.db, first.thread.id)).toBe(
        "native-thread-1",
      );
      expect(
        getEnvironment(harness.db, first.thread.environmentId as string),
      ).toMatchObject({
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        defaultBranch: "main",
      });

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${first.thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "auto",
            input: [{ type: "text", text: "Continue natively" }],
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          }),
        },
      );
      expect(sendResponse.status).toBe(200);
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === first.thread.id,
      );
      expect(queued.command).toMatchObject({
        resumeContext: {
          providerId: "codex",
          providerThreadId: "native-thread-1",
        },
      });
    });
  });

  it("rejects archived native sessions without creating a local projection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-archived",
      });
      const response = await postAdoptNativeThread(
        harness,
        {
          hostId: host.id,
          providerId: "codex",
          providerThreadId: "native-thread-archived",
        },
        {
          providerThreadId: "native-thread-archived",
          title: "Archived session",
          cwd: "/tmp/native-archived",
          archived: true,
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "native_session_archived",
      });
    });
  });

  it("rejects a provider with no runnable bridge", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-missing-provider",
      });
      const response = await harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "missing-provider",
            providerThreadId: "native-thread-1",
          }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "provider_bridge_unavailable",
      });
    });
  });
});
