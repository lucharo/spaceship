// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  AdoptNativeThreadResponse,
  SystemNativeSessionsResponse,
} from "@bb/server-contract";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { sdk } from "@/lib/sdk";
import {
  nativeSessionCacheKey,
  writeLastNativeSessionHostId,
  writeCachedNativeSessions,
} from "@/lib/native-session-cache";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NativeSessionThreadList } from "./NativeCodexSidebar";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    providers: { nativeSessions: vi.fn() },
    threads: { adoptNative: vi.fn(), archiveAll: vi.fn() },
  },
}));

const systemConfigResult: {
  data: { primaryHostId: string } | undefined;
  isPending: boolean;
} = {
  data: { primaryHostId: "host_primary" },
  isPending: false,
};

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => systemConfigResult,
}));

vi.mock("usehooks-ts", () => ({
  useDebounceValue: <T,>(value: T) => [value],
}));

const nativeSessions: SystemNativeSessionsResponse = {
  sessions: [
    {
      providerThreadId: "native-thread-1",
      title: "Recover a native session",
      cwd: "/Users/demo/Projects/spaceship",
      createdAt: 1_777_000_000,
      updatedAt: 1_777_000_100,
      archived: false,
      source: "cli",
    },
  ],
  nextCursor: null,
  backwardsCursor: null,
};

const adoptedThread: AdoptNativeThreadResponse = {
  created: true,
  thread: {
    id: "thr_adopted",
    projectId: "prj_spaceship",
    environmentId: "env_spaceship",
    providerId: "codex",
    title: "Recover a native session",
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activeBackgroundAgentCount: 0,
    canSpawnChild: true,
  },
};

function LocationPath() {
  return <span>{useLocation().pathname}</span>;
}

