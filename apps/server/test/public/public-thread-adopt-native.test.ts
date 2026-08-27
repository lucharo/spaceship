import { getLastStoredProviderThreadId } from "@bb/db";
import { adoptNativeThreadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
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
) {
  const responsePromise = harness.app.request("/api/v1/threads/adopt-native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const inspection = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "project.inspect" && command.path === body.cwd,
  );
  await reportQueuedCommandSuccess(harness, inspection, {
    path: String(body.cwd),
    gitRemoteUrl: null,
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
        cwd: "/tmp/native-adoption",
        providerId: "codex",
        providerThreadId: "native-thread-1",
        title: "Recovered session",
      };

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
      expect(getLastStoredProviderThreadId(harness.db, first.thread.id)).toBe(
        "native-thread-1",
      );

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
            cwd: "/tmp/native-missing-provider",
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
