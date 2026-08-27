import type {
  SystemExecutionOptionsResponse,
  SystemNativeSessionsQuery,
  SystemNativeSessionsResponse,
  SystemProviderInfo,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

/** Select exactly one provider-discovery host source, or omit both for primary. */
export type ProviderHostRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProviderListArgs = ProviderHostRoutingArgs & {
  capability?: SystemProvidersQuery["capability"];
  signal?: AbortSignal;
};
export type ProviderModelsArgs = ProviderHostRoutingArgs & {
  providerId?: string;
  signal?: AbortSignal;
};
export type ProviderNativeSessionsArgs = ProviderHostRoutingArgs & {
  archived?: boolean;
  cursor?: string;
  limit?: number;
  cwd?: string;
  searchTerm?: string;
  signal?: AbortSignal;
};

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;

export interface ProvidersArea {
  /** List providers on the environment host, explicit host, or primary host. */
  list(args?: ProviderListArgs): Promise<ProviderListResult>;
  /** List models on the environment host, explicit host, or primary host. */
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
  /** List metadata for sessions owned by a provider's native store. */
  nativeSessions(
    providerId: string,
    args?: ProviderNativeSessionsArgs,
  ): Promise<SystemNativeSessionsResponse>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;
  return {
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers.$get(
          {
            query: {
              capability: input.capability,
              environmentId: input.environmentId,
              hostId: input.hostId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async models(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get(
          {
            query: {
              environmentId: input.environmentId,
              hostId: input.hostId,
              providerId: input.providerId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async nativeSessions(providerId, input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers[":id"]["native-sessions"].$get(
          {
            param: { id: providerId },
            query: {
              archived:
                input.archived === undefined
                  ? undefined
                  : input.archived
                    ? "true"
                    : "false",
              cursor: input.cursor,
              limit:
                input.limit === undefined ? undefined : String(input.limit),
              cwd: input.cwd,
              searchTerm: input.searchTerm,
              environmentId: input.environmentId,
              hostId: input.hostId,
            } satisfies SystemNativeSessionsQuery,
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
