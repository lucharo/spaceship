import { useMemo, useState } from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  AdoptNativeThreadResponse,
  SystemNativeSessionsResponse,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { Link, useNavigate } from "react-router-dom";
import { useDebounceValue } from "usehooks-ts";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useProviderNativeSessions } from "@/hooks/queries/native-session-queries";
import { invalidateProviderNativeSessions } from "@/hooks/cache-owners/native-session-cache-owner";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  getThreadRoutePath,
  NATIVE_SESSIONS_ROUTE_PATH,
} from "@/lib/route-paths";
import { formatRelativeTime } from "@/lib/relative-time";
import { sdk } from "@/lib/sdk";
import { ProviderLogo } from "@/components/tools/SkillsCollection";

const SEARCH_DEBOUNCE_MS = 250;
function storageKey(providerId: string, field: string): string {
  return `spaceship.sidebar.${providerId}.${field}`;
}

type NativeSession = SystemNativeSessionsResponse["sessions"][number];
type ThreadOrganization = "chronological" | "project";
type AdoptMutation = UseMutationResult<
  AdoptNativeThreadResponse,
  Error,
  NativeSession
>;
type ArchiveMutation = UseMutationResult<NativeSession, Error, NativeSession>;

interface NativeSessionGroup {
  key: string;
  label: string;
  sessions: NativeSession[];
}

function readStoredStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredStringArray(key: string, values: ReadonlySet<string>) {
  window.localStorage.setItem(key, JSON.stringify([...values]));
}

function nativeTimestampToMilliseconds(timestamp: number): number {
  return timestamp < 100_000_000_000 ? timestamp * 1_000 : timestamp;
}

function getSessionTimestamp(session: NativeSession): number {
  return nativeTimestampToMilliseconds(session.updatedAt ?? session.createdAt);
}

function getProjectLabel(cwd: string | null): string {
  if (cwd === null) return "Working directory unavailable";
  const normalized = cwd.replace(/\/+$/u, "");
  if (/^\/(?:Users|home)\/[^/]+$/u.test(normalized)) return "Home";
  return normalized.split("/").at(-1) || normalized || "/";
}

function getRepositoryLabel(repositoryUrl: string): string {
  const normalized = repositoryUrl
    .replace(/\.git$/iu, "")
    .replace(/\/+$/u, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "")
    .replace(/^[^@/]+@/u, "")
    .replace(":", "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? repositoryUrl;
}

function isCodexWorktreePath(cwd: string | null): boolean {
  return cwd?.includes("/.codex/worktrees/") ?? false;
}

function getChronologicalGroup(timestamp: number, now: number) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1_000;
  const start = startOfToday.getTime();

  if (timestamp >= start) return { key: "today", label: "Today" };
  if (timestamp >= start - dayMs) {
    return { key: "yesterday", label: "Yesterday" };
  }
  if (timestamp >= start - 7 * dayMs) {
    return { key: "previous-7-days", label: "Previous 7 days" };
  }
  if (timestamp >= start - 30 * dayMs) {
    return { key: "previous-30-days", label: "Previous 30 days" };
  }
  return { key: "older", label: "Older" };
}

function groupSessions({
  organization,
  sessions,
  now,
}: {
  organization: ThreadOrganization;
  sessions: NativeSession[];
  now: number;
}): NativeSessionGroup[] {
  const grouped = new Map<string, NativeSessionGroup>();

  for (const session of sessions) {
    const descriptor =
      organization === "project"
        ? {
            key: `project:${session.repositoryUrl ?? session.workspaceRoot ?? session.projectId ?? session.cwd ?? "unavailable"}`,
            label:
              session.repositoryUrl === undefined ||
              session.repositoryUrl === null
                ? getProjectLabel(session.workspaceRoot ?? session.cwd)
                : getRepositoryLabel(session.repositoryUrl),
          }
        : getChronologicalGroup(getSessionTimestamp(session), now);
    const group = grouped.get(descriptor.key) ?? {
      ...descriptor,
      sessions: [],
    };
    group.sessions.push(session);
    if (
      organization === "project" &&
      session.workspaceRoot === null &&
      !isCodexWorktreePath(session.cwd) &&
      isCodexWorktreePath(group.sessions[0]?.cwd ?? null)
    ) {
      group.label = getProjectLabel(session.cwd);
    }
    grouped.set(descriptor.key, group);
  }

  return [...grouped.values()];
}

