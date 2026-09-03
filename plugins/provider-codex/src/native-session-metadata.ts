import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexHome } from "./codex-home.js";

interface ReadCodexThreadWorkspaceRootHintsArgs {
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Read Codex Desktop's metadata-only thread-to-project hints. App-server owns
 * the sessions themselves; Desktop keeps this presentation hint beside the
 * native store so worktree sessions remain grouped with their source project.
 * Missing, malformed, or unknown state fails closed to no hints.
 */
export async function readCodexThreadWorkspaceRootHints({
  homeDir = os.homedir(),
  env = process.env,
}: ReadCodexThreadWorkspaceRootHintsArgs = {}): Promise<Map<string, string>> {
  try {
    const statePath = path.join(
      resolveCodexHome(homeDir, env),
      ".codex-global-state.json",
    );
    const parsed: unknown = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return new Map();
    }
    const hints = (parsed as Record<string, unknown>)[
      "thread-workspace-root-hints"
    ];
    if (typeof hints !== "object" || hints === null || Array.isArray(hints)) {
      return new Map();
    }
    return new Map(
      Object.entries(hints).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return new Map();
  }
}
