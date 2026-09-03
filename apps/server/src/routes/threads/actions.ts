import {
  confirmNativeSessionArchive,
  deleteQueuedThreadMessage,
  getEnvironment,
  getQueuedThreadMessage,
  getThreadNativeSessionHostId,
  hasNativeSessionArchiveConfirmation,
  listActiveVisiblePinnedThreadRootsWithPendingInteractionState,
  pinThread,
  reorderPinnedThread,
  reorderQueuedThreadMessage,
  setQueuedThreadMessageGroupBoundary,
  unarchiveThread,
  unpinThread,
  updateQueuedThreadMessage,
  updateThread,
  type ReorderPinnedThreadResult,
  type ReorderQueuedThreadMessageResult,
  type SetQueuedThreadMessageGroupBoundaryResult,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type ThreadListResponse,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import {
  createStandaloneBuiltinCompactCommandInput,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../../services/environments/lifecycle-outcome.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { parseSafeRelativeRoutePath } from "../relative-route-path.js";
import { validatePromptAttachmentReferences } from "../../services/projects/attachments.js";
import {
  createQueuedMessageForThread,
  sendQueuedMessage,
} from "../../services/threads/queued-messages.js";
import {
  ensureThreadIsNotAwaitingUserInteraction,
  ensureThreadIsWritable,
  sendThreadMessage,
} from "../../services/threads/thread-send.js";
import { acceptThreadSendRequest } from "../../services/threads/thread-send-request.js";
import { editThreadMessage } from "../../services/threads/thread-edit-message.js";
import {
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
  runRetainedNativeSessionUnarchiveCommand,
  runThreadProviderArchiveCommand,
  runThreadUnarchiveCommand,
} from "../../services/threads/thread-commands.js";
import { getLastProviderThreadId } from "../../services/threads/thread-events.js";
import { stopThreadForCurrentState } from "../../services/threads/thread-lifecycle.js";
import {
  getThreadPromptBannerActivity,
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import {
  archivePreparedThread,
  nativeSessionMutationKey,
  prepareThreadAndChildrenArchive,
  prepareThreadAndHiddenSourceForksArchive,
  resolveArchiveThreadEnvironment,
  type PreparedThreadAndChildrenArchive,
  withNativeSessionMutation,
  withThreadArchiveMutation,
} from "../../services/threads/thread-archive.js";
import {
  requireThreadCommandEnvironment,
  requireThreadHostCommandEnvironment,
  resolveThreadHostCommandEnvironment,
} from "../../services/threads/thread-command-environment.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../../services/hosts/live-command.js";

function toQueuedMessageOrderResponse(
  result: ReorderQueuedThreadMessageResult,
): ThreadQueuedMessage[] {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return result.queuedMessages.map(toThreadQueuedMessage);
    case "not_found":
      throw new ApiError(404, "invalid_request", "Queued message not found");
    case "claimed":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message is already being sent",
      );
    case "stale_neighbor":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message order changed",
      );
    case "invalid_neighbor_order":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message order is invalid",
      );
    case "invalid_sender":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages from different senders cannot be grouped",
      );
    case "invalid_execution_options":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages with different execution options cannot be grouped",
      );
  }
}

interface NativeSessionIdentity {
  hostId: string;
  providerId: string;
  providerThreadId: string;
}

function resolveThreadNativeSessionIdentity(
  deps: AppDeps,
  thread: Thread,
): NativeSessionIdentity | null {
  const providerThreadId = getLastProviderThreadId(deps, thread.id);
  const hostId = getThreadNativeSessionHostId(deps.db, thread.id);
  return providerThreadId !== null && hostId !== null
    ? {
        hostId,
        providerId: thread.providerId,
        providerThreadId,
      }
    : null;
}

async function archivePreparedProviderThreads(
  deps: AppDeps,
  prepared: PreparedThreadAndChildrenArchive,
  options: { allowLiveChildren?: boolean } = {},
): Promise<ReadonlyMap<string, Thread | null>> {
  const archivedThreads = new Map<string, Thread | null>();
  const root = prepared.threads.find(
    ({ thread }) => thread.id === prepared.rootThreadId,
  );
  const orderedThreads = [
    ...prepared.threads.filter(
      ({ thread }) => thread.id !== prepared.rootThreadId,
    ),
    ...(root === undefined ? [] : [root]),
  ];

  for (const preparedThread of orderedThreads) {
    const { environment: archiveEnvironment, thread } = preparedThread;
    const providerThreadId = getLastProviderThreadId(deps, thread.id);
    const environment =
      archiveEnvironment === null
        ? null
        : getEnvironment(deps.db, archiveEnvironment.id);
    if (providerThreadId !== null && environment !== null) {
      const archived = await runThreadProviderArchiveCommand(deps, {
        allowLiveChildren: options.allowLiveChildren,
        environment,
        providerThreadId,
        thread,
      });
      if (archived) {
        confirmNativeSessionArchive(deps.db, {
          providerThreadId,
          threadId: thread.id,
        });
      }
    }
    archivedThreads.set(
      thread.id,
      archivePreparedThread(deps, preparedThread, {
        dispatchProviderArchive: false,
      }),
    );
  }

  return archivedThreads;
}

