import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { sdk } from "@/lib/sdk";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getThreadRoutePath } from "@/lib/route-paths";

export function NativeSessionsView() {
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const hostId = useSystemConfig().data?.primaryHostId ?? null;
  const sessions = useQuery({
    queryKey: ["native-sessions", "codex", hostId, archived],
    enabled: hostId !== null,
    queryFn: () =>
      sdk.providers.nativeSessions("codex", {
        hostId: hostId as string,
        archived,
        limit: 100,
      }),
  });
  const adopt = useMutation({
    mutationFn: async (
      session: NonNullable<typeof sessions.data>["sessions"][number],
    ) => {
      if (hostId === null || session.cwd === null) {
        throw new Error("This session has no usable working directory");
      }
      return sdk.threads.adoptNative({
        hostId,
        cwd: session.cwd,
        providerId: "codex",
        providerThreadId: session.providerThreadId,
        title: session.title,
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
          <h1 className="text-xl font-semibold">Native Codex sessions</h1>
          <p className="text-sm text-muted-foreground">
            Only metadata is listed. Opening links the native session without
            copying its history into Spaceship.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={() => setArchived((value) => !value)}
        >
          {archived ? "Show active" : "Show archived"}
        </button>
      </div>
      {sessions.isPending ? <p>Loading native sessions…</p> : null}
      {sessions.isError ? (
        <p className="text-sm text-destructive">
          Could not load native sessions.
        </p>
      ) : null}
      <div className="divide-y rounded-lg border">
        {sessions.data?.sessions.map((session) => (
          <button
            key={session.providerThreadId}
            type="button"
            disabled={session.cwd === null || adopt.isPending}
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
            <span className="shrink-0 text-xs text-muted-foreground">Open</span>
          </button>
        ))}
      </div>
      {sessions.data?.sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions found.</p>
      ) : null}
      {adopt.isError ? (
        <p className="text-sm text-destructive">Could not open that session.</p>
      ) : null}
    </section>
  );
}
