import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SystemNativeSessionsResponse } from "@bb/server-contract";
import { useNavigate, useSearchParams } from "react-router-dom";
import { sdk } from "@/lib/sdk";
import { useProviderNativeSessions } from "@/hooks/queries/native-session-queries";
import { getThreadRoutePath } from "@/lib/route-paths";

export function NativeSessionsView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get("provider");
  const [archived, setArchived] = useState(false);
  const sessions = useProviderNativeSessions({
    providerId: providerId ?? "",
    archived,
    enabled: providerId !== null,
  });
  const adopt = useMutation({
    mutationFn: async (
      session: SystemNativeSessionsResponse["sessions"][number],
    ) => {
      if (
        providerId === null ||
        sessions.hostId === null ||
        session.cwd === null
      ) {
        throw new Error("This session has no usable working directory");
      }
      return sdk.threads.adoptNative({
        hostId: sessions.hostId,
        providerId,
        providerThreadId: session.providerThreadId,
      });
    },
    onSuccess: ({ thread }) => {
      void navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    },
  });

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4 overflow-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Native sessions</h1>
          <p className="text-sm text-muted-foreground">
            Only metadata is listed. Opening links the native session without
            copying its history into Spaceship.
          </p>
        </div>
        {providerId !== null ? (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={() => setArchived((value) => !value)}
          >
            {archived ? "Show active" : "Show archived"}
          </button>
        ) : null}
      </div>
      {providerId === null ? (
        <p className="text-sm text-muted-foreground">
          Choose a provider's native session catalogue from the Threads sidebar.
        </p>
      ) : null}
      {providerId !== null && sessions.hostIsPending ? (
        <p>Loading native sessions…</p>
      ) : null}
      {providerId !== null &&
      !sessions.hostIsPending &&
      sessions.hostId === null ? (
        <p className="text-sm text-muted-foreground">
          Connect this machine to list native sessions.
        </p>
      ) : null}
      {providerId !== null && sessions.hostId !== null && sessions.isPending ? (
        <p>Loading native sessions…</p>
      ) : null}
      {sessions.isError ? (
        <p className="text-sm text-destructive">
          Could not load native sessions.
        </p>
      ) : null}
      {providerId !== null ? (
        <div className="divide-y rounded-lg border">
          {sessions.sessions.map((session) => (
            <button
              key={session.providerThreadId}
              type="button"
              disabled={
                session.archived || session.cwd === null || adopt.isPending
              }
              className="flex w-full items-start justify-between gap-4 p-3 text-left hover:bg-muted/50 disabled:opacity-50"
              onClick={() => adopt.mutate(session)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {session.title ?? "Untitled"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {session.cwd ?? "Working directory unavailable"}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {session.archived ? "Archived" : "Open"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {providerId !== null && sessions.hasNextPage ? (
        <button
          type="button"
          className="self-center rounded-md border px-3 py-1.5 text-sm"
          disabled={sessions.isFetchingNextPage}
          onClick={() => void sessions.fetchNextPage()}
        >
          {sessions.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {sessions.sessions.length === 0 &&
      providerId !== null &&
      sessions.hostId !== null &&
      !sessions.isPending &&
      !sessions.isError ? (
        <p className="text-sm text-muted-foreground">No sessions found.</p>
      ) : null}
      {adopt.isError ? (
        <p className="text-sm text-destructive">Could not open that session.</p>
      ) : null}
    </section>
  );
}