function NativeSessionRow({
  adopt,
  archive,
  isPinned,
  now,
  onTogglePinned,
  providerReady,
  providerId,
  session,
}: {
  adopt: AdoptMutation;
  archive: ArchiveMutation;
  isPinned: boolean;
  now: number;
  onTogglePinned: (session: NativeSession) => void;
  providerReady: boolean;
  providerId: string;
  session: NativeSession;
}) {
  const disabled = !providerReady || session.cwd === null || adopt.isPending;
  const isOpening =
    adopt.isPending &&
    adopt.variables?.providerThreadId === session.providerThreadId;
  const didFail =
    adopt.isError &&
    adopt.variables?.providerThreadId === session.providerThreadId;
  const title = session.title ?? "Untitled session";
  const relativeTime = formatRelativeTime({
    timestamp: getSessionTimestamp(session),
    now,
  });
  const isArchiving =
    archive.isPending &&
    archive.variables?.providerThreadId === session.providerThreadId;

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuButton
            type="button"
            disabled={disabled || isArchiving}
            aria-label={`${title}${session.cwd ? `, ${session.cwd}` : ", working directory unavailable"}`}
            className={cn(
              "h-auto min-h-10 items-start py-1.5 pr-14",
              didFail && "text-destructive",
            )}
            onClick={() => adopt.mutate(session)}
          >
            <span
              data-provider-icon={providerId}
              className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
            >
              {isOpening || isArchiving || session.status === "active" ? (
                <Icon
                  name="Spinner"
                  aria-label={`${title} is active`}
                  className="size-3.5 animate-spin"
                />
              ) : (
                <ProviderLogo providerId={providerId} className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeTime}
                </span>
              </span>
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => adopt.mutate(session)}>
            Open
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onTogglePinned(session)}>
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => archive.mutate(session)}
          >
            Archive
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${isPinned ? "Unpin" : "Pin"} ${title}`}
        className={cn(
          "absolute right-7 top-1 size-7 text-muted-foreground",
          !isPinned &&
            "opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePinned(session);
        }}
      >
        <Icon name={isPinned ? "PinOff" : "Pin"} className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Archive ${title}`}
        className="absolute right-0.5 top-1 size-7 text-muted-foreground opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          archive.mutate(session);
        }}
      >
        <Icon name="Archive" className="size-3.5" />
      </Button>
    </SidebarMenuItem>
  );
}