async function compactThreadContext(
  deps: AppDeps,
  thread: Thread,
): Promise<void> {
  ensureThreadIsWritable(thread);
  if (!deps.providerRegistry.supportsManualCompaction(thread.providerId)) {
    throw new ApiError(
      409,
      "invalid_request",
      `Provider "${thread.providerId}" does not support manual context compaction`,
    );
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "Context can only be compacted while the thread is idle or errored",
    );
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: {
      input: createStandaloneBuiltinCompactCommandInput(),
      mode: "start",
    },
    thread,
    trigger: "user",
  });
}

function toQueuedMessageGroupBoundaryResponse(
  result: SetQueuedThreadMessageGroupBoundaryResult,
): ThreadQueuedMessage[] {
  switch (result.kind) {
    case "updated":
    case "unchanged":
      return result.queuedMessages.map(toThreadQueuedMessage);
    case "not_found":
      throw new ApiError(404, "invalid_request", "Queued message not found");
    case "claimed":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message is already being sent",
      );
    case "stale_neighbor":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message order changed",
      );
    case "invalid_sender":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages from different senders cannot be grouped",
      );
    case "invalid_execution_options":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages with different execution options cannot be grouped",
      );
  }
}

function buildActivePinnedThreadRootListResponse(
  deps: AppDeps,
): ThreadListResponse {
  return toThreadListEntryResponses(deps, {
    threads: listActiveVisiblePinnedThreadRootsWithPendingInteractionState(
      deps.db,
    ),
  });
}

function assertPinnedThreadOrderResult(
  result: ReorderPinnedThreadResult,
): void {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return;
    case "not_found":
      throw new ApiError(404, "thread_not_found", "Thread not found");
    case "not_pinned":
      throw new ApiError(409, "invalid_request", "Thread is not pinned");
    case "stale_neighbor":
      throw new ApiError(409, "invalid_request", "Pinned thread order changed");
    case "invalid_neighbor_order":
      throw new ApiError(
        409,
        "invalid_request",
        "Pinned thread order is invalid",
      );
  }
}

