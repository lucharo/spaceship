import { getThreadExecutionOverride, setThreadExecutionOverride } from "@bb/db";
import { describe, expect, it } from "vitest";
import { recoverThreadModelOverride } from "../../../src/services/threads/thread-execution-override.js";
import { resolveExecutionOptions } from "../../../src/services/threads/thread-runtime-config.js";
import { availableModelFixture } from "../../helpers/available-models.js";
import {
  registerHostRpcResponder,
  registerProviderHostRpcResponder,
  type HostRpcHandlerResult,
} from "../../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("stale model recovery", () => {
  it("replaces an unavailable sticky override from an explicit available follow-up", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stale-model-recovery",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stale-model-recovery",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stale-model-recovery",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: "high",
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [
              availableModelFixture({
                model: "claude-opus-4-8[1m]",
                reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });

      await recoverThreadModelOverride(harness.deps, {
        model: "claude-opus-4-8[1m]",
        modelSource: "explicit",
        thread,
      });

      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-opus-4-8[1m]",
        reasoningLevelOverride: "high",
      });
      await expect(
        resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: { source: "client/turn/requested" },
        }),
      ).resolves.toMatchObject({ model: "claude-opus-4-8[1m]" });
    });
  });

  it("distinguishes temporary discovery failure from a missing replacement", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stale-model-errors",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stale-model-errors",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stale-model-errors",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-mythos-5",
      });
      const temporaryFailure = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "provider_rpc_error",
            errorMessage: "temporary discovery failure",
          },
        },
      });
      const recovery = {
        model: "claude-opus-4-8[1m]",
        modelSource: "explicit" as const,
        thread,
      };

      await expect(
        recoverThreadModelOverride(harness.deps, recovery),
      ).rejects.toMatchObject({
        status: 503,
        body: { code: "model_catalog_unavailable" },
      });
      temporaryFailure.unregister();
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          "claude-code": {
            models: [availableModelFixture({ model: "claude-sonnet-5" })],
            selectedOnlyModels: [],
          },
        },
      });

      await expect(
        recoverThreadModelOverride(harness.deps, recovery),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_request" },
      });
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-mythos-5",
        reasoningLevelOverride: null,
      });
    });
  });

  it("rechecks the override after a concurrent patch before recovering it", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-stale-model-concurrent-patch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stale-model-concurrent-patch",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stale-model-concurrent-patch",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "claude-code",
        status: "idle",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-opus-4-8[1m]",
        reasoningLevelOverride: "high",
      });

      let markCatalogRequested!: () => void;
      const catalogRequested = new Promise<void>((resolve) => {
        markCatalogRequested = resolve;
      });
      let releaseCatalog!: () => void;
      const catalogResult = new Promise<HostRpcHandlerResult>((resolve) => {
        releaseCatalog = () =>
          resolve({
            ok: true,
            result: {
              models: [
                availableModelFixture({
                  model: "claude-mythos-5",
                  reasoningLevels: ["high"],
                }),
                availableModelFixture({
                  model: "claude-opus-4-8[1m]",
                  reasoningLevels: ["high"],
                }),
              ],
              selectedOnlyModels: [],
            },
          });
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "provider.list_models") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          markCatalogRequested();
          return catalogResult;
        },
      });

      const patchResponsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-mythos-5" }),
        },
      );
      await catalogRequested;

      let recoverySettled = false;
      const recoveryPromise = recoverThreadModelOverride(harness.deps, {
        model: "claude-opus-4-8[1m]",
        modelSource: "explicit",
        thread,
      }).then(() => {
        recoverySettled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const settledBeforePatch = recoverySettled;

      releaseCatalog();
      expect((await patchResponsePromise).status).toBe(200);
      await recoveryPromise;

      expect(settledBeforePatch).toBe(false);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-opus-4-8[1m]",
        reasoningLevelOverride: "high",
      });
    });
  });
});
