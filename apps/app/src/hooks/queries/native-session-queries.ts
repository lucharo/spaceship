import { useInfiniteQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  nativeSessionCacheKey,
  readCachedNativeSessions,
  readLastNativeSessionHostId,
  writeCachedNativeSessions,
  writeLastNativeSessionHostId,
} from "@/lib/native-session-cache";
import { useSystemConfig } from "./system-queries";

interface UseProviderNativeSessionsArgs {
  providerId: string;
  archived?: boolean;
  limit?: number;
  replayLastKnown?: boolean;
  searchTerm?: string;
}

export function nativeSessionsQueryKey({
  providerId,
  hostId,
  archived,
  searchTerm,
}: {
  providerId: string;
  hostId: string | null;
  archived: boolean;
  searchTerm: string | null;
}) {
  return ["native-sessions", providerId, hostId, archived, searchTerm] as const;
}

export function useProviderNativeSessions({
  providerId,
  archived = false,
  limit = 100,
  replayLastKnown = false,
  searchTerm,
}: UseProviderNativeSessionsArgs) {
  const systemConfig = useSystemConfig();
  const hostId = systemConfig.data?.primaryHostId ?? null;
  const normalizedSearchTerm = searchTerm?.trim() || null;
  const replayHostId =
    hostId ??
    (replayLastKnown ? readLastNativeSessionHostId(providerId) : null);
  const cacheKey = nativeSessionCacheKey({
    providerId,
    hostId: replayHostId,
    archived,
  });
  const placeholder =
    replayLastKnown && normalizedSearchTerm === null && replayHostId !== null
      ? readCachedNativeSessions(cacheKey)
      : null;
  const query = useInfiniteQuery({
    queryKey: nativeSessionsQueryKey({
      providerId,
      hostId,
      archived,
      searchTerm: normalizedSearchTerm,
    }),
    enabled: hostId !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await sdk.providers.nativeSessions(providerId, {
        hostId: hostId as string,
        archived,
        cursor: pageParam ?? undefined,
        limit,
        searchTerm: normalizedSearchTerm ?? undefined,
        signal,
      });
      if (
        replayLastKnown &&
        pageParam === null &&
        normalizedSearchTerm === null
      ) {
        writeCachedNativeSessions(
          nativeSessionCacheKey({ providerId, hostId, archived }),
          response,
        );
        writeLastNativeSessionHostId(providerId, hostId as string);
      }
      return response;
    },
    placeholderData:
      placeholder === null
        ? undefined
        : { pages: [placeholder], pageParams: [null] },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (activeQuery) => {
      const pages = activeQuery.state.data?.pages ?? [];
      return pages.some((page) =>
        page.sessions.some((session) => session.status === "active"),
      )
        ? 5_000
        : 60_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    hostId,
    hostIsPending: systemConfig.isPending,
    sessions: query.data?.pages.flatMap((page) => page.sessions) ?? [],
  };
}
