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
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NativeSessionsView } from "./NativeSessionsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    providers: { nativeSessions: vi.fn() },
    threads: { adoptNative: vi.fn() },
  },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { primaryHostId: "host_primary" } }),
}));

const nativeSessions: SystemNativeSessionsResponse = {
  sessions: [
    {
      providerThreadId: "native-thread-1",
      title: "Recover the app",
      cwd: "/tmp/spaceship",
      createdAt: 1,
      updatedAt: 2,
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
    title: "Recover the app",
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

function renderView() {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={["/native-sessions"]}>
      <Routes>
        <Route path="/native-sessions" element={<NativeSessionsView />} />
        <Route
          path="/projects/:projectId/threads/:threadId"
          element={<LocationPath />}
        />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NativeSessionsView", () => {
  it("lists metadata and adopts a selected native Codex session", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);
    vi.mocked(sdk.threads.adoptNative).mockResolvedValue(adoptedThread);

    renderView();

    expect(await screen.findByText("Recover the app")).toBeTruthy();
    expect(screen.getByText("/tmp/spaceship")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Recover the app/u }));

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

  it("does not adopt archived native sessions implicitly", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue({
      ...nativeSessions,
      sessions: [{ ...nativeSessions.sessions[0], archived: true }],
    });

    renderView();

    const row = await screen.findByRole("button", {
      name: /Recover the app/u,
    });
    expect(row.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Archived")).toBeTruthy();
    fireEvent.click(row);
    expect(sdk.threads.adoptNative).not.toHaveBeenCalled();
  });

  it("switches between active and archived native metadata", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);

    renderView();
    await screen.findByText("Recover the app");
    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));

    await waitFor(() =>
      expect(sdk.providers.nativeSessions).toHaveBeenLastCalledWith("codex", {
        hostId: "host_primary",
        archived: true,
        limit: 100,
      }),
    );
  });

  it("loads later native catalogue pages", async () => {
    vi.mocked(sdk.providers.nativeSessions)
      .mockResolvedValueOnce({
        ...nativeSessions,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        ...nativeSessions,
        sessions: [
          {
            ...nativeSessions.sessions[0],
            providerThreadId: "native-thread-2",
            title: "Older session",
          },
        ],
      });

    renderView();
    await screen.findByText("Recover the app");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Older session")).toBeTruthy();
    expect(sdk.providers.nativeSessions).toHaveBeenLastCalledWith("codex", {
      hostId: "host_primary",
      archived: false,
      cursor: "page-2",
      limit: 100,
    });
  });

  it("does not show the empty state when catalogue loading fails", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockRejectedValue(
      new Error("catalogue unavailable"),
    );

    renderView();

    expect(
      await screen.findByText("Could not load native sessions."),
    ).toBeTruthy();
    expect(screen.queryByText("No sessions found.")).toBeNull();
  });
});
