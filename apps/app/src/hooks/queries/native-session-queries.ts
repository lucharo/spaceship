import { useInfiniteQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { useSystemConfig } from "./system-queries";

interface UseProviderNativeSessionsArgs {
  providerId: string;
  archived?: boolean;
  limit?: number;
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
  searchTerm,
}: UseProviderNativeSessionsArgs) {
  const systemConfig = useSystemConfig();
  const hostId = systemConfig.data?.primaryHostId ?? null;
  const normalizedSearchTerm = searchTerm?.trim() || null;
  const query = useInfiniteQuery({
    queryKey: nativeSessionsQueryKey({
      providerId,
      hostId,
      archived,
      searchTerm: normalizedSearchTerm,
    }),
    enabled: hostId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      sdk.providers.nativeSessions(providerId, {
        hostId: hostId as string,
        archived,
        cursor: pageParam ?? undefined,
        limit,
        searchTerm: normalizedSearchTerm ?? undefined,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  return {
    ...query,
    hostId,
    hostIsPending: systemConfig.isPending,
    sessions: query.data?.pages.flatMap((page) => page.sessions) ?? [],
  };
}
