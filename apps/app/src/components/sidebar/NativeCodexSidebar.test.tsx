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
import { SidebarProvider } from "@/components/ui/sidebar";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NativeCodexSidebar } from "./NativeCodexSidebar";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    providers: { nativeSessions: vi.fn() },
    threads: { adoptNative: vi.fn() },
  },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { primaryHostId: "host_primary" },
    isPending: false,
  }),
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
            <Route path="/" element={<NativeCodexSidebar />} />
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NativeCodexSidebar", () => {
  it("lists native metadata in the main sidebar and opens the selected session", async () => {
    vi.mocked(sdk.providers.nativeSessions).mockResolvedValue(nativeSessions);
    vi.mocked(sdk.threads.adoptNative).mockResolvedValue(adoptedThread);

    renderSidebar();

    expect(await screen.findByText("Recover a native session")).toBeTruthy();
    expect(screen.getByText("/Users/demo/Projects/spaceship")).toBeTruthy();
    expect(sdk.providers.nativeSessions).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        hostId: "host_primary",
        archived: false,
        limit: 100,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Recover a native session/u }),
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
    fireEvent.change(screen.getByLabelText("Search Codex sessions"), {
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
});
