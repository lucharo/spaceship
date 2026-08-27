import { useEffect, useRef, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import {
  defaultAppTheme,
  defaultExperiments,
  type AppTheme,
  type Experiments,
  type Host,
  defaultAppSettings,
  type AppSettings,
} from "@bb/domain";
import type {
  ProviderUsage,
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";
import { UsageLimitsSettingsSectionContent } from "@/components/settings/UsageLimitsSettingsSection";
import { VoiceInputSettingsSectionContent } from "@/components/settings/VoiceInputSettingsSection";
import { ArchivedThreadsSettingsSection } from "@/components/settings/ArchivedThreadsSettingsSection";
import { CliSkillsSettingsSection } from "@/components/settings/CliSkillsSettingsSection";
import { CommunitySettingsSection } from "@/components/settings/CommunitySettingsSection";
import { KeyboardSettingsSection } from "@/components/settings/KeyboardSettingsSection";
import { MarketplacesSettingsSection } from "@/components/settings/MarketplacesSettingsSection";
import { MachinesSettingsSection } from "@/components/settings/MachinesSettingsSection";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import {
  SettingsStoryChrome,
  type SettingsStoryRoute,
  useSettingsStoryRoute,
} from "../../.ladle/story-settings-chrome";
import {
  SettingsStoryFixtures,
  SettingsUpdatesStory,
} from "../../.ladle/settings-story-fixtures";
import type { ThemePreference } from "@/hooks/useTheme";
import type { AudioInputDeviceOption } from "@/hooks/useAudioInputDevices";
import type { PreferredAudioInputDeviceId } from "@/lib/audio-input-device-preference";
import { SETTINGS_MACHINE_ROUTE_PATH } from "@/lib/route-paths";
import {
  AppearanceSettingsSection,
  DebugSettingsSection,
  ExperimentsSettingsSection,
  LocalOpenTargetSettingsSection,
  type LocalOpenTargetSettingsSectionProps,
} from "./SettingsView";
import { MachineSettingsView } from "./MachineSettingsView";
import { ProvidersSettingsSection } from "@/components/settings/ProvidersSettingsSection";

export default {
  title: "settings/Settings",
};

type StoredTargetId = LocalOpenTargetSettingsSectionProps["directoryTargetId"];

const audioInputDevices: AudioInputDeviceOption[] = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  label: "Terminal",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

const connectedTargets: WorkspaceOpenTarget[] = [
  vscodeTarget,
  finderTarget,
  terminalTarget,
  defaultAppTarget,
];

function futureIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

const usageFixture: {
  codex: ProviderUsage;
  "claude-code": ProviderUsage;
  "acp-cursor": ProviderUsage;
} = {
  codex: {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Current session",
        resetsAt: futureIso(136),
        usedPercent: 35,
      },
      {
        label: "Weekly limit",
        resetsAt: futureIso(48),
        usedPercent: 74,
      },
    ],
  },
  "claude-code": {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Max (20x)",
    windows: [
      {
        label: "Current session",
        resetsAt: futureIso(179),
        usedPercent: 3,
      },
      {
        label: "Weekly limit",
        resetsAt: futureIso(4 * 24 * 60),
        usedPercent: 26,
      },
    ],
  },
  "acp-cursor": {
    status: "ok",
    accountEmail: "sawyer@example.com",
    planLabel: "Pro",
    windows: [
      {
        label: "Plan usage",
        resetsAt: futureIso(14 * 24 * 60),
        usedPercent: 72,
      },
      {
        label: "On-demand spend",
        resetsAt: futureIso(14 * 24 * 60),
        usedPercent: 25,
        cost: { usedUsdCents: 1_250, limitUsdCents: 5_000 },
      },
    ],
  },
};

const usageHosts: Host[] = [
  {
    id: "host-macbook",
    name: "MacBook Pro",
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "host-studio",
    name: "Mac Studio",
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  },
];

