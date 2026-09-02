import {
  definePluginApp,
  experimental_NativeSessionThreadList,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";

const NativeSessionThreadList = experimental_NativeSessionThreadList;

function CodexNativeThreadList({
  Original,
  onNavigate,
}: PluginThreadListProps) {
  return (
    <NativeSessionThreadList
      fallback={Original}
      providerId="codex"
      providerLabel="Codex"
      onNavigate={onNavigate}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "native-codex-sessions",
    title: "Native Codex sessions",
    description: "Browse and continue Codex app-server threads in place.",
    component: CodexNativeThreadList,
  });
});
