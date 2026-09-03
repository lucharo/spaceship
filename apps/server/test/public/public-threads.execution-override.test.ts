import { describe, expect, it } from "vitest";
import { getThreadExecutionOverride, markThreadDeleted } from "@bb/db";
import {
  registerHostRpcResponder,
  registerProviderHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

function stubProviderCatalog(
  harness: TestAppHarness,
  hostId: string,
  sessionId: string,
  providerId: string,
  model: string,
): void {
  registerProviderHostRpcResponder(harness, {
    hostId,
    sessionId,
    modelsByProviderId: {
      [providerId]: {
        models: [
          {
            id: model,
            model,
            displayName: model,
            description: "",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "" },
              { reasoningEffort: "medium", description: "" },
              { reasoningEffort: "high", description: "" },
              { reasoningEffort: "xhigh", description: "" },
              { reasoningEffort: "max", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
        selectedOnlyModels: [],
      },
    },
  });
}

function seedProviderThread(
  harness: TestAppHarness,
  providerId = "claude-code",
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-override-${providerId}`,
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
  });
  return { host, session, thread };
}

function patchThread(harness: TestAppHarness, threadId: string, body: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /threads/:id execution override", () => {
  for (const provider of [
    { id: "codex", model: "gpt-5.6-sol" },
    { id: "claude-code", model: "claude-opus-4-8" },
    { id: "pi", model: "openai/gpt-5.4" },
    { id: "acp-cursor", model: "gpt-5.3-codex" },
  ]) {
    it(`persists a catalog-scoped model + reasoning override for ${provider.id}`, async () => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedProviderThread(
          harness,
          provider.id,
        );
        stubProviderCatalog(
          harness,
          host.id,
          session.id,
          provider.id,
          provider.model,
        );

        const response = await patchThread(harness, thread.id, {
          model: provider.model,
          reasoningLevel: "high",
        });

        expect(response.status).toBe(200);
        expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
          modelOverride: provider.model,
          reasoningLevelOverride: "high",
        });
      });
    });
  }

  it("rejects a model that is not in the provider's catalog", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedProviderThread(harness);
      stubProviderCatalog(
        harness,
        host.id,
        session.id,
        "claude-code",
        "claude-opus-4-8",
      );

      const response = await patchThread(harness, thread.id, {
        model: "gpt-5",
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain(
        "not available in this thread's claude-code model catalog",
      );
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    });
  });

  it("does not persist an execution override when another patch field is invalid", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedProviderThread(harness);
      stubProviderCatalog(
        harness,
        host.id,
        session.id,
        "claude-code",
        "claude-opus-4-8",
      );

      const response = await patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
        sectionId: "missing-section",
      });

      expect(response.status).toBe(404);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    });
  });

  it("rejects a thread deleted during model discovery without persisting its override", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedProviderThread(harness);
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
                {
                  id: "claude-opus-4-8",
                  model: "claude-opus-4-8",
                  displayName: "claude-opus-4-8",
                  description: "",
                  supportedReasoningEfforts: [
                    { reasoningEffort: "high", description: "" },
                  ],
                  defaultReasoningEffort: "high",
                  isDefault: true,
                },
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

      const responsePromise = patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
      });
      await catalogRequested;
      markThreadDeleted(harness.db, harness.hub, { threadId: thread.id });
      releaseCatalog();

      expect((await responsePromise).status).toBe(404);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: null,
        reasoningLevelOverride: null,
      });
    });
  });

  it("serializes concurrent partial execution override patches", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedProviderThread(harness);
      const releases: Array<() => void> = [];
      let requestCount = 0;
      let markSecondCatalogRequested!: () => void;
      const secondCatalogRequested = new Promise<void>((resolve) => {
        markSecondCatalogRequested = resolve;
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "provider.list_models") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          requestCount += 1;
          if (requestCount === 2) markSecondCatalogRequested();
          return new Promise<HostRpcHandlerResult>((resolve) => {
            releases.push(() =>
              resolve({
                ok: true,
                result: {
                  models: [
                    {
                      id: "claude-opus-4-8",
                      model: "claude-opus-4-8",
                      displayName: "claude-opus-4-8",
                      description: "",
                      supportedReasoningEfforts: [
                        { reasoningEffort: "high", description: "" },
                      ],
                      defaultReasoningEffort: "high",
                      isDefault: true,
                    },
                  ],
                  selectedOnlyModels: [],
                },
              }),
            );
          });
        },
      });

      const modelResponse = patchThread(harness, thread.id, {
        model: "claude-opus-4-8",
      });
      while (releases.length < 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const providerRegistration = harness.deps.providerRegistry.get(
        thread.providerId,
      );
      if (providerRegistration === null) {
        throw new Error(`Missing provider registration ${thread.providerId}`);
      }
      const registrationRevision = harness.deps.providerRegistry.register({
        ...providerRegistration,
        pluginId: "test-provider-revision",
        info: {
          ...providerRegistration.info,
          id: "test-provider-revision",
          displayName: "Test provider revision",
        },
      });
      const reasoningResponse = patchThread(harness, thread.id, {
        reasoningLevel: "high",
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requestCount).toBe(1);

      releases[0]?.();
      expect((await modelResponse).status).toBe(200);
      await secondCatalogRequested;
      releases[1]?.();
      expect((await reasoningResponse).status).toBe(200);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: "claude-opus-4-8",
        reasoningLevelOverride: "high",
      });
      registrationRevision.dispose();
    });
  });
});
