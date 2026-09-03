// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ThreadTimelineSurfaceProps } from "@/components/thread/timeline/ThreadTimelineSurface";

vi.mock("@/components/thread/timeline/ThreadTimelineSurface", () => ({
  ThreadTimelineSurface: (props: ThreadTimelineSurfaceProps) => (
    <div data-testid="timeline">
      <span data-testid="plugin-panel-opener">
        {props.onOpenPluginPanel === undefined ? "missing" : "available"}
      </span>
      <span data-testid="navigation-target">
        {props.timelineNavigationTargetRowId ?? "none"}:
        {props.timelineNavigationTargetSeq ?? "none"}
      </span>
    </div>
  ),
}));

vi.mock("@/components/thread/toc/ThreadTableOfContents", () => ({
  ThreadTableOfContents: ({
    onNavigateToRow,
  }: {
    onNavigateToRow?: (
      rowId: string,
      sourceSeq?: number,
    ) => void | (() => void);
  }) => (
    <>
      <button
        type="button"
        onClick={() => {
          const settle = onNavigateToRow?.("row-target", 42);
          if (settle) navigationSettlers.push(settle);
        }}
      >
        Jump to first row
      </button>
      <button
        type="button"
        onClick={() => {
          const settle = onNavigateToRow?.("newer-target", 84);
          if (settle) navigationSettlers.push(settle);
        }}
      >
        Jump to newer row
      </button>
    </>
  ),
}));

const { ThreadTimelinePane } = await import("./ThreadTimelinePane");

const navigationSettlers: Array<() => void> = [];

afterEach(() => {
  cleanup();
  navigationSettlers.length = 0;
});

it("forwards pane callbacks and scopes outline navigation to one thread", () => {
  const props = {
    activeThinking: null,
    canSpawnChild: false,
    footer: null,
    hasOlderTimelineRows: false,
    isLoadingOlderTimelineRows: false,
    isStopping: false,
    isThreadTimelinePending: false,
    onLoadOlderRows: () => undefined,
    onOpenPluginPanel: vi.fn(() => true),
    projectId: "proj_1",
    resolveMentionLink: () => null,
    showOngoingIndicator: false,
    stoppingAnchorAt: 0,
    threadRuntimeDisplayStatus: "idle" as const,
    timelineError: false,
    timelineRows: [],
    unreadDividerAutoScroll: false,
    unreadDividerPlacement: null,
    workspaceRootPath: undefined,
  };
  const view = render(<ThreadTimelinePane {...props} threadId="thr_1" />);

  expect(screen.getByTestId("plugin-panel-opener").textContent).toBe(
    "available",
  );
  expect(screen.getByTestId("navigation-target").textContent).toBe("none:none");
  fireEvent.click(screen.getByRole("button", { name: "Jump to first row" }));
  expect(screen.getByTestId("navigation-target").textContent).toBe(
    "row-target:42",
  );

  view.rerender(<ThreadTimelinePane {...props} threadId="thr_2" />);
  expect(screen.getByTestId("navigation-target").textContent).toBe("none:none");
  view.rerender(<ThreadTimelinePane {...props} threadId="thr_1" />);
  expect(screen.getByTestId("navigation-target").textContent).toBe("none:none");

  fireEvent.click(screen.getByRole("button", { name: "Jump to first row" }));
  fireEvent.click(screen.getByRole("button", { name: "Jump to newer row" }));
  expect(screen.getByTestId("navigation-target").textContent).toBe(
    "newer-target:84",
  );
  act(() => navigationSettlers[1]?.());
  expect(screen.getByTestId("navigation-target").textContent).toBe(
    "newer-target:84",
  );
  act(() => navigationSettlers[2]?.());
  expect(screen.getByTestId("navigation-target").textContent).toBe("none:none");
});