function NativeSessionSection({
  adopt,
  archive,
  collapsed,
  group,
  now,
  pinnedIds,
  onToggleCollapsed,
  onTogglePinned,
  providerReady,
  providerId,
}: {
  adopt: AdoptMutation;
  archive: ArchiveMutation;
  collapsed: boolean;
  group: NativeSessionGroup;
  now: number;
  pinnedIds: ReadonlySet<string>;
  onToggleCollapsed: (key: string) => void;
  onTogglePinned: (session: NativeSession) => void;
  providerReady: boolean;
  providerId: string;
}) {
  return (
    <div>
      <button
        type="button"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label}`}
        className="flex h-7 w-full items-center gap-1 px-2 text-left text-xs text-muted-foreground hover:text-sidebar-foreground"
        onClick={() => onToggleCollapsed(group.key)}
      >
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 transition-transform",
            collapsed && "-rotate-90",
          )}
        />
        <span className="truncate">{group.label}</span>
        <span className="ml-auto tabular-nums">{group.sessions.length}</span>
      </button>
      {collapsed ? null : (
        <SidebarMenu className="gap-0.5">
          {group.sessions.map((session) => (
            <NativeSessionRow
              key={session.providerThreadId}
              adopt={adopt}
              archive={archive}
              isPinned={pinnedIds.has(session.providerThreadId)}
              now={now}
              onTogglePinned={onTogglePinned}
              providerReady={providerReady}
              providerId={providerId}
              session={session}
            />
          ))}
        </SidebarMenu>
      )}
    </div>
  );
}

export function NativeSessionThreadList({
  providerId,
  providerLabel,
  onNavigate,
}: {
  providerId: string;
  providerLabel: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [organization, setOrganization] = useState<ThreadOrganization>(() =>
    window.localStorage.getItem(storageKey(providerId, "organization")) ===
    "project"
      ? "project"
      : "chronological",
  );
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(readStoredStringArray(storageKey(providerId, "pinnedThreadIds"))),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () =>
      new Set(readStoredStringArray(storageKey(providerId, "collapsedGroups"))),
  );
  const [now] = useState(Date.now);
  const [debouncedSearchTerm] = useDebounceValue(
    searchTerm,
    SEARCH_DEBOUNCE_MS,
  );
  const sessions = useProviderNativeSessions({
    providerId,
    archived: false,
    limit: 100,
    replayLastKnown: true,
    searchTerm: debouncedSearchTerm,
  });
  const adopt = useMutation<AdoptNativeThreadResponse, Error, NativeSession>({
    mutationFn: async (session) => {
      if (sessions.hostId === null || session.cwd === null) {
        throw new Error("This session has no usable working directory");
      }
      return sdk.threads.adoptNative({
        hostId: sessions.hostId,
        providerId,
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
  const archive = useMutation<NativeSession, Error, NativeSession>({
    mutationFn: async (session) => {
      if (sessions.hostId === null || session.cwd === null) {
        throw new Error("This session has no usable working directory");
      }
      const adopted = await sdk.threads.adoptNative({
        hostId: sessions.hostId,
        providerId,
        providerThreadId: session.providerThreadId,
      });
      await sdk.threads.archiveAll({ threadId: adopted.thread.id });
      return session;
    },
    onSuccess: () => {
      void invalidateProviderNativeSessions(queryClient, {
        providerId,
        hostId: sessions.hostId,
      });
    },
  });
  const searchIsSettling = searchTerm.trim() !== debouncedSearchTerm.trim();
  const sortedSessions = useMemo(
    () =>
      [...sessions.sessions].sort(
        (left, right) => getSessionTimestamp(right) - getSessionTimestamp(left),
      ),
    [sessions.sessions],
  );
  const pinnedSessions = sortedSessions.filter((session) =>
    pinnedIds.has(session.providerThreadId),
  );
  const unpinnedSessions = sortedSessions.filter(
    (session) => !pinnedIds.has(session.providerThreadId),
  );
  const groups = useMemo(() => {
    const sessionGroups = groupSessions({
      organization,
      sessions: unpinnedSessions,
      now,
    });
    return pinnedSessions.length === 0
      ? sessionGroups
      : [
          {
            key: "pinned",
            label: "Pinned",
            sessions: pinnedSessions,
          },
          ...sessionGroups,
        ];
  }, [now, organization, pinnedSessions, unpinnedSessions]);

  const togglePinned = (session: NativeSession) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(session.providerThreadId)) {
        next.delete(session.providerThreadId);
      } else {
        next.add(session.providerThreadId);
      }
      writeStoredStringArray(storageKey(providerId, "pinnedThreadIds"), next);
      return next;
    });
  };
  const toggleCollapsed = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeStoredStringArray(storageKey(providerId, "collapsedGroups"), next);
      return next;
    });
  };
  const chooseOrganization = (next: ThreadOrganization) => {
    setOrganization(next);
    window.localStorage.setItem(storageKey(providerId, "organization"), next);
  };

  return (
    <nav
      data-testid="native-codex-sidebar"
      aria-label={`${providerLabel} threads`}
      className="min-h-0 flex-1 overflow-y-auto px-2 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex h-8 items-center gap-1 pl-2 pr-1">
        <span
          className={cn(
            CHROME_SECTION_LABEL_CLASS,
            "min-w-0 flex-1 text-muted-foreground",
          )}
        >
          Threads
        </span>
        <span className="text-[10px] text-muted-foreground">
          {providerLabel}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Thread display options"
              className="size-7 text-muted-foreground"
            >
              <Icon name="SlidersHorizontal" className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" mobileTitle="Thread display options">
            <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
              Organize
            </DropdownMenuLabel>
            <DropdownMenuGroup aria-label="Organize">
              <DropdownMenuCheckboxItem
                checked={organization === "chronological"}
                onCheckedChange={() => chooseOrganization("chronological")}
              >
                Chronologically
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={organization === "project"}
                onCheckedChange={() => chooseOrganization("project")}
              >
                By project
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={CHROME_SECTION_LABEL_CLASS}>
              Provider
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem checked disabled>
                {providerLabel}
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
          aria-label={`Search ${providerLabel} threads`}
          placeholder={`Search ${providerLabel} threads`}
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

      {sessions.hostIsPending && sessions.sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading Codex threads…
        </p>
      ) : sessions.hostId === null && !sessions.hostIsPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Connect this machine to list Codex threads.
        </p>
      ) : sessions.isPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading Codex threads…
        </p>
      ) : sessions.isError ? (
        <p className="px-2 py-1 text-xs text-destructive">
          Could not load Codex threads.
        </p>
      ) : sessions.sessions.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {debouncedSearchTerm.trim()
            ? "No matching Codex threads."
            : "No Codex threads found."}
        </p>
      ) : (
        <div className="space-y-1">
          {groups.map((group) => (
            <NativeSessionSection
              key={group.key}
              adopt={adopt}
              archive={archive}
              collapsed={collapsedGroups.has(group.key)}
              group={group}
              now={now}
              pinnedIds={pinnedIds}
              onToggleCollapsed={toggleCollapsed}
              onTogglePinned={togglePinned}
              providerId={providerId}
              providerReady={sessions.hostId !== null}
            />
          ))}
          {sessions.hasNextPage ? (
            <SidebarMenu>
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
            </SidebarMenu>
          ) : null}
        </div>
      )}
    </nav>
  );
}
