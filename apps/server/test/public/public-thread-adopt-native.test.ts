import { eq } from "drizzle-orm";
import {
  archiveThread,
  environments,
  getEnvironment,
  getLastStoredProviderThreadId,
  getLatestThreadSequence,
  getThread,
  listEnvironments,
  listPublicProjects,
} from "@bb/db";
import {
  applyEnvironmentLifecycleEvent,
  requireEnvironmentLifecycleEventApplied,
} from "@bb/db/internal-environment-lifecycle";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  adoptNativeThreadResponseSchema,
  threadConversationOutlineResponseSchema,
  threadTimelineResponseSchema,
  type TimelineRow,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
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
    projectId: null,
    workspaceRoot: nativeSession.cwd,
    status: "idle",
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
  it("serves summary-only state without reading the native transcript", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-summary",
      });
      const providerThreadId = "native-thread-summary";
      const adoptionResponse = await postAdoptNativeThread(harness, {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      });
      expect(adoptionResponse.status).toBe(200);
      const adopted = adoptNativeThreadResponseSchema.parse(
        await readJson(adoptionResponse),
      );
      let sequence = getLatestThreadSequence(harness.db, {
        threadId: adopted.thread.id,
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "turn/started",
        scope: turnScope("native-turn-summary"),
        data: { providerThreadId },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "item/completed",
        scope: turnScope("native-turn-summary"),
        data: {
          providerThreadId,
          item: {
            type: "planSteps",
            id: "native-plan-summary",
            steps: [{ step: "Finish the native handoff", status: "active" }],
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "item/started",
        scope: turnScope("native-turn-summary"),
        data: {
          providerThreadId,
          item: {
            id: "native-workflow-summary",
            type: "backgroundTask",
            taskType: "local_workflow",
            description: "Verify native summary state",
            status: "pending",
            taskStatus: "running",
            skipTranscript: false,
            workflowName: "native-summary",
            usage: { totalTokens: 20, toolUses: 1, durationMs: 100 },
          },
        },
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.started" },
        threadId: adopted.thread.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/timeline?summaryOnly=true`,
      );

      expect(response.status).toBe(200);
      expect(
        threadTimelineResponseSchema.parse(await readJson(response)),
      ).toMatchObject({
        rows: [],
        maxSeq: expect.any(Number),
        pendingTodos: {
          items: [{ text: "Finish the native handoff", status: "in_progress" }],
        },
        activeWorkflows: [
          {
            description: "Verify native summary state",
            status: "pending",
            taskStatus: "running",
          },
        ],
      });
      expect(
        listQueuedCommands(harness, "provider.native_sessions.history"),
      ).toEqual([]);
    });
  });

  it("projects native provider history on demand without copying it into bb storage", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-history",
      });
      const providerThreadId = "native-thread-history";
      const adoptionResponse = await postAdoptNativeThread(
        harness,
        {
          hostId: host.id,
          providerId: "codex",
          providerThreadId,
        },
        {
          providerThreadId,
          title: "Recovered session",
          cwd: "/tmp/native-adoption-worktree",
        },
      );
      expect(adoptionResponse.status).toBe(200);
      const adopted = adoptNativeThreadResponseSchema.parse(
        await readJson(adoptionResponse),
      );

      const nativeHistory = {
        session: {
          providerThreadId,
          title: "Recovered session",
          cwd: "/tmp/native-adoption-worktree",
          projectId: null,
          workspaceRoot: "/tmp/native-adoption-origin",
          status: "idle",
          createdAt: 1_777_000_000,
          updatedAt: 1_777_000_100,
          archived: false,
          source: "cli",
        },
        events: [
          {
            createdAt: 1_777_000_010_000,
            event: {
              type: "turn/started",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-1"),
            },
          },
          {
            createdAt: 1_777_000_011_000,
            event: {
              type: "item/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-1"),
              item: {
                type: "userMessage",
                id: "native-user-1",
                content: [{ type: "text", text: "Synthetic question" }],
              },
            },
          },
          {
            createdAt: 1_777_000_012_000,
            event: {
              type: "item/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-1"),
              item: {
                type: "agentMessage",
                id: "native-agent-1",
                text: "Synthetic answer",
              },
            },
          },
          {
            createdAt: 1_777_000_013_000,
            event: {
              type: "turn/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-1"),
              status: "completed",
            },
          },
          {
            createdAt: 1_777_000_020_000,
            event: {
              type: "turn/started",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-2"),
            },
          },
          {
            createdAt: 1_777_000_021_000,
            event: {
              type: "item/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-2"),
              item: {
                type: "userMessage",
                id: "native-user-2",
                content: [{ type: "text", text: "Synthetic follow-up" }],
              },
            },
          },
          {
            createdAt: 1_777_000_022_000,
            event: {
              type: "item/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-2"),
              item: {
                type: "agentMessage",
                id: "native-agent-2",
                text: "Synthetic follow-up answer",
              },
            },
          },
          {
            createdAt: 1_777_000_023_000,
            event: {
              type: "item/completed",
              threadId: adopted.thread.id,
              providerThreadId,
              scope: turnScope("native-turn-2"),
              item: {
                type: "fileChange",
                id: "native-file-2",
                changes: [
                  {
                    path: "/tmp/native-adoption-worktree/src/native.ts",
                    kind: "update",
                    diff: "@@ -1 +1 @@\n-old\n+new",
                  },
                ],
                status: "completed",
                approvalStatus: null,
              },
            },
          },
        ],
      };

      const timelineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/timeline?segmentLimit=1`,
      );
      const history = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          (command as { type: string }).type ===
            "provider.native_sessions.history" &&
          "providerThreadId" in command &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(
        harness,
        history as never,
        nativeHistory as never,
      );

      const timelineResponse = await timelineResponsePromise;
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      expect(timeline.nativeHistoryProjection).toBe(true);
      expect([
        ...new Set(timeline.rows.map((row) => row.turnId).filter(Boolean)),
      ]).toEqual(["native-turn-2"]);
      expect(timeline.timelinePage).toMatchObject({
        returnedSegmentCount: 1,
        hasOlderRows: true,
      });
      expect(timeline.timelinePage.olderCursor).not.toBeNull();

      const olderCursor = timeline.timelinePage.olderCursor;
      if (olderCursor === null) throw new Error("Expected an older cursor");
      const olderTimelineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/timeline?segmentLimit=1&beforeAnchorSeq=${olderCursor.anchorSeq}&beforeAnchorId=${encodeURIComponent(olderCursor.anchorId)}`,
      );
      const olderHistory = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.history" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(
        harness,
        olderHistory as never,
        nativeHistory as never,
      );
      const olderTimelineResponse = await olderTimelineResponsePromise;
      expect(olderTimelineResponse.status).toBe(200);
      const olderTimeline = threadTimelineResponseSchema.parse(
        await readJson(olderTimelineResponse),
      );
      expect(
        olderTimeline.rows
          .filter((row) => row.kind === "turn")
          .map((row) => row.turnId),
      ).toEqual(["native-turn-1"]);
      expect(olderTimeline.timelinePage).toMatchObject({
        returnedSegmentCount: 1,
        hasOlderRows: false,
        olderCursor: null,
      });

      const environmentId = adopted.thread.environmentId;
      if (environmentId === null) {
        throw new Error("Expected adopted native thread environment");
      }
      harness.db
        .delete(environments)
        .where(eq(environments.id, environmentId))
        .run();
      expect(getThread(harness.db, adopted.thread.id)).toMatchObject({
        environmentId: null,
        nativeSessionHostId: host.id,
      });

      const outlineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/conversation-outline`,
      );
      const outlineHistory = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.history" &&
          command.providerThreadId === providerThreadId,
      );
      expect(outlineHistory.row.hostId).toBe(host.id);
      await reportQueuedCommandSuccess(
        harness,
        outlineHistory as never,
        nativeHistory as never,
      );
      const outlineResponse = await outlineResponsePromise;
      expect(outlineResponse.status).toBe(200);
      const outline = threadConversationOutlineResponseSchema.parse(
        await readJson(outlineResponse),
      );
      expect(outline.items.map((item) => item.preview)).toEqual([
        "Synthetic question",
        "Synthetic answer",
        "Synthetic follow-up",
        "Synthetic follow-up answer",
      ]);
      expect(outline.items.map((item) => item.sourceSeq)).toEqual([2, 3, 6, 7]);
      const outlineIds = new Set(outline.items.map((item) => item.id));
      const pagedConversationIds: string[] = [];
      const collectConversationIds = (rows: readonly TimelineRow[]): void => {
        for (const row of rows) {
          if (row.kind === "conversation") {
            pagedConversationIds.push(row.id);
          } else if (row.kind === "turn") {
            collectConversationIds(row.children ?? []);
          } else if (row.kind === "work" && row.workKind === "delegation") {
            collectConversationIds(row.childRows);
          }
        }
      };
      collectConversationIds([...timeline.rows, ...olderTimeline.rows]);
      expect(pagedConversationIds).toHaveLength(4);
      for (const id of pagedConversationIds) {
        expect(outlineIds.has(id)).toBe(true);
      }

      const refreshedNativeHistory = {
        ...nativeHistory,
        events: nativeHistory.events.map((entry) => {
          const item = entry.event.item;
          if (
            entry.event.type !== "item/completed" ||
            item?.type !== "agentMessage" ||
            item.id !== "native-agent-2"
          ) {
            return entry;
          }
          return {
            ...entry,
            event: {
              ...entry.event,
              item: {
                ...item,
                text: "Synthetic revised answer",
              },
            },
          };
        }),
      };
      const refreshedOutlineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/conversation-outline`,
      );
      const refreshedOutlineHistory = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.history" &&
          command.providerThreadId === providerThreadId,
      );
      await reportQueuedCommandSuccess(
        harness,
        refreshedOutlineHistory as never,
        refreshedNativeHistory as never,
      );
      const refreshedOutlineResponse = await refreshedOutlineResponsePromise;
      expect(refreshedOutlineResponse.status).toBe(200);
      expect(
        threadConversationOutlineResponseSchema
          .parse(await readJson(refreshedOutlineResponse))
          .items.map((item) => item.preview),
      ).toEqual([
        "Synthetic question",
        "Synthetic answer",
        "Synthetic follow-up",
        "Synthetic revised answer",
      ]);

      const prunedTimelineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/timeline?includeNestedRows=true&segmentLimit=1`,
      );
      const prunedTimelineHistory = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "provider.native_sessions.history" &&
          command.providerThreadId === providerThreadId,
      );
      expect(prunedTimelineHistory.row.hostId).toBe(host.id);
      await reportQueuedCommandSuccess(
        harness,
        prunedTimelineHistory as never,
        nativeHistory as never,
      );
      const prunedTimelineResponse = await prunedTimelineResponsePromise;
      expect(prunedTimelineResponse.status).toBe(200);
      const prunedTimeline = threadTimelineResponseSchema.parse(
        await readJson(prunedTimelineResponse),
      );
      expect(prunedTimeline.nativeHistoryProjection).toBe(true);
      expect(JSON.stringify(prunedTimeline)).toContain(
        '"path":"src/native.ts"',
      );
      expect(JSON.stringify(prunedTimeline)).not.toContain(
        "/tmp/native-adoption-worktree/src/native.ts",
      );

      const storedEventsResponse = await harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/events?limit=100&order=asc`,
      );
      expect(storedEventsResponse.status).toBe(200);
      expect(await readJson(storedEventsResponse)).toEqual([
        expect.objectContaining({ type: "thread/identity" }),
      ]);
    });
  });

  it("keeps local native head state without duplicating provider-owned transcript", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-local-head",
      });
      const providerThreadId = "native-thread-local-head";
      const adoptionResponse = await postAdoptNativeThread(harness, {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      });
      expect(adoptionResponse.status).toBe(200);
      const adopted = adoptNativeThreadResponseSchema.parse(
        await readJson(adoptionResponse),
      );

      let sequence = getLatestThreadSequence(harness.db, {
        threadId: adopted.thread.id,
      });
      const settledRequestId = encodeClientTurnRequestIdNumber({ value: 101 });
      const pendingRequestId = encodeClientTurnRequestIdNumber({ value: 102 });
      const execution = {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      } as const;
      const seedClientRequest = (args: {
        requestId: typeof settledRequestId;
        text: string;
      }) =>
        seedEvent(harness.deps, {
          threadId: adopted.thread.id,
          environmentId: adopted.thread.environmentId,
          sequence: (sequence += 1),
          type: "client/turn/requested",
          scope: threadScope(),
          data: {
            direction: "outbound",
            requestId: args.requestId,
            input: [{ type: "text", text: args.text, mentions: [] }],
            target: { kind: "new-turn" },
            execution,
            initiator: "user",
            senderThreadId: null,
            request: { method: "turn/start", params: {} },
            source: "tell",
          },
        });

      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "thread/goal/updated",
        scope: threadScope(),
        data: {
          providerThreadId,
          objective: "Preserve native head state",
          status: "active",
          tokenBudget: null,
          tokensUsed: 120,
          timeUsedSeconds: 45,
        },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "thread/contextWindowUsage/updated",
        scope: threadScope(),
        data: {
          providerThreadId,
          contextWindowUsage: {
            usedTokens: 900,
            modelContextWindow: 200_000,
            estimated: false,
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "thread/contextWindowUsage/updated",
        scope: threadScope(),
        data: {
          providerThreadId,
          contextWindowUsage: {
            usedTokens: 1_234,
            modelContextWindow: null,
            estimated: true,
          },
        },
      });
      seedClientRequest({
        requestId: settledRequestId,
        text: "Settled local request",
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "turn/input/accepted",
        scope: turnScope("native-turn-settled"),
        data: { clientRequestId: settledRequestId, providerThreadId },
      });
      seedClientRequest({
        requestId: pendingRequestId,
        text: "Pending local request",
      });

      const nativeSession = {
        providerThreadId,
        title: "Recovered session",
        cwd: "/tmp/native-adoption",
        projectId: null,
        workspaceRoot: "/tmp/native-adoption",
        status: "idle",
        createdAt: 1_777_000_000,
        updatedAt: 1_777_000_100,
        archived: false,
        source: "cli",
      } as const;
      const settledNativeEvents = [
        {
          createdAt: 1_777_000_010_000,
          event: {
            type: "turn/started",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-settled"),
          },
        },
        {
          createdAt: 1_777_000_011_000,
          event: {
            type: "item/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-settled"),
            item: {
              type: "userMessage",
              id: "native-user-settled",
              content: [{ type: "text", text: "Settled local request" }],
            },
          },
        },
        {
          createdAt: 1_777_000_012_000,
          event: {
            type: "item/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-settled"),
            item: {
              type: "agentMessage",
              id: "native-agent-settled",
              text: "Settled answer",
            },
          },
        },
        {
          createdAt: 1_777_000_013_000,
          event: {
            type: "turn/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-settled"),
            status: "completed",
          },
        },
      ];
      const readTimeline = async (nativeEvents: typeof settledNativeEvents) => {
        const responsePromise = harness.app.request(
          `/api/v1/threads/${adopted.thread.id}/timeline?includeNestedRows=true`,
        );
        const history = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "provider.native_sessions.history" &&
            command.providerThreadId === providerThreadId,
        );
        await reportQueuedCommandSuccess(
          harness,
          history as never,
          { session: nativeSession, events: nativeEvents } as never,
        );
        const response = await responsePromise;
        expect(response.status).toBe(200);
        return threadTimelineResponseSchema.parse(await readJson(response));
      };
      const nestedRows = (row: TimelineRow): readonly TimelineRow[] => {
        if (row.kind === "turn") {
          return row.children ?? [];
        }
        if (row.kind === "work" && row.workKind === "delegation") {
          return row.childRows;
        }
        return [];
      };
      const flattenRows = (rows: readonly TimelineRow[]): TimelineRow[] => {
        const flattened: TimelineRow[] = [];
        const visit = (currentRows: readonly TimelineRow[]): void => {
          for (const row of currentRows) {
            flattened.push(row);
            visit(nestedRows(row));
          }
        };
        visit(rows);
        return flattened;
      };
      const conversationTexts = (timeline: { rows: TimelineRow[] }) =>
        flattenRows(timeline.rows).flatMap((row) =>
          row.kind === "conversation" && row.text !== undefined
            ? [row.text]
            : [],
        );
      const expectDeterministicUniqueRows = (timeline: {
        rows: TimelineRow[];
      }) => {
        const rows = flattenRows(timeline.rows);
        const ids = rows.map((row) => row.id);
        const sequences = rows.map((row) => row.sourceSeqStart);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(sequences).size).toBe(sequences.length);
        expect(sequences).toEqual(
          [...sequences].sort((left, right) => left - right),
        );
      };

      const beforeMutation = await readTimeline(settledNativeEvents);
      expect(beforeMutation.goal).toMatchObject({
        objective: "Preserve native head state",
        status: "active",
      });
      expect(beforeMutation.contextWindowUsage).toEqual({
        usedTokens: 1_234,
        modelContextWindow: 200_000,
        estimated: true,
      });
      expect(
        conversationTexts(beforeMutation).filter(
          (text) => text === "Settled local request",
        ),
      ).toHaveLength(1);
      const pendingRow = flattenRows(beforeMutation.rows).find(
        (row) =>
          row.kind === "conversation" &&
          row.role === "user" &&
          row.text === "Pending local request",
      );
      expect(pendingRow).toMatchObject({
        turnRequest: { kind: "message", status: "pending" },
      });
      expectDeterministicUniqueRows(beforeMutation);

      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "thread/goal/cleared",
        scope: threadScope(),
        data: { providerThreadId },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "thread/contextWindowUsage/updated",
        scope: threadScope(),
        data: {
          providerThreadId,
          contextWindowUsage: {
            usedTokens: 1_500,
            modelContextWindow: null,
            estimated: false,
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: adopted.thread.id,
        environmentId: adopted.thread.environmentId,
        providerThreadId,
        sequence: (sequence += 1),
        type: "turn/input/accepted",
        scope: turnScope("native-turn-pending"),
        data: { clientRequestId: pendingRequestId, providerThreadId },
      });
      const completedNativeEvents = [
        ...settledNativeEvents,
        {
          createdAt: 1_777_000_020_000,
          event: {
            type: "turn/started",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-pending"),
          },
        },
        {
          createdAt: 1_777_000_021_000,
          event: {
            type: "item/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-pending"),
            item: {
              type: "userMessage",
              id: "native-user-pending",
              content: [{ type: "text", text: "Pending local request" }],
            },
          },
        },
        {
          createdAt: 1_777_000_022_000,
          event: {
            type: "item/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-pending"),
            item: {
              type: "agentMessage",
              id: "native-agent-pending",
              text: "Pending answer",
            },
          },
        },
        {
          createdAt: 1_777_000_023_000,
          event: {
            type: "turn/completed",
            threadId: adopted.thread.id,
            providerThreadId,
            scope: turnScope("native-turn-pending"),
            status: "completed",
          },
        },
      ];

      const afterMutation = await readTimeline(completedNativeEvents);
      expect(afterMutation.goal).toBeNull();
      expect(afterMutation.contextWindowUsage).toEqual({
        usedTokens: 1_500,
        modelContextWindow: 200_000,
        estimated: false,
      });
      expect(
        conversationTexts(afterMutation).filter(
          (text) => text === "Settled local request",
        ),
      ).toHaveLength(1);
      expect(
        conversationTexts(afterMutation).filter(
          (text) => text === "Pending local request",
        ),
      ).toHaveLength(1);
      expectDeterministicUniqueRows(afterMutation);
      await expect(readTimeline(completedNativeEvents)).resolves.toEqual(
        afterMutation,
      );
    });
  });

  it("rejects native history returned for a different provider session", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-history-mismatch",
      });
      const providerThreadId = "native-thread-history-requested";
      const adoptionResponse = await postAdoptNativeThread(harness, {
        hostId: host.id,
        providerId: "codex",
        providerThreadId,
      });
      const adopted = adoptNativeThreadResponseSchema.parse(
        await readJson(adoptionResponse),
      );

      const timelineResponsePromise = harness.app.request(
        `/api/v1/threads/${adopted.thread.id}/timeline`,
      );
      const history = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.native_sessions.history",
      );
      await reportQueuedCommandSuccess(
        harness,
        history as never,
        {
          session: {
            providerThreadId: "native-thread-history-other",
            title: "Wrong session",
            cwd: "/tmp/native-adoption",
            projectId: null,
            workspaceRoot: "/tmp/native-adoption",
            status: "idle",
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            source: "cli",
          },
          events: [],
        } as never,
      );

      const timelineResponse = await timelineResponsePromise;
      expect(timelineResponse.status).toBe(409);
      await expect(readJson(timelineResponse)).resolves.toMatchObject({
        code: "native_session_identity_mismatch",
      });
    });
  });

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

      archiveThread(harness.db, harness.deps.hub, first.thread.id);
      const secondResponse = await postAdoptNativeThread(harness, request);
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
      expect(second).toMatchObject({
        created: false,
        thread: {
          id: first.thread.id,
          projectId: first.thread.projectId,
          environmentId: first.thread.environmentId,
        },
      });
      expect(second.thread.archivedAt).toBeNull();
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

  it("reattaches a pruned native projection before reopening it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-pruned-reopen",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-pruned-reopen",
      };
      const managedPath = `/tmp/bb-host-data/${host.id}/worktrees/env_pruned/repo`;
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-pruned-source",
      });
      const managedEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: managedPath,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const firstResponse = await postAdoptNativeThread(harness, request, {
        providerThreadId: request.providerThreadId,
        title: "Recovered managed session",
        cwd: managedPath,
      });
      const first = adoptNativeThreadResponseSchema.parse(
        await readJson(firstResponse),
      );
      const firstEnvironmentId = first.thread.environmentId;
      if (firstEnvironmentId === null) {
        throw new Error("Expected adopted native thread environment");
      }
      expect(firstEnvironmentId).toBe(managedEnvironment.id);
      harness.db
        .delete(environments)
        .where(eq(environments.id, firstEnvironmentId))
        .run();
      expect(getThread(harness.db, first.thread.id)).toMatchObject({
        environmentId: null,
        nativeSessionHostId: host.id,
      });

      const secondResponse = await postAdoptNativeThread(harness, request, {
        providerThreadId: request.providerThreadId,
        title: "Recovered managed session",
        cwd: managedPath,
      });

      expect(secondResponse.status).toBe(200);
      const second = adoptNativeThreadResponseSchema.parse(
        await readJson(secondResponse),
      );
      expect(second).toMatchObject({
        created: false,
        thread: {
          id: first.thread.id,
          projectId: first.thread.projectId,
          environmentId: expect.any(String),
        },
      });
      expect(second.thread.environmentId).not.toBe(firstEnvironmentId);
      expect(
        getEnvironment(harness.db, second.thread.environmentId as string),
      ).toMatchObject({
        hostId: host.id,
        path: managedPath,
        projectId: first.thread.projectId,
        status: "ready",
        managed: false,
        workspaceProvisionType: "unmanaged",
      });
      expect(getLastStoredProviderThreadId(harness.db, first.thread.id)).toBe(
        request.providerThreadId,
      );
    });
  });

  it("revives a retiring managed environment when reopening a projection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-retiring",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-retiring-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-adoption",
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-retiring",
      };

      const firstResponse = await postAdoptNativeThread(harness, request);
      const first = adoptNativeThreadResponseSchema.parse(
        await readJson(firstResponse),
      );
      archiveThread(harness.db, harness.deps.hub, first.thread.id);
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.deps.hub, {
          environmentId: environment.id,
          event: { type: "retire.requested" },
        }),
      );

      const secondResponse = await postAdoptNativeThread(harness, request);

      expect(secondResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "ready",
      });
    });
  });

  it("rejects an unusable environment without unarchiving the projection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-unusable",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-unusable-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-adoption",
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-unusable",
      };
      const firstResponse = await postAdoptNativeThread(harness, request);
      const first = adoptNativeThreadResponseSchema.parse(
        await readJson(firstResponse),
      );
      archiveThread(harness.db, harness.deps.hub, first.thread.id);
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.deps.hub, {
          environmentId: environment.id,
          event: { type: "retire.requested" },
        }),
      );
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.deps.hub, {
          environmentId: environment.id,
          event: {
            type: "destroy.started",
            destroyAttemptId: "rpc_native_unusable",
          },
        }),
      );
      requireEnvironmentLifecycleEventApplied(
        applyEnvironmentLifecycleEvent(harness.db, harness.deps.hub, {
          environmentId: environment.id,
          event: { type: "destroy.lost" },
        }),
      );

      const secondResponse = await postAdoptNativeThread(harness, request);

      expect(secondResponse.status).toBe(409);
      await expect(readJson(secondResponse)).resolves.toMatchObject({
        code: "environment_not_ready",
      });
      expect(getThread(harness.db, first.thread.id)?.archivedAt).not.toBeNull();
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

  it("revalidates an existing projection against native archive state", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-revalidate",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-revalidate",
      };
      const first = await postAdoptNativeThread(harness, request);
      expect(first.status).toBe(200);
      await readJson(first);

      const secondPromise = harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const read = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.native_sessions.read",
      );
      await reportQueuedCommandSuccess(harness, read, {
        providerThreadId: request.providerThreadId,
        title: "Archived later",
        cwd: "/tmp/native-adoption",
        projectId: null,
        workspaceRoot: "/tmp/native-adoption",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        archived: true,
        source: "cli",
      });

      const second = await secondPromise;
      expect(second.status).toBe(409);
      await expect(readJson(second)).resolves.toMatchObject({
        code: "native_session_archived",
      });
    });
  });

  it("rejects an existing projection when the native workspace changed", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-moved",
      });
      const request = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-moved",
      };
      const first = await postAdoptNativeThread(harness, request);
      expect(first.status).toBe(200);
      await readJson(first);

      const second = await postAdoptNativeThread(harness, request, {
        providerThreadId: request.providerThreadId,
        title: "Moved session",
        cwd: "/tmp/native-adoption-moved",
      });

      expect(second.status).toBe(409);
      await expect(readJson(second)).resolves.toMatchObject({
        code: "native_session_workspace_changed",
      });
    });
  });

  it("rejects mismatched provider identity before creating local records", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-mismatch",
      });
      const responsePromise = harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId: "native-thread-requested",
          }),
        },
      );
      const read = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.native_sessions.read",
      );
      await reportQueuedCommandSuccess(harness, read, {
        providerThreadId: "native-thread-other",
        title: "Wrong session",
        cwd: "/tmp/native-mismatch",
        projectId: null,
        workspaceRoot: "/tmp/native-mismatch",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        source: "cli",
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "native_session_identity_mismatch",
      });
      expect(listPublicProjects(harness.db)).toEqual([]);
      expect(listEnvironments(harness.db)).toEqual([]);
    });
  });

  it("rejects an invalid provider working directory before inspection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-invalid-path",
      });
      const responsePromise = harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId: "native-thread-invalid-path",
          }),
        },
      );
      const read = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.native_sessions.read",
      );
      await reportQueuedCommandSuccess(harness, read, {
        providerThreadId: "native-thread-invalid-path",
        title: "Invalid path",
        cwd: "/",
        projectId: null,
        workspaceRoot: "/",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        source: "cli",
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "native_session_cwd_invalid",
      });
      expect(listQueuedCommands(harness, "project.inspect")).toEqual([]);
    });
  });

  it("rejects a provider path that canonicalizes to the filesystem root", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-canonical-root",
      });
      const responsePromise = harness.app.request(
        "/api/v1/threads/adopt-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            providerId: "codex",
            providerThreadId: "native-thread-canonical-root",
          }),
        },
      );
      const read = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.native_sessions.read",
      );
      await reportQueuedCommandSuccess(harness, read, {
        providerThreadId: "native-thread-canonical-root",
        title: "Canonical root",
        cwd: "/tmp/..",
        projectId: null,
        workspaceRoot: "/tmp/..",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        source: "cli",
      });
      const inspection = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "project.inspect",
      );
      await reportQueuedCommandSuccess(harness, inspection, {
        path: "/",
        gitRemoteUrl: null,
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "native_session_cwd_invalid",
      });
      expect(listPublicProjects(harness.db)).toEqual([]);
    });
  });

  it("reuses the project and environment that own a managed workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-managed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-managed-worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const response = await postAdoptNativeThread(
        harness,
        {
          hostId: host.id,
          providerId: "codex",
          providerThreadId: "native-thread-managed",
        },
        {
          providerThreadId: "native-thread-managed",
          title: "Managed session",
          cwd: "/tmp/native-managed-worktree",
        },
      );

      expect(response.status).toBe(200);
      const result = adoptNativeThreadResponseSchema.parse(
        await readJson(response),
      );
      expect(result.thread.projectId).toBe(project.id);
      expect(result.thread.environmentId).toBe(environment.id);
      expect(listEnvironments(harness.db)).toHaveLength(1);
    });
  });

  it("rejects an unowned path beneath the managed workspace root without creating a project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-managed-root",
      });
      const managedPath = `/tmp/bb-host-data/${host.id}/worktrees/env_pending/repo`;
      const response = await postAdoptNativeThread(
        harness,
        {
          hostId: host.id,
          providerId: "codex",
          providerThreadId: "native-thread-managed-root",
        },
        {
          providerThreadId: "native-thread-managed-root",
          title: "Pending managed workspace",
          cwd: managedPath,
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(listPublicProjects(harness.db)).toEqual([]);
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
