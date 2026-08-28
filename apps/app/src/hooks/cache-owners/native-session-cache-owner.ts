import type { QueryClient } from "@tanstack/react-query";

/** Invalidate every active/archived/search page for one provider and host. */
export function invalidateProviderNativeSessions(
  queryClient: QueryClient,
  args: { providerId: string; hostId: string | null },
) {
  return queryClient.invalidateQueries({
    queryKey: ["native-sessions", args.providerId, args.hostId],
  });
}
