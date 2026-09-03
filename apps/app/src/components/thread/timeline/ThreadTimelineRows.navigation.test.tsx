// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TimelineRow } from "@bb/server-contract";
import {
  conversationRow,
  delegationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";

const turnDetails = vi.hoisted(() => ({
  rows: [] as TimelineRow[],
}));

vi.mock("@/hooks/queries/thread-queries", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/queries/thread-queries")
  >("@/hooks/queries/thread-queries");
  return {
    ...actual,
    useThreadTimelineTurnSummaryDetails: vi.fn(() => ({
      data: { rows: turnDetails.rows },
      isError: false,
      refetch: vi.fn(),
    })),
  };
});

const { ThreadTimelineRows } = await import("./ThreadTimelineRows");

afterEach(() => {
  cleanup();
  turnDetails.rows = [];
  vi.clearAllMocks();
});

it("propagates an outline target into lazily loaded nested turn details", async () => {
  turnDetails.rows = [
    delegationRow({
      id: "lazy_delegation",
      sourceSeqStart: 11,
      sourceSeqEnd: 13,
      threadId: "thr_main",
      childRows: [
        conversationRow({
          id: "lazy_nested_target",
          role: "assistant",
          text: "Nested target loaded from turn details.",
          sourceSeqStart: 12,
          sourceSeqEnd: 12,
          threadId: "thr_main",
        }),
      ],
    }),
  ];

  const { container } = render(
    <MemoryRouter>
      <ThreadTimelineRows
        threadId="thr_main"
        timelineNavigationTargetRowId="lazy_nested_target"
        timelineNavigationTargetSeq={12}
        timelineRows={[
          turnRow({
            id: "lazy_turn",
            sourceSeqStart: 10,
            sourceSeqEnd: 20,
            children: null,
            threadId: "thr_main",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />
    </MemoryRouter>,
  );

  await waitFor(() =>
    expect(
      container.querySelector('[data-timeline-row-id="lazy_nested_target"]'),
    ).not.toBeNull(),
  );
});
