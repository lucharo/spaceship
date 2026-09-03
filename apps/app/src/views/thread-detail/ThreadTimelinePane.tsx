import { useMemo, useState, type ReactNode } from "react";
import type { ThreadTimelineUnreadDividerPlacement } from "@/components/thread/timeline";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { EmbeddedThreadChat } from "@/components/thread/embedded-chat";
import type { ThreadTimelineSurfaceProps } from "@/components/thread/timeline/ThreadTimelineSurface";
import { ThreadTableOfContents } from "@/components/thread/toc/ThreadTableOfContents";

interface ThreadTimelinePaneProps extends ThreadTimelineSurfaceProps {
  canSpawnChild: boolean;
  footer: ReactNode;
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  isStopping: boolean;
  onLoadOlderRows: () => void;
  resolveMentionLink: PromptMentionLinkResolver;
  stoppingAnchorAt: number;
  unreadDividerAutoScroll: boolean;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
}

export function ThreadTimelinePane({
  footer,
  ...surface
}: ThreadTimelinePaneProps) {
  const [timelineNavigationTarget, setTimelineNavigationTarget] = useState<{
    threadId: string;
    rowId: string;
    sourceSeq?: number;
    token: symbol;
    visit: symbol;
  } | null>(null);
  const navigationVisit = useMemo(
    () => Symbol(surface.threadId),
    [surface.threadId],
  );
  const activeTimelineNavigationTarget =
    timelineNavigationTarget?.threadId === surface.threadId &&
    timelineNavigationTarget.visit === navigationVisit
      ? timelineNavigationTarget
      : null;
  return (
    <EmbeddedThreadChat
      variant="hosted-footer"
      footer={footer}
      scrollOverlay={
        <ThreadTableOfContents
          threadId={surface.threadId}
          timelineRows={surface.timelineRows}
          hasOlderTimelineRows={surface.hasOlderTimelineRows}
          loadOlderTimelineRows={surface.onLoadOlderRows}
          onNavigateToRow={(rowId, sourceSeq) => {
            const token = Symbol(rowId);
            setTimelineNavigationTarget({
              threadId: surface.threadId,
              rowId,
              sourceSeq,
              token,
              visit: navigationVisit,
            });
            return () => {
              setTimelineNavigationTarget((current) =>
                current?.token === token ? null : current,
              );
            };
          }}
        />
      }
      surface={{
        ...surface,
        timelineNavigationTargetRowId:
          activeTimelineNavigationTarget?.rowId ?? null,
        timelineNavigationTargetSeq:
          activeTimelineNavigationTarget?.sourceSeq ?? null,
      }}
    />
  );
}
