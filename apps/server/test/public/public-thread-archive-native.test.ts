import {
  archiveThread,
  findThreadByNativeIdentity,
  getThread,
  hasNativeSessionArchiveConfirmation,
  unarchiveThread,
} from "@bb/db";
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
      ).toEqual([]);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    });
  });

  it("preflights hidden forks before archiving the provider or source thread", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, environment, thread } = seedThreadFixture(
        harness,
        {
          session: { id: "host-native-archive-hidden-preflight" },
        },
      );
      const providerThreadId = "native-thread-hidden-preflight";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      const hiddenFork = seedThread(harness.deps, {
        environmentId: null,
        originKind: "fork",
        originPluginId: "side-chat",
        projectId: project.id,
        sourceThreadId: thread.id,
        status: "starting",
        visibility: "hidden",
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
      expect(getThread(harness.db, hiddenFork.id)?.archivedAt).toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.archive"),
      ).toEqual([]);
    });
  });

  it("serializes a concurrent unarchive behind the provider archive", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-concurrent-unarchive" },
      });
      const providerThreadId = "native-thread-concurrent-unarchive";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      archiveThread(harness.db, harness.deps.hub, thread.id);

      const archiveResponsePromise = harness.app.request(
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
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );

      let unarchiveSettled = false;
      const unarchiveResponsePromise = Promise.resolve(
        harness.app.request(`/api/v1/threads/${thread.id}/unarchive`, {
          method: "POST",
        }),
      ).then((response) => {
        unarchiveSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unarchiveSettled).toBe(false);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);
      expect((await unarchiveResponsePromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId,
          threadId: thread.id,
        }),
      ).toBe(false);
      const providerUnarchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.unarchive" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        providerUnarchive as never,
        {} as never,
      );
    });
  });

  it("releases assigned child threads instead of archiving their separate sessions", async () => {
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
        environmentId: environment.id,
        parentThreadId: thread.id,
        projectId: project.id,
        status: "idle",
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
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(getThread(harness.db, child.id)).toMatchObject({
        archivedAt: null,
        parentThreadId: null,
      });
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
      ).toEqual([]);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId,
          threadId: thread.id,
        }),
      ).toBe(true);
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
      ).toEqual([]);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId,
          threadId: thread.id,
        }),
      ).toBe(true);

      unarchiveThread(harness.db, harness.deps.hub, thread.id);
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId,
          threadId: thread.id,
        }),
      ).toBe(false);
    });
  });
});
