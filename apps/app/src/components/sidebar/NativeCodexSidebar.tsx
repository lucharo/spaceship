import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SystemNativeSessionsResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDebounceValue } from "usehooks-ts";
import { Link, useNavigate } from "react-router-dom";
import { sdk } from "@/lib/sdk";
import {
  getThreadRoutePath,
  NATIVE_SESSIONS_ROUTE_PATH,
} from "@/lib/route-paths";
import { useProviderNativeSessions } from "@/hooks/queries/native-session-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";

const SEARCH_DEBOUNCE_MS = 250;

type NativeSession = SystemNativeSessionsResponse["sessions"][number];

export function NativeCodexSidebar({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm] = useDebounceValue(
    searchTerm,
    SEARCH_DEBOUNCE_MS,
  );
  const sessions = useProviderNativeSessions({
    providerId: "codex",
    archived: false,
    limit: 100,
    searchTerm: debouncedSearchTerm,
  });
  const adopt = useMutation({
    mutationFn: async (session: NativeSession) => {
      if (sessions.hostId === null || session.cwd === null) {
        throw new Error("This session has no usable working directory");
      }
      return sdk.threads.adoptNative({
        hostId: sessions.hostId,
        providerId: "codex",
        providerThreadId: session.providerThreadId,
      });
    },
    onSuccess: ({ thread }) => {
      onNavigate?.();
      void navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    },
  });
  const pendingSessionId = adopt.isPending
    ? adopt.variables?.providerThreadId
    : null;
  const failedSessionId = adopt.isError
    ? adopt.variables?.providerThreadId
    : null;
  const searchIsSettling = searchTerm.trim() !== debouncedSearchTerm.trim();

  return (
    <section
      data-testid="native-codex-sidebar"
      className="shrink-0 px-2 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex h-8 items-center gap-2 pl-2 pr-1">
        <span className={cn(CHROME_SECTION_LABEL_CLASS, "min-w-0 flex-1")}>
          Codex sessions
        </span>
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
        >
          <Link
            to={NATIVE_SESSIONS_ROUTE_PATH}
            onClick={onNavigate}
            aria-label="Open active and archived Codex sessions"
          >
            <Icon name="Clock" className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="relative mb-1">
        <Icon
          name="Search"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.currentTarget.value)}
          aria-label="Search Codex sessions"
          placeholder="Search Codex sessions"
          className="h-8 border-sidebar-border bg-sidebar pl-8 pr-8 text-xs"
        />
        {searchIsSettling ? (
          <Icon
            name="Spinner"
            aria-label="Searching"
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      {sessions.hostIsPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading Codex sessions…
        </p>
      ) : sessions.hostId === null ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Connect this machine to list Codex sessions.
        </p>
      ) : sessions.isPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading Codex sessions…
        </p>
      ) : sessions.isError ? (
        <p className="px-2 py-1 text-xs text-destructive">
          Could not load Codex sessions.
        </p>
      ) : sessions.sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {debouncedSearchTerm.trim()
            ? "No matching Codex sessions."
            : "No Codex sessions found."}
        </p>
      ) : (
        <SidebarMenu className="gap-0.5">
          {sessions.sessions.map((session) => {
            const disabled = session.cwd === null || adopt.isPending;
            const isOpening = pendingSessionId === session.providerThreadId;
            const didFail = failedSessionId === session.providerThreadId;
            const title = session.title ?? "Untitled session";
            return (
              <SidebarMenuItem key={session.providerThreadId}>
                <SidebarMenuButton
                  type="button"
                  disabled={disabled}
                  aria-label={`${title}${session.cwd ? `, ${session.cwd}` : ", working directory unavailable"}`}
                  className={cn(
                    "h-auto min-h-8 items-start py-1.5",
                    didFail && "text-destructive",
                  )}
                  onClick={() => adopt.mutate(session)}
                >
                  <Icon
                    name={isOpening ? "Spinner" : "MessageSquare"}
                    className={cn(
                      "mt-0.5 size-3.5 text-muted-foreground",
                      isOpening && "animate-spin",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{title}</span>
                    <span
                      className="block truncate text-[11px] text-muted-foreground"
                      title={session.cwd ?? "Working directory unavailable"}
                    >
                      {didFail
                        ? getMutationErrorMessage({
                            error: adopt.error,
                            fallbackMessage: "Could not open. Click to retry.",
                          })
                        : (session.cwd ?? "Working directory unavailable")}
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          {sessions.hasNextPage ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                disabled={sessions.isFetchingNextPage}
                className="justify-center text-xs text-muted-foreground"
                onClick={() => void sessions.fetchNextPage()}
              >
                {sessions.isFetchingNextPage ? "Loading…" : "Load more"}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      )}
    </section>
  );
}
