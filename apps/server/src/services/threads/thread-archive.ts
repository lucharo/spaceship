import {
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
  listUnarchivedHiddenSourceThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
} from "../environments/environment-cleanup-internal.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import { emitPluginThreadArchived } from "../plugins/plugin-thread-events.js";
import {
  dispatchSettledArchivedThreadProviderArchiveCommand,
  requestActiveRuntimeThreadStopIfNeeded,
} from "./thread-lifecycle.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";
import { getActiveThreadProvisionContext } from "./thread-provisioning-active-context.js";
import { isPreStartThreadStatus } from "./thread-status.js";

interface ArchiveThreadEnvironment {
  hostId: string;
  id: string;
}

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: ArchiveThreadEnvironment | null;
  thread: Thread;
}

interface ArchiveThreadLifecycleOptions {
  dispatchProviderArchive?: boolean;
}

interface ResolveArchiveThreadEnvironmentArgs {
  thread: ArchiveThreadWithLifecycleEffectsArgs["thread"];
}

interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

export interface PreparedArchiveThread {
  environment: ArchiveThreadEnvironment | null;
  thread: ArchiveThreadWithLifecycleEffectsArgs["thread"];
}

export interface PreparedThreadAndChildrenArchive {
  rootThreadId: string;
  threads: PreparedArchiveThread[];
}

const threadArchiveMutationChains = new Map<string, Promise<void>>();
const nativeSessionMutationGlobalKey = "native-session-mutations";

export function nativeSessionMutationKey(args: {
  hostId: string;
  providerId: string;
  providerThreadId: string;
}): string {
  return JSON.stringify([
    "native-session",
    args.hostId,
    args.providerId,
    args.providerThreadId,
  ]);
}

/**
 * Serialize lifecycle mutations that share either a projected source thread or
 * a provider-native session identity. Native archive waits on a provider RPC,
 * so the lock keeps adoption, unarchive, or hidden-fork creation from
 * invalidating its preflight snapshot.
 */
export function withThreadArchiveMutation<T>(
  mutationKey: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const previous =
    threadArchiveMutationChains.get(mutationKey) ?? Promise.resolve();
  const result = previous.then(mutate);
  const tail = result.then(
    () => {},
    () => {},
  );
  threadArchiveMutationChains.set(mutationKey, tail);
  void tail.then(() => {
    if (threadArchiveMutationChains.get(mutationKey) === tail) {
      threadArchiveMutationChains.delete(mutationKey);
    }
  });
  return result;
}

/**
 * Native adoption, archive, unarchive, and source-derived creation all touch
 * provider identity plus local projection state. Keep their lock ordering
 * deterministic across single-thread and bulk routes. Provider RPC latency is
 * acceptable here: these are explicit, low-frequency lifecycle operations.
 */
export function withNativeSessionMutation<T>(
  mutate: () => Promise<T>,
): Promise<T> {
  return withThreadArchiveMutation(nativeSessionMutationGlobalKey, mutate);
}

/**
 * Resolve the environment archive needs to stop the thread's live work, or
 * null when there is nothing to stop. A thread loses its environment pointer
 * when the environment row is pruned (threads.environment_id is ON DELETE SET
 * NULL); that thread is settled and archivable without an environment. A
 * pointer-less thread whose setup is still in flight (its environment row does
 * not exist yet) keeps the refusal: archive does not cancel setup, so admitting
 * it would let setup create an environment for an archived thread.
 */
export function resolveArchiveThreadEnvironment(
  deps: Pick<AppDeps, "db">,
  args: ResolveArchiveThreadEnvironmentArgs,
): ArchiveThreadEnvironment | null {
  if (args.thread.environmentId !== null) {
    return requireThreadHostCommandEnvironment({
      db: deps.db,
      thread: args.thread,
    });
  }
  if (
    isPreStartThreadStatus(args.thread.status) ||
    args.thread.status === "stopping" ||
    getActiveThreadProvisionContext(args.thread.id) !== null
  ) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  return null;
}

