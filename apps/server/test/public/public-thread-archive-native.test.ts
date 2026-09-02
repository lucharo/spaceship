import { archiveThread, findThreadByNativeIdentity, getThread } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public native thread archive", () => {
  it("archives an unprojected provider session without adopting it or resolving a cwd", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-archive",
      });
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-unprojected",
      };

      const responsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        },
      );
      const archive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          (command as { type: string }).type ===
            "provider.native_sessions.archive" &&
          "providerThreadId" in command &&
          command.providerThreadId === identity.providerThreadId,
      );

      expect(archive.command).toEqual({
        type: "provider.native_sessions.archive",
        providerId: "codex",
        providerThreadId: "native-thread-unprojected",
        bridgeLaunch: expect.any(Object),
      });
      await reportQueuedCommandSuccess(harness, archive as never, {} as never);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(findThreadByNativeIdentity(harness.db, identity)).toBeNull();
      expect(listQueuedCommands(harness, "project.inspect")).toEqual([]);
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);
    });
  });

  it("archives the provider once before reconciling an existing projection", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-projected" },
      });
      const providerThreadId = "native-thread-projected";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

      const responsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId,
          }),
        },
      );
      const archive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();

      await reportQueuedCommandSuccess(harness, archive as never, {} as never);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.archive"),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    });
  });

  it("preflights every local projection before archiving the provider", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, environment, thread } = seedThreadFixture(
        harness,
        {
          session: { id: "host-native-archive-preflight" },
        },
      );
      const providerThreadId = "native-thread-preflight";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      const child = seedThread(harness.deps, {
        environmentId: null,
        parentThreadId: thread.id,
        projectId: project.id,
        status: "starting",
      });

      const response = await harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId,
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(getThread(harness.db, child.id)?.archivedAt).toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.archive"),
      ).toEqual([]);
    });
  });

  it("does not archive an active provider session twice after stop settles", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-active" },
        thread: { status: "active" },
      });
      const providerThreadId = "native-thread-active";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

      const responsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId,
          }),
        },
      );
      const archive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, archive as never, {} as never);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.archive"),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    });
  });

  it("still archives the provider when the local projection is already archived", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-already-local" },
      });
      const providerThreadId = "native-thread-already-local";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      archiveThread(harness.db, harness.deps.hub, thread.id);

      const responsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId,
          }),
        },
      );
      const archive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, archive as never, {} as never);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.archive"),
      ).toHaveLength(1);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    });
  });
});
