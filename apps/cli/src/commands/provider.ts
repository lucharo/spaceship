import { Command } from "commander";
import type { AvailableModel } from "@bb/domain";
import type {
  SystemNativeSessionsResponse,
  SystemProviderInfo,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveLocalHostId } from "../daemon.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { resolveMachineEnvironmentRouting } from "./machine.js";

interface ProviderListCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
}

interface ProviderModelsCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
  selectedModel?: string;
}

interface ProviderSessionsCommandOptions {
  archived?: boolean;
  cursor?: string;
  cwd?: string;
  environment?: string;
  host?: string;
  json?: boolean;
  limit?: string;
  machine?: string;
  search?: string;
}

interface ProviderAdoptCommandOptions {
  cwd?: string;
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
  title?: string;
}

interface IncludeSelectedOnlyModelArgs {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  selectedModel?: string;
}

function addProviderRoutingOptions(command: Command): Command {
  return command
    .option("--machine <id-or-name>", "Machine whose providers should be used")
    .option("--host <id-or-name>", "Alias for --machine")
    .option(
      "--environment <id>",
      "Environment whose machine providers should be used",
    );
}

export function registerProviderCommands(
  program: Command,
  getUrl: () => string,
): void {
  const provider = program
    .command("provider")
    .description("Inspect available providers and models");

  addProviderRoutingOptions(provider.command("list"))
    .description("List available providers")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderListCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const providers = await sdk.providers.list(
          await resolveMachineEnvironmentRouting(opts, serverUrl),
        );
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No providers available");
          return;
        }
        printProviderTable(providers);
      }),
    );

  addProviderRoutingOptions(provider.command("models [providerId]"))
    .description("List available models for a provider")
    .option("--json", "Print machine-readable JSON output")
    .option(
      "--selected-model <model>",
      "Include a selected-only model if it matches",
    )
    .action(
      action(
        async (
          providerId: string | undefined,
          opts: ProviderModelsCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const executionOptions = await sdk.providers.models({
            ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
            ...(providerId ? { providerId } : {}),
          });
          const models = includeSelectedOnlyModel({
            models: executionOptions.models,
            selectedOnlyModels: executionOptions.selectedOnlyModels,
            selectedModel: opts.selectedModel,
          });
          if (outputJson(opts, models)) return;
          if (models.length === 0) {
            console.log("No models available");
            return;
          }
          printModelTable(models, providerId);
        },
      ),
    );

  addProviderRoutingOptions(provider.command("sessions <providerId>"))
    .description("List provider-native sessions without reading transcripts")
    .option("--archived", "List archived native sessions")
    .option("--cursor <cursor>", "Continue from a native pagination cursor")
    .option("--cwd <path>", "Filter sessions by working directory")
    .option("--limit <count>", "Maximum sessions to return", "50")
    .option("--search <text>", "Filter sessions by provider metadata")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (providerId: string, opts: ProviderSessionsCommandOptions) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const limit = Number.parseInt(opts.limit ?? "50", 10);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error("--limit must be an integer from 1 to 100");
          }
          const result = await sdk.providers.nativeSessions(providerId, {
            ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
            archived: opts.archived ?? false,
            limit,
            ...(opts.cursor ? { cursor: opts.cursor } : {}),
            ...(opts.cwd ? { cwd: opts.cwd } : {}),
            ...(opts.search ? { searchTerm: opts.search } : {}),
          });
          if (outputJson(opts, result)) return;
          if (result.sessions.length === 0) {
            console.log("No native sessions found");
            return;
          }
          printNativeSessionTable(result.sessions);
        },
      ),
    );

  addProviderRoutingOptions(
    provider.command("adopt <providerId> <providerThreadId>"),
  )
    .description("Adopt a provider-native session without copying its history")
    .option("--cwd <path>", "Working directory for the native session")
    .option("--title <title>", "Title for a newly adopted thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          providerId: string,
          providerThreadId: string,
          opts: ProviderAdoptCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const routing = await resolveMachineEnvironmentRouting(
            opts,
            serverUrl,
          );
          let hostId: string;
          let cwd = opts.cwd?.trim();
          let projectId: string | undefined;
          let environmentId: string | undefined;

          if (routing.environmentId !== undefined) {
            const environment = await sdk.environments.get({
              environmentId: routing.environmentId,
            });
            if (environment.path === null) {
              throw new Error("The selected environment has no workspace path");
            }
            if (cwd !== undefined && cwd !== environment.path) {
              throw new Error("--cwd must match the selected environment path");
            }
            hostId = environment.hostId;
            cwd = environment.path;
            projectId = environment.projectId;
            environmentId = environment.id;
          } else {
            hostId = routing.hostId ?? (await resolveLocalHostId());
          }
          if (!cwd) {
            throw new Error("Provide --cwd or --environment");
          }

          const result = await sdk.threads.adoptNative({
            hostId,
            cwd,
            providerId,
            providerThreadId,
            ...(projectId === undefined ? {} : { projectId }),
            ...(environmentId === undefined ? {} : { environmentId }),
            ...(opts.title === undefined ? {} : { title: opts.title }),
          });
          if (outputJson(opts, result)) return;
          console.log(
            `${result.created ? "Adopted" : "Opened"} native session as thread ${result.thread.id}`,
          );
        },
      ),
    );
}

function includeSelectedOnlyModel(
  args: IncludeSelectedOnlyModelArgs,
): AvailableModel[] {
  if (!args.selectedModel) {
    return args.models;
  }
  if (args.models.some((model) => model.model === args.selectedModel)) {
    return args.models;
  }
  const selectedOnlyModel = args.selectedOnlyModels.find(
    (model) => model.model === args.selectedModel,
  );
  return selectedOnlyModel ? [selectedOnlyModel, ...args.models] : args.models;
}

function printProviderTable(providers: SystemProviderInfo[]): void {
  const rows = providers.map((provider) => [provider.id, provider.displayName]);
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name"],
      colWidths: [idWidth, nameWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}

function printNativeSessionTable(
  sessions: SystemNativeSessionsResponse["sessions"],
): void {
  const rows = sessions.map((session) => [
    session.title ?? "Untitled",
    session.cwd ?? "—",
    session.source ?? "—",
    session.providerThreadId,
  ]);
  const widths = ["Title", "Directory", "Source", "Native ID"].map(
    (heading, index) =>
      Math.max(heading.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["Title", "Directory", "Source", "Native ID"],
        colWidths: widths,
      },
      rows,
    ),
  );
  console.log("");
}

function printModelTable(models: AvailableModel[], providerId?: string): void {
  if (providerId) {
    console.log(`Models for ${providerId}:`);
  }

  const rows = models.map((model) => [
    model.model,
    model.displayName ?? model.model,
    model.isDefault ? "*" : "",
  ]);
  const modelWidth = Math.max(5, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const defaultWidth = Math.max(7, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["Model", "Name", "Default"],
      colWidths: [modelWidth, nameWidth, defaultWidth],
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