function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
  options: ArchiveThreadLifecycleOptions = {},
): Thread | null {
  const archivedThread = archiveThreadAndReleaseChildren(deps, {
    threadId: args.thread.id,
  });
  if (!archivedThread) {
    return null;
  }

  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: archivedThread.id,
  });
  // Archive only stops active runtime work; manual stop is the pre-start
  // provisioning cancellation entrypoint. A thread whose environment row was
  // pruned has no runtime left to stop.
  if (args.environment !== null) {
    requestActiveRuntimeThreadStopIfNeeded(
      deps,
      archivedThread,
      args.environment,
    );
  }
  if (options.dispatchProviderArchive !== false) {
    dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
      threadId: archivedThread.id,
    });
  }
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });
  emitPluginThreadArchived(archivedThread);

  if (
    args.environment !== null &&
    wouldCleanupEnvironment(deps, {
      environmentId: args.environment.id,
    })
  ) {
    requestEnvironmentCleanup(deps, {
      environmentId: args.environment.id,
    });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: args.environment.id,
    });
  }

  return archivedThread;
}

export function archivePreparedThread(
  deps: AppDeps,
  prepared: PreparedArchiveThread,
  options: ArchiveThreadLifecycleOptions = {},
): Thread | null {
  return archiveThreadWithLifecycleEffects(deps, prepared, options);
}

/**
 * Archive one thread plus the hidden forks that retire with it. A hidden fork
 * (a side chat, say) has no row of its own to reach, so it must not outlive its
 * source. Structural rather than plugin-owned: archiving cannot depend on
 * whichever plugin created the fork still being enabled.
 */
export function archiveThreadAndHiddenSourceForks(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  return archivePreparedThreadAndHiddenSourceForks(
    deps,
    prepareThreadAndHiddenSourceForksArchive(deps, args),
  );
}

export function prepareThreadAndHiddenSourceForksArchive(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): PreparedThreadAndChildrenArchive {
  const hiddenSourceThreads = listUnarchivedHiddenSourceThreads(deps.db, {
    sourceThreadId: args.thread.id,
  });
  return {
    rootThreadId: args.thread.id,
    threads: [args.thread, ...hiddenSourceThreads].map((thread, index) => ({
      environment:
        index === 0
          ? args.environment
          : resolveArchiveThreadEnvironment(deps, { thread }),
      thread,
    })),
  };
}

export function archivePreparedThreadAndHiddenSourceForks(
  deps: AppDeps,
  prepared: PreparedThreadAndChildrenArchive,
  options: ArchiveThreadLifecycleOptions = {},
): Thread | null {
  let archivedSourceThread: Thread | null = null;
  for (const entry of prepared.threads) {
    const archivedThread = archiveThreadWithLifecycleEffects(
      deps,
      entry,
      options,
    );
    if (entry.thread.id === prepared.rootThreadId) {
      archivedSourceThread = archivedThread;
    }
  }
  return archivedSourceThread;
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): string[] {
  const threads = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment: args.environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
  }

  if (
    archivedThreadIds.length > 0 &&
    wouldCleanupEnvironment(deps, {
      environmentId: args.environment.id,
    })
  ) {
    requestEnvironmentCleanup(deps, {
      environmentId: args.environment.id,
    });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: args.environment.id,
    });
  }

  return archivedThreadIds;
}

export function prepareThreadAndChildrenArchive(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): PreparedThreadAndChildrenArchive {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.parentThread.id,
  });
  // Collected here rather than through archiveThreadAndHiddenSourceForks so
  // every cascaded id lands in this route's response.
  const hiddenSourceThreads = listUnarchivedHiddenSourceThreads(deps.db, {
    sourceThreadId: args.parentThread.id,
  });
  const threads: ArchiveThreadWithLifecycleEffectsArgs["thread"][] = [
    ...childThreads,
    ...hiddenSourceThreads,
  ].filter((thread) => thread.id !== args.parentThread.id);
  if (args.parentThread.archivedAt === null) {
    threads.push(args.parentThread);
  }
  return {
    rootThreadId: args.parentThread.id,
    threads: threads.map((thread) => ({
      environment: resolveArchiveThreadEnvironment(deps, { thread }),
      thread,
    })),
  };
}

export function archivePreparedThreadAndChildren(
  deps: AppDeps,
  prepared: PreparedThreadAndChildrenArchive,
  options: ArchiveThreadLifecycleOptions = {},
): string[] {
  const archivedThreadIds: string[] = [];

  for (const { environment, thread } of prepared.threads) {
    const result = archiveThreadWithLifecycleEffects(
      deps,
      {
        environment,
        thread,
      },
      options,
    );
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
  }

  return archivedThreadIds;
}

export function archiveThreadAndChildren(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): string[] {
  return archivePreparedThreadAndChildren(
    deps,
    prepareThreadAndChildrenArchive(deps, args),
  );
}