function renderSidebar() {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryWrapper>
        <SidebarProvider>
          <Routes>
            <Route
              path="/"
              element={
                <NativeSessionThreadList
                  providerId="codex"
                  providerLabel="Codex"
                />
              }
            />
            <Route
              path="/projects/:projectId/threads/:threadId"
              element={<LocationPath />}
            />
          </Routes>
        </SidebarProvider>
      </QueryWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  systemConfigResult.data = { primaryHostId: "host_primary" };
  systemConfigResult.isPending = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("NativeSessionThreadList", () => {
  it("lists native metadata in the main sidebar and opens the selected session", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);
    vi.mocked(sdk.threads.adoptNative).mockResolvedValue(adoptedThread);

    renderSidebar();

    expect(await screen.findByText("Threads")).toBeTruthy();
    expect(await screen.findByText("Recover a native session")).toBeTruthy();
    expect(screen.getByText("/Users/demo/Projects/spaceship")).toBeTruthy();
    expect(screen.queryByText("Codex sessions")).toBeNull();
    expect(sdk.providers.nativeSessions).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        hostId: "host_primary",
        archived: false,
        limit: 100,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /^Recover a native session,/u,
      }),
    );

    await waitFor(() =>
      expect(sdk.threads.adoptNative).toHaveBeenCalledWith({
        hostId: "host_primary",
        providerId: "codex",
        providerThreadId: "native-thread-1",
      }),
    );
    expect(
      await screen.findByText("/projects/prj_spaceship/threads/thr_adopted"),
    ).toBeTruthy();
  });

  it("searches the provider-native catalogue rather than filtering copied rows", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);

    renderSidebar();
    await screen.findByText("Recover a native session");
    fireEvent.change(screen.getByLabelText("Search Codex threads"), {
      target: { value: "recovery" },
    });

    await waitFor(() =>
      expect(sdk.providers.nativeSessions).toHaveBeenLastCalledWith(
        "codex",
        expect.objectContaining({ searchTerm: "recovery" }),
      ),
    );
  });

  it("paginates inside the sidebar", async () => {
    vi.mocked(sdk.providers.nativeSessions)
      .mockResolvedValueOnce({ ...nativeSessions, nextCursor: "page-2" })
      .mockResolvedValueOnce({
        ...nativeSessions,
        sessions: [
          {
            ...nativeSessions.sessions[0],
            providerThreadId: "native-thread-2",
            title: "Older native session",
          },
        ],
      });

    renderSidebar();
    await screen.findByText("Recover a native session");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Older native session")).toBeTruthy();
    expect(sdk.providers.nativeSessions).toHaveBeenLastCalledWith(
      "codex",
      expect.objectContaining({ cursor: "page-2" }),
    );
  });

  it("organizes native threads by date or project and collapses groups", async () => {
    const now = new Date("2026-08-28T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue({
      ...nativeSessions,
      sessions: [
        {
          ...nativeSessions.sessions[0],
          updatedAt: Math.floor((now - 60_000) / 1_000),
        },
        {
          ...nativeSessions.sessions[0],
          providerThreadId: "native-thread-2",
          title: "Review another project",
          cwd: "/Users/demo/Projects/another-project",
          updatedAt: Math.floor((now - 2 * 24 * 60 * 60 * 1_000) / 1_000),
        },
      ],
    });

    renderSidebar();

    expect(await screen.findByText("Today")).toBeTruthy();
    expect(screen.getByText("Previous 7 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Today" }));
    expect(screen.queryByText("Recover a native session")).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread display options" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "By project" }),
    );

    expect(await screen.findByText("spaceship")).toBeTruthy();
    expect(screen.getByText("another-project")).toBeTruthy();
  });

  it("pins native threads without copying provider history", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);

    renderSidebar();
    await screen.findByText("Recover a native session");
    fireEvent.click(
      screen.getByRole("button", { name: "Pin Recover a native session" }),
    );

    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "spaceship.sidebar.codex.pinnedThreadIds",
        ) ?? "[]",
      ),
    ).toEqual(["native-thread-1"]);
    expect(sdk.threads.adoptNative).not.toHaveBeenCalled();
  });

  it("archives a native thread through the provider-backed thread lifecycle", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);
    vi.mocked(sdk.threads.adoptNative).mockResolvedValue(adoptedThread);
    vi.mocked(sdk.threads.archiveAll).mockResolvedValue({
      ok: true,
      archivedThreadIds: [adoptedThread.thread.id],
    });

    renderSidebar();
    await screen.findByText("Recover a native session");
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Recover a native session" }),
    );

    await waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
        threadId: adoptedThread.thread.id,
      }),
    );
  });

  it("paints cached native metadata before the live refresh completes", async () => {
    writeCachedNativeSessions(
      nativeSessionCacheKey({
        providerId: "codex",
        hostId: "host_primary",
        archived: false,
      }),
      nativeSessions,
    );
    vi.mocked(sdk.providers.nativeSessions).mockImplementation(
      () => new Promise(() => undefined),
    );

    renderSidebar();

    expect(await screen.findByText("Recover a native session")).toBeTruthy();
    expect(sdk.providers.nativeSessions).toHaveBeenCalledTimes(1);
  });

  it("replays the last host cache while system configuration loads", async () => {
    writeLastNativeSessionHostId("codex", "host_primary");
    writeCachedNativeSessions(
      nativeSessionCacheKey({
        providerId: "codex",
        hostId: "host_primary",
        archived: false,
      }),
      nativeSessions,
    );
    systemConfigResult.data = undefined;
    systemConfigResult.isPending = true;
    vi.mocked(sdk.providers.nativeSessions).mockImplementation(
      () => new Promise(() => undefined),
    );

    renderSidebar();

    expect(screen.getByText("Recover a native session")).toBeTruthy();
    expect(screen.queryByText("Loading Codex threads…")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /^Recover a native session,/u,
      }).disabled,
    ).toBe(true);
    expect(sdk.providers.nativeSessions).not.toHaveBeenCalled();
  });
});