export function registerThreadActionRoutes(app: Hono, deps: AppDeps): void {
  const { post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  post(routes.send, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      await acceptThreadSendRequest(deps, { payload, thread }),
    );
  });

  post(routes.editMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment = await requireThreadCommandEnvironment(deps, {
      thread,
    });
    const result = await editThreadMessage(deps, {
      environment,
      payload,
      thread,
    });
    return context.json(result);
  });

  post(routes.createQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const queuedMessage = await createQueuedMessageForThread(deps, {
      payload,
      thread,
    });
    return context.json(queuedMessage, 201);
  });

  post(routes.sendQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
    const queuedMessage = await sendQueuedMessage(deps, {
      queuedMessageId: context.req.param("queuedMessageId"),
      mode: payload.mode,
      threadId: context.req.param("id"),
    });
    return context.json({ ok: true, queuedMessage });
  });

  patch(routes.reorderQueuedMessage, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    return context.json(
      toQueuedMessageOrderResponse(
        reorderQueuedThreadMessage({
          db: deps.db,
          notifier: deps.hub,
          threadId: thread.id,
          queuedMessageId: context.req.param("queuedMessageId"),
          previousQueuedMessageId: payload.previousQueuedMessageId,
          nextQueuedMessageId: payload.nextQueuedMessageId,
          groupBoundaryQueuedMessageId: payload.groupBoundaryQueuedMessageId,
        }),
      ),
    );
  });

  patch(routes.setQueuedMessageGroupBoundary, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    return context.json(
      toQueuedMessageGroupBoundaryResponse(
        setQueuedThreadMessageGroupBoundary({
          db: deps.db,
          notifier: deps.hub,
          threadId: thread.id,
          expectedGroupedPrefixQueuedMessageIds:
            payload.expectedGroupedPrefixQueuedMessageIds,
          groupBoundaryQueuedMessageId: payload.groupBoundaryQueuedMessageId,
        }),
      ),
    );
  });

  patch(routes.updateQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    await validatePromptAttachmentReferences({
      dataDir: deps.config.dataDir,
      input: payload.input,
      projectId: thread.projectId,
    });
    const result = updateQueuedThreadMessage(deps.db, deps.hub, {
      content: payload.input,
      expectedUpdatedAt: payload.expectedUpdatedAt,
      id: context.req.param("queuedMessageId"),
      threadId: thread.id,
    });
    if (result.kind === "not_found") {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    if (result.kind === "claimed") {
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message is already being sent",
      );
    }
    if (result.kind === "stale") {
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message changed since editing began",
      );
    }
    return context.json(toThreadQueuedMessage(result.queuedMessage));
  });

  del(routes.deleteQueuedMessage, (context) => {
    const queuedMessage = getQueuedThreadMessage(
      deps.db,
      context.req.param("queuedMessageId"),
    );
    if (!queuedMessage || queuedMessage.threadId !== context.req.param("id")) {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    const deleted = deleteQueuedThreadMessage(
      deps.db,
      deps.hub,
      context.req.param("queuedMessageId"),
    );
    if (!deleted) {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    return context.json({ ok: true });
  });

  post(routes.stop, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment = resolveThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    await stopThreadForCurrentState(deps, thread, environment);
    return context.json({ ok: true });
  });

  post(routes.compact, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    await compactThreadContext(deps, thread);
    return context.json({ ok: true });
  });

  post(routes.cancelPlan, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const activity = getThreadPromptBannerActivity(deps, thread);
    if (activity.activePlanModeCount === 0) {
      throw new ApiError(409, "invalid_request", "Plan mode is not active");
    }
    if (activity.activePlanTurnId === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "The active Plan turn could not be identified",
      );
    }
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    await runLiveHostCommand(deps, {
      command: {
        type: "thread.plan.cancel",
        environmentId: environment.id,
        threadId: thread.id,
        expectedTurnId: activity.activePlanTurnId,
      },
      hostId: environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    });
    const updatedThread = requirePublicThread(deps.db, thread.id);
    if (
      getThreadPromptBannerActivity(deps, updatedThread).activePlanModeCount > 0
    ) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not confirm that Plan mode exited",
      );
    }
    return context.json({ ok: true });
  });

  post(routes.clearGoal, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    // No provider gate: a Goal is provider extension state, so a thread whose
    // provider never declares one simply has no active Goal to clear.
    const activity = getThreadPromptBannerActivity(deps, thread);
    if (activity.activeGoalCount === 0) {
      throw new ApiError(409, "invalid_request", "No active Goal to clear");
    }
    const environment = await requireThreadCommandEnvironment(deps, {
      thread,
    });
    const execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
    );
    const preparedRuntimeCommand = await prepareTurnSubmitCommandPayload(deps, {
      environment,
      execution,
      input: [],
      permissionEscalation: "deny",
      target: { mode: "auto", expectedTurnId: null },
      thread,
    });
    const result = await runLiveHostCommand(deps, {
      command: {
        type: "thread.goal.clear",
        environmentId: environment.id,
        threadId: thread.id,
        options: preparedRuntimeCommand.options,
        resumeContext: preparedRuntimeCommand.resumeContext,
        bridgeLaunch: preparedRuntimeCommand.bridgeLaunch,
      },
      hostId: environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    });
    const updatedThread = requirePublicThread(deps.db, thread.id);
    const updatedActivity = getThreadPromptBannerActivity(deps, updatedThread);
    if (updatedActivity.activeGoalCount > 0 && !result.cleared) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not clear the active Goal",
      );
    }
    if (updatedActivity.activeGoalCount > 0) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not confirm that the active Goal was cleared",
      );
    }
    return context.json({ ok: true });
  });

  post(routes.open, (context, payload) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    if (payload.file !== null) {
      parseSafeRelativeRoutePath(payload.file.path);
    }
    const delivered = deps.hub.notifyThreadOpen(
      { projectId: publicThread.projectId, threadId: publicThread.id },
      { split: payload.split ?? "replace", file: payload.file },
    );
    return context.json({ delivered });
  });

  post(routes.paneAction, (context, payload) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const delivered = deps.hub.notifyThreadPaneAction(
      { projectId: publicThread.projectId, threadId: publicThread.id },
      payload.action,
    );
    return context.json({ delivered });
  });

  post(routes.pin, (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = pinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post(routes.unpin, (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = unpinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  patch(routes.pinOrder, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    assertPinnedThreadOrderResult(
      reorderPinnedThread({
        db: deps.db,
        notifier: deps.hub,
        threadId: thread.id,
        previousThreadId: payload.previousThreadId,
        nextThreadId: payload.nextThreadId,
      }),
    );
    return context.json(buildActivePinnedThreadRootListResponse(deps));
  });

  post(routes.archive, async (context) => {
    const threadId = context.req.param("id");
    const initialThread = requirePublicThread(deps.db, threadId);
    const nativeIdentity = resolveThreadNativeSessionIdentity(
      deps,
      initialThread,
    );
    const archive = () =>
      withThreadArchiveMutation(threadId, async () => {
        const thread = requirePublicThread(deps.db, threadId);
        const sourceAlreadyArchived = thread.archivedAt !== null;
        const environment = resolveArchiveThreadEnvironment(deps, { thread });
        const prepared = prepareThreadAndHiddenSourceForksArchive(deps, {
          environment,
          thread,
        });
        const archivedThreads = await archivePreparedProviderThreads(
          deps,
          prepared,
        );
        const archiveResult = archivedThreads.get(thread.id) ?? null;
        if (!archiveResult && !sourceAlreadyArchived) {
          throw new ApiError(404, "thread_not_found", "Thread not found");
        }
        if (sourceAlreadyArchived) {
          deps.terminalSessions.closeArchivedThreadTerminals({
            threadId: thread.id,
          });
        }
        return context.json({ ok: true });
      });
    return nativeIdentity === null
      ? archive()
      : withNativeSessionMutation(() =>
          withThreadArchiveMutation(
            nativeSessionMutationKey(nativeIdentity),
            archive,
          ),
        );
  });

  post(routes.archiveAll, async (context) => {
    const threadId = context.req.param("id");
    return withNativeSessionMutation(() =>
      withThreadArchiveMutation(threadId, async () => {
        const thread = requirePublicThread(deps.db, threadId);
        const prepared = prepareThreadAndChildrenArchive(deps, {
          parentThread: thread,
        });
        const archivedThreads = await archivePreparedProviderThreads(
          deps,
          prepared,
          {
            allowLiveChildren: true,
          },
        );
        return context.json({
          ok: true,
          archivedThreadIds: [...archivedThreads.values()].flatMap((thread) =>
            thread === null ? [] : [thread.id],
          ),
        });
      }),
    );
  });

  // Un-archive clears archivedAt. When the thread's managed environment is still
  // inside its archive grace window (`retiring`), un-archiving revives it via the
  // existing `retire.cancelled` event so the intact worktree is restored — the
  // lossless undo of an accidental archive. If the grace window already elapsed
  // and the environment was destroyed, `retire.cancelled` is a no-op (illegal
  // from destroying/destroyed) and the thread remains read-only. The user can
  // hand its context and surviving branch off to a new thread instead.
  post(routes.unarchive, async (context) => {
    const threadId = context.req.param("id");
    const initialThread = requirePublicThread(deps.db, threadId);
    const nativeIdentity = resolveThreadNativeSessionIdentity(
      deps,
      initialThread,
    );
    const unarchive = () =>
      withThreadArchiveMutation(threadId, async () => {
        const thread = requirePublicThread(deps.db, threadId);
        const providerThreadId = getLastProviderThreadId(deps, thread.id);
        const environment = thread.environmentId
          ? getEnvironment(deps.db, thread.environmentId)
          : null;
        const providerArchiveConfirmed =
          providerThreadId !== null &&
          hasNativeSessionArchiveConfirmation(deps.db, {
            providerThreadId,
            threadId: thread.id,
          });
        if (
          providerThreadId &&
          nativeIdentity !== null &&
          providerArchiveConfirmed
        ) {
          await runRetainedNativeSessionUnarchiveCommand(deps, {
            hostId: nativeIdentity.hostId,
            laneId: environment?.id ?? nativeSessionMutationKey(nativeIdentity),
            providerThreadId,
            thread,
          });
        } else if (providerThreadId && environment) {
          await runThreadUnarchiveCommand(deps, {
            environment,
            providerThreadId,
            thread,
          });
        }
        unarchiveThread(deps.db, deps.hub, thread.id);
        if (environment?.status === "retiring") {
          applyLoggedEnvironmentLifecycleEvent(deps, {
            environmentId: environment.id,
            event: { type: "retire.cancelled" },
          });
        }
        return context.json({ ok: true });
      });
    return nativeIdentity === null
      ? unarchive()
      : withNativeSessionMutation(() =>
          withThreadArchiveMutation(
            nativeSessionMutationKey(nativeIdentity),
            unarchive,
          ),
        );
  });

  post(routes.read, (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: Date.now(),
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post(routes.unread, (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: null,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });
}
