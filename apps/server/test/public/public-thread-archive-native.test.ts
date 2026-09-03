import {
  archiveThread,
  confirmNativeSessionArchive,
  findThreadByNativeIdentity,
  getEnvironment,
  getThread,
  hasNativeSessionArchiveConfirmation,
  unarchiveThread,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  listQueuedThreadCommands,
  reportQueuedCommandError,
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

  it("serializes adoption behind provider archive for an unprojected session", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-archive-adopt-unprojected",
      });
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-archive-adopt-unprojected",
      };

      const archiveResponsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === identity.providerThreadId,
      );

      let adoptionSettled = false;
      const adoptionResponsePromise = Promise.resolve(
        harness.app.request("/api/v1/threads/adopt-native", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        }),
      ).then((response) => {
        adoptionSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(adoptionSettled).toBe(false);
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);

      const providerRead = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.read" &&
          command.providerThreadId === identity.providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, providerRead, {
        providerThreadId: identity.providerThreadId,
        title: "Archived native session",
        cwd: "/tmp/native-archive-adopt-unprojected",
        projectId: null,
        workspaceRoot: "/tmp/native-archive-adopt-unprojected",
        status: "idle",
        createdAt: 1_777_000_000,
        updatedAt: 1_777_000_100,
        archived: true,
        source: "cli",
      });

      expect((await adoptionResponsePromise).status).toBe(409);
      expect(findThreadByNativeIdentity(harness.db, identity)).toBeNull();
      expect(listQueuedCommands(harness, "project.inspect")).toEqual([]);
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

  it("starts managed-environment cleanup after native archive reconciliation", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-cleanup" },
        environment: {
          managed: true,
          workspaceProvisionType: "managed-worktree",
        },
      });
      const providerThreadId = "native-thread-cleanup";
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
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );

      expect((await responsePromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "retiring",
      );
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

  it("serializes general source-derived creation behind native archive", async () => {
    await withTestHarness(async (harness) => {
      const { host, project, environment, thread } = seedThreadFixture(
        harness,
        {
          session: { id: "host-native-archive-source-create" },
        },
      );
      const providerThreadId = "native-thread-source-create";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

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

      let creationSettled = false;
      const creationResponsePromise = Promise.resolve(
        harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            input: [],
            visibility: "hidden",
            originKind: "fork",
            parentThreadId: thread.id,
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        }),
      ).then((response) => {
        creationSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(creationSettled).toBe(false);

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);

      expect((await creationResponsePromise).status).toBe(400);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });

  it("serializes ordinary archive and native adoption for the same projection", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-local-archive-adopt" },
      });
      const providerThreadId = "native-thread-local-archive-adopt";
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      };
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

      const archiveResponsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" &&
          command.threadId === thread.id &&
          command.providerThreadId === providerThreadId,
      );

      let adoptionSettled = false;
      const adoptionResponsePromise = Promise.resolve(
        harness.app.request("/api/v1/threads/adopt-native", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        }),
      ).then((response) => {
        adoptionSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(adoptionSettled).toBe(false);
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);

      const providerRead = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.read" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, providerRead, {
        providerThreadId,
        title: "Locally archived native session",
        cwd: environment.path,
        projectId: null,
        workspaceRoot: environment.path,
        status: "idle",
        createdAt: 1_777_000_000,
        updatedAt: 1_777_000_100,
        archived: true,
        source: "cli",
      });

      expect((await adoptionResponsePromise).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });

  it("re-sends an explicit provider archive for an already archived projection", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-local-rearchive" },
      });
      const providerThreadId = "native-thread-local-rearchive";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      archiveThread(harness.db, harness.deps.hub, thread.id);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );

      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );

      expect((await responsePromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });

  it("keeps the projection active when the projected provider archive fails", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-local-archive-failure" },
      });
      const providerThreadId = "native-thread-local-archive-failure";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      await reportQueuedCommandError(harness, providerArchive, {
        errorCode: "provider_archive_failed",
        errorMessage: "Provider rejected archive",
      });

      expect((await responsePromise).status).toBe(502);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    });
  });

  it("reconciles each successful archive-all provider mutation before continuing", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: parent,
      } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-all-partial-failure" },
      });
      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: parent.id,
        projectId: project.id,
        status: "idle",
      });
      const childProviderThreadId = "native-thread-archive-all-child";
      const parentProviderThreadId = "native-thread-archive-all-parent";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: childProviderThreadId,
        threadId: child.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: parentProviderThreadId,
        threadId: parent.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${parent.id}/archive-all`,
        { method: "POST" },
      );
      const childArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === child.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        childArchive as never,
        {} as never,
      );

      const parentArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === parent.id,
      );
      expect(getThread(harness.db, child.id)?.archivedAt).not.toBeNull();
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId: childProviderThreadId,
          threadId: child.id,
        }),
      ).toBe(true);
      await reportQueuedCommandError(harness, parentArchive, {
        errorCode: "provider_archive_failed",
        errorMessage: "Provider rejected parent archive",
      });

      expect((await responsePromise).status).toBe(502);
      expect(getThread(harness.db, parent.id)?.archivedAt).toBeNull();
      expect(getThread(harness.db, child.id)?.archivedAt).not.toBeNull();
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId: parentProviderThreadId,
          threadId: parent.id,
        }),
      ).toBe(false);
    });
  });

  it("serializes archive-all and native adoption for the same projection", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-all-adopt" },
      });
      const providerThreadId = "native-thread-archive-all-adopt";
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      };
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });

      const archiveResponsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        { method: "POST" },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      let adoptionSettled = false;
      const adoptionResponsePromise = Promise.resolve(
        harness.app.request("/api/v1/threads/adopt-native", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        }),
      ).then((response) => {
        adoptionSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(adoptionSettled).toBe(false);
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);

      const providerRead = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.read" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, providerRead, {
        providerThreadId,
        title: "Archive-all native session",
        cwd: environment.path,
        projectId: null,
        workspaceRoot: environment.path,
        status: "idle",
        createdAt: 1_777_000_000,
        updatedAt: 1_777_000_100,
        archived: true,
        source: "cli",
      });
      expect((await adoptionResponsePromise).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
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
      const providerUnarchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.unarchive" && command.threadId === thread.id,
      );
      expect(unarchiveSettled).toBe(false);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      await reportQueuedCommandSuccess(
        harness,
        providerUnarchive as never,
        {} as never,
      );
      expect((await unarchiveResponsePromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(
        hasNativeSessionArchiveConfirmation(harness.db, {
          providerThreadId,
          threadId: thread.id,
        }),
      ).toBe(false);
    });
  });

  it("keeps the local projection archived when provider unarchive fails", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-unarchive-failure" },
      });
      const providerThreadId = "native-thread-unarchive-failure";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      archiveThread(harness.db, harness.deps.hub, thread.id);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      const providerUnarchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.unarchive" && command.threadId === thread.id,
      );
      await reportQueuedCommandError(harness, providerUnarchive, {
        errorCode: "provider_unarchive_failed",
        errorMessage: "Provider rejected unarchive",
      });

      expect((await responsePromise).status).toBe(502);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
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

  it("retries explicit provider archive after a stale local confirmation", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-stale-confirmation" },
      });
      const providerThreadId = "native-thread-stale-confirmation";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId,
        threadId: thread.id,
      });
      confirmNativeSessionArchive(harness.db, {
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
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );

      expect((await responsePromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
    });
  });

  it("keeps an archived projection archived when adoption races provider archive", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: { id: "host-native-archive-adopt-projected" },
      });
      const providerThreadId = "native-thread-archive-adopt-projected";
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      };
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
          body: JSON.stringify(identity),
        },
      );
      const providerArchive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.archive" &&
          command.providerThreadId === providerThreadId,
      );

      let adoptionSettled = false;
      const adoptionResponsePromise = Promise.resolve(
        harness.app.request("/api/v1/threads/adopt-native", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        }),
      ).then((response) => {
        adoptionSettled = true;
        return response;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(adoptionSettled).toBe(false);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);

      await reportQueuedCommandSuccess(
        harness,
        providerArchive as never,
        {} as never,
      );
      expect((await archiveResponsePromise).status).toBe(200);

      const providerRead = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.read" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(harness, providerRead, {
        providerThreadId,
        title: "Archived projected session",
        cwd: environment.path,
        projectId: null,
        workspaceRoot: environment.path,
        status: "idle",
        createdAt: 1_777_000_000,
        updatedAt: 1_777_000_100,
        archived: true,
        source: "cli",
      });

      expect((await adoptionResponsePromise).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(findThreadByNativeIdentity(harness.db, identity)?.id).toBe(
        thread.id,
      );
    });
  });
});