function useSettingsStoryState() {
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");
  const [appearance, setAppearance] = useState<AppTheme>({
    ...defaultAppTheme,
    faviconColor: "red",
  });
  const [navigateToThreadAfterCreate, setNavigateToThreadAfterCreate] =
    useState(false);
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] = useState(false);
  const [rewriteLocalhostLinks, setRewriteLocalhostLinks] = useState(true);
  const [richTextEditing, setRichTextEditing] = useState(false);
  const [steerActiveThreadOnEnter, setSteerActiveThreadOnEnter] =
    useState(false);
  const [streamerMode, setStreamerMode] = useState(false);
  const [showUnhandledProviderEvents, setShowUnhandledProviderEvents] =
    useState(false);
  const [preferredAudioInputDeviceId, setPreferredAudioInputDeviceId] =
    useState<PreferredAudioInputDeviceId>("studio-mic");
  const [directoryTargetId, setDirectoryTargetId] =
    useState<StoredTargetId>("finder");
  const [fileTargetId, setFileTargetId] =
    useState<StoredTargetId>("default-app");
  const [experiments, setExperiments] =
    useState<Experiments>(defaultExperiments);

  return {
    appearance,
    directoryTargetId,
    experiments,
    fileTargetId,
    navigateToThreadAfterCreate,
    openLinksInAppBrowser,
    preferredAudioInputDeviceId,
    rewriteLocalhostLinks,
    richTextEditing,
    steerActiveThreadOnEnter,
    streamerMode,
    showUnhandledProviderEvents,
    setAppearance,
    setDirectoryTargetId,
    setExperiments,
    setFileTargetId,
    setNavigateToThreadAfterCreate,
    setOpenLinksInAppBrowser,
    setPreferredAudioInputDeviceId,
    setRewriteLocalhostLinks,
    setRichTextEditing,
    setSteerActiveThreadOnEnter,
    setStreamerMode,
    setShowUnhandledProviderEvents,
    setThemePreference,
    themePreference,
  };
}

function VoiceInputStory() {
  const state = useSettingsStoryState();

  return (
    <VoiceInputSettingsSectionContent
      devices={audioInputDevices}
      errorMessage={null}
      isLoading={false}
      isSupported={true}
      onDeviceChange={state.setPreferredAudioInputDeviceId}
      onRefresh={() => undefined}
      preferredDeviceId={state.preferredAudioInputDeviceId}
    />
  );
}

