import type {
  SystemNativeSessionsQuery,
  SystemNativeSessionsResponse,
} from "@bb/server-contract";
import { findThreadsByNativeIdentities } from "@bb/db";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";
import { requireBridgeLaunchForProviderId } from "./provider-bridge-launch.js";

export async function listProviderNativeSessions(
  deps: AppDeps,
  providerId: string,
  query: SystemNativeSessionsQuery,
): Promise<SystemNativeSessionsResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const environmentCwd =
    query.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, query.environmentId).path ?? undefined);
  const cwd = query.cwd ?? environmentCwd;
  const bridgeLaunch = requireBridgeLaunchForProviderId(deps, providerId);

  const result = await callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "provider.native_sessions.list",
      providerId,
      bridgeLaunch,
      archived: query.archived === "true",
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(query.searchTerm !== undefined
        ? { searchTerm: query.searchTerm }
        : {}),
    },
  });
  const localThreads = findThreadsByNativeIdentities(deps.db, {
    hostId,
    providerId,
    providerThreadIds: result.sessions.map(
      (session) => session.providerThreadId,
    ),
  });
  return {
    ...result,
    sessions: result.sessions.map((session) => ({
      ...session,
      localThreadId: localThreads.get(session.providerThreadId)?.id ?? null,
    })),
  };
}

export async function readProviderNativeSession(
  deps: AppDeps,
  args: { hostId: string; providerId: string; providerThreadId: string },
) {
  const bridgeLaunch = requireBridgeLaunchForProviderId(deps, args.providerId);
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "provider.native_sessions.read",
      providerId: args.providerId,
      providerThreadId: args.providerThreadId,
      bridgeLaunch,
    },
  });
}

export async function readProviderNativeSessionHistory(
  deps: AppDeps,
  args: {
    hostId: string;
    providerId: string;
    providerThreadId: string;
    threadId: string;
  },
) {
  const bridgeLaunch = requireBridgeLaunchForProviderId(deps, args.providerId);
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "provider.native_sessions.history",
      providerId: args.providerId,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
      bridgeLaunch,
    },
  });
}
