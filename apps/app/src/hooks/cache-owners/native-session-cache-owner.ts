import type { QueryClient } from "@tanstack/react-query";

export const allNativeSessionQueryKeyPrefix = ["native-sessions"] as const;

/** Invalidate every active/archived/search page for one provider and host. */
export function invalidateProviderNativeSessions(
  queryClient: QueryClient,
  args: { providerId: string; hostId: string | null },
) {
  return queryClient.invalidateQueries({
    queryKey: [...allNativeSessionQueryKeyPrefix, args.providerId, args.hostId],
  });
}