function GeneralSettingsStory({
  desktopBrowserAvailable = false,
}: {
  desktopBrowserAvailable?: boolean;
}) {
  const state = useSettingsStoryState();

  return (
    <SettingsSection title="General">
      <div className="space-y-5">
        {desktopBrowserAvailable ? (
          <SettingsWithControl
            label="Open links in the in-app browser"
            description="Open web links inside bb."
          >
            <Switch
              checked={state.openLinksInAppBrowser}
              onCheckedChange={state.setOpenLinksInAppBrowser}
              aria-label="Open links in the in-app browser"
            />
          </SettingsWithControl>
        ) : null}

        <SettingsWithControl
          label="Rewrite localhost links"
          description="Point localhost links at this host."
        >
          <Switch
            checked={state.rewriteLocalhostLinks}
            onCheckedChange={state.setRewriteLocalhostLinks}
            aria-label="Rewrite localhost links"
          />
        </SettingsWithControl>

        <SettingsWithControl
          label="Streamer mode"
          description="Hide the custom models from config.json in every model picker, so a screen share does not show them."
        >
          <Switch
            checked={state.streamerMode}
            onCheckedChange={state.setStreamerMode}
            aria-label="Streamer mode"
          />
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

function DebugSettingsStory() {
  const state = useSettingsStoryState();

  return (
    <DebugSettingsSection
      disabled={false}
      enabled={state.showUnhandledProviderEvents}
      onEnabledChange={state.setShowUnhandledProviderEvents}
    />
  );
}

const ARCHIVED_CONVERSATION_RETENTION_OPTIONS = [
  { label: "Keep forever", value: "forever" },
  { label: "Delete after 30 days", value: "30-days" },
] as const;

type ArchivedConversationRetention =
  (typeof ARCHIVED_CONVERSATION_RETENTION_OPTIONS)[number]["value"];

function ThreadsSettingsStory() {
  const state = useSettingsStoryState();
  const [archivedConversationRetention, setArchivedConversationRetention] =
    useState<ArchivedConversationRetention>("forever");
  const selectedRetentionLabel =
    ARCHIVED_CONVERSATION_RETENTION_OPTIONS.find(
      (option) => option.value === archivedConversationRetention,
    )?.label ?? "Keep forever";

  return (
    <SettingsSection title="Threads">
      <div className="space-y-5">
        <SettingsWithControl label="Navigate to threads on creation">
          <Switch
            checked={state.navigateToThreadAfterCreate}
            onCheckedChange={state.setNavigateToThreadAfterCreate}
            aria-label="Navigate to threads on creation"
          />
        </SettingsWithControl>

        <SettingsWithControl label="Markdown formatting in prompt box">
          <Switch
            checked={state.richTextEditing}
            onCheckedChange={state.setRichTextEditing}
            aria-label="Markdown formatting in prompt box"
          />
        </SettingsWithControl>

        <SettingsWithControl
          label="Steer running threads on Enter"
          description="Use Enter to steer the current run and Command+Enter to queue a follow-up."
        >
          <Switch
            checked={state.steerActiveThreadOnEnter}
            onCheckedChange={state.setSteerActiveThreadOnEnter}
            aria-label="Steer running threads on Enter"
          />
        </SettingsWithControl>

        <SettingsWithControl label="Archived conversations">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-36"
                aria-label="Archived conversations"
              >
                <span className="min-w-0 truncate">
                  {selectedRetentionLabel}
                </span>
                <Icon
                  name="ChevronDown"
                  className="size-3.5 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
            >
              {ARCHIVED_CONVERSATION_RETENTION_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() =>
                    setArchivedConversationRetention(option.value)
                  }
                >
                  {option.label}
                  <Icon
                    name="Check"
                    className={
                      archivedConversationRetention === option.value
                        ? "ml-auto size-3.5"
                        : "ml-auto size-3.5 opacity-0"
                    }
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

function AppearanceSettingsStory() {
  const state = useSettingsStoryState();

  return (
    <AppearanceSettingsSection
      appearance={state.appearance}
      appearanceDisabled={false}
      customThemes={["Monochrome Lab", "Low Contrast"]}
      pluginThemes={[]}
      faviconColor={state.appearance.faviconColor}
      onAppearanceThemeChange={(themeId) =>
        state.setAppearance((current) => ({ ...current, themeId }))
      }
      onCreatePalette={() => undefined}
      onFaviconColorChange={(faviconColor) =>
        state.setAppearance((current) => ({ ...current, faviconColor }))
      }
      onThemePreferenceChange={state.setThemePreference}
      themePreference={state.themePreference}
    />
  );
}

function FilePreferencesStory() {
  const state = useSettingsStoryState();

  function handleDirectoryTargetChange(targetId: WorkspaceOpenTargetId): void {
    state.setDirectoryTargetId(targetId);
  }

  function handleFileTargetChange(targetId: WorkspaceOpenTargetId): void {
    state.setFileTargetId(targetId);
  }

  return (
    <LocalOpenTargetSettingsSection
      accessState="available"
      directoryTargetId={state.directoryTargetId}
      fileTargetId={state.fileTargetId}
      hasDaemon={true}
      onDirectoryTargetChange={handleDirectoryTargetChange}
      onFileTargetChange={handleFileTargetChange}
      onRequestAccess={async () => true}
      targets={connectedTargets}
    />
  );
}

function ExperimentsStory() {
  const state = useSettingsStoryState();

  return (
    <ExperimentsSettingsSection
      changelogPreviewEnabled={state.experiments.changelogPreview}
      disabled={false}
      editMessagesEnabled={state.experiments.editMessages}
      mobileAppEnabled={state.experiments.mobileApp}
      providerSessionReapingEnabled={state.experiments.providerSessionReaping}
      timelineWindowingEnabled={state.experiments.timelineWindowing}
      onChangelogPreviewEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          changelogPreview: enabled,
        }))
      }
      onEditMessagesEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          editMessages: enabled,
        }))
      }
      onMobileAppEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          mobileApp: enabled,
        }))
      }
      onProviderSessionReapingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          providerSessionReaping: enabled,
        }))
      }
      onTimelineWindowingEnabledChange={(enabled) =>
        state.setExperiments((current) => ({
          ...current,
          timelineWindowing: enabled,
        }))
      }
    />
  );
}

