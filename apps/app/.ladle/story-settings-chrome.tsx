import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { SettingsSidebarContent } from "@/components/settings/SettingsSidebar";
import {
  SETTINGS_NAV_SECTIONS,
  type SettingsSectionId,
} from "@/components/settings/settings-nav";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { PageShell } from "@/components/ui/page-shell";
import {
  SETTINGS_ROUTE_PATH,
  SETTINGS_MACHINE_ROUTE_PATH,
  getSettingsRoutePath,
} from "@/lib/route-paths";

export type SettingsStoryRoute =
  | { kind: "machine"; id: string }
  | { kind: "section"; id: SettingsStorySectionId };

export type SettingsStorySectionId = SettingsSectionId | "threads";

const THREADS_SETTINGS_ROUTE_PATH = "/settings/threads";
const SETTINGS_STORY_NAV_SECTIONS = [
  SETTINGS_NAV_SECTIONS[0],
  { icon: "MessageSquare", id: "threads", label: "Threads" },
  ...SETTINGS_NAV_SECTIONS.slice(1),
] as const;

type SettingsSidebarNavigation = ComponentProps<
  typeof SettingsSidebarContent
>["navigation"];

/** Resolve the story's real Settings links without depending on live app data. */
export function useSettingsStoryRoute(): SettingsStoryRoute {
  const { pathname } = useLocation();
  const machineMatch = matchPath(SETTINGS_MACHINE_ROUTE_PATH, pathname);
  if (machineMatch?.params.hostId !== undefined) {
    return { kind: "machine", id: machineMatch.params.hostId };
  }
  if (pathname === THREADS_SETTINGS_ROUTE_PATH) {
    return { kind: "section", id: "threads" };
  }
  const section = SETTINGS_NAV_SECTIONS.find((entry) =>
    entry.id === "general"
      ? pathname === SETTINGS_ROUTE_PATH
      : getSettingsRoutePath(entry.id) === pathname,
  );
  return { kind: "section", id: section?.id ?? "general" };
}

/** Production application chrome around full-page Settings stories. */
export function SettingsStoryChrome({
  activeSection,
  children,
  contentOwnsPageShell = false,
}: {
  activeSection?: SettingsStorySectionId;
  children: ReactNode;
  /** Detail routes already render their production PageShell. */
  contentOwnsPageShell?: boolean;
}) {
  const route = useSettingsStoryRoute();
  const resolvedActiveSection =
    activeSection ?? (route.kind === "section" ? route.id : "machines");

  return (
    <SidebarProvider
      className="h-screen min-h-[640px] bg-background"
      style={{ "--bb-shell-height": "100vh" } as CSSProperties}
    >
      <SettingsSidebarContent
        appRoutePath="/"
        isResizing={false}
        navigation={
          {
            activePluginId: null,
            activeSection: resolvedActiveSection,
            pluginEntries: [],
            sections: SETTINGS_STORY_NAV_SECTIONS,
          } as SettingsSidebarNavigation
        }
        onResizeMouseDown={() => {}}
        showTopReserve
        testIdPrefix="settings-story"
      />
      <SidebarInset>
        <div className="relative flex h-full min-h-0 min-w-0 flex-col">
          <AppPageHeader
            center={
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className="-ml-2" />
                <span className="truncate text-sm font-semibold">Settings</span>
              </div>
            }
          />
          <main className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
            {contentOwnsPageShell ? (
              children
            ) : (
              <PageShell contentClassName="pt-4 md:pt-5">
                <div className="mx-auto w-full max-w-3xl space-y-10">
                  {children}
                </div>
              </PageShell>
            )}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