function UsageLimitsStory() {
  const [isFetching, setIsFetching] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState("host-macbook");

  return (
    <UsageLimitsSettingsSectionContent
      usage={usageFixture}
      isLoading={false}
      isError={false}
      isFetching={isFetching}
      onRefresh={() => {
        setIsFetching(true);
        window.setTimeout(() => setIsFetching(false), 500);
      }}
      hosts={usageHosts}
      selectedHostId={selectedHostId}
      onSelectHost={setSelectedHostId}
    />
  );
}

function ProvidersSettingsStory() {
  const [generalSettings, setGeneralSettings] =
    useState<AppSettings>(defaultAppSettings);
  return (
    <ProvidersSettingsSection
      disabled={false}
      generalSettings={generalSettings}
      onGeneralSettingsChange={setGeneralSettings}
    />
  );
}

function SettingsStoryContent({ route }: { route: SettingsStoryRoute }) {
  if (route.kind === "machine") {
    return (
      <Routes>
        <Route
          path={SETTINGS_MACHINE_ROUTE_PATH}
          element={<MachineSettingsView />}
        />
      </Routes>
    );
  }

  switch (route.id) {
    case "threads":
      return <ThreadsSettingsStory />;
    case "providers":
      return <ProvidersSettingsStory />;
    case "appearance":
      return <AppearanceSettingsStory />;
    case "keyboard":
      return <KeyboardSettingsSection />;
    case "usage":
      return <UsageLimitsStory />;
    case "files":
      return <FilePreferencesStory />;
    case "machines":
      return <MachinesSettingsSection />;
    case "updates":
      return <SettingsUpdatesStory />;
    case "experiments":
      return <ExperimentsStory />;
    case "marketplaces":
      return <MarketplacesSettingsSection />;
    case "community":
      return <CommunitySettingsSection />;
    case "archived":
      return <ArchivedThreadsSettingsSection />;
    case "general":
      return (
        <>
          <GeneralSettingsStory desktopBrowserAvailable />
          <CliSkillsSettingsSection />
          <VoiceInputStory />
          <DebugSettingsStory />
        </>
      );
  }
}

/** One chrome-wrapped story with real navigation between Settings subpages. */
export function FullPage() {
  const navigate = useNavigate();
  const route = useSettingsStoryRoute();
  const initializedFromStoryPath = useRef(false);
  useEffect(() => {
    if (initializedFromStoryPath.current) return;
    initializedFromStoryPath.current = true;
    const storyPath =
      new URLSearchParams(window.location.hash.slice(1)).get("settingsPath") ??
      new URLSearchParams(window.location.search).get("settingsPath");
    if (storyPath?.startsWith("/settings") === true) {
      navigate(storyPath, { replace: true });
    }
  }, [navigate]);

  return (
    <SettingsStoryFixtures>
      <SettingsStoryChrome contentOwnsPageShell={route.kind === "machine"}>
        <SettingsStoryContent route={route} />
      </SettingsStoryChrome>
    </SettingsStoryFixtures>
  );
}
