import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCodexThreadWorkspaceRootHints } from "./native-session-metadata.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((target) => rm(target, { recursive: true, force: true })),
  );
});

describe("readCodexThreadWorkspaceRootHints", () => {
  it("reads only valid native workspace-root hints", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "codex-home-"));
    cleanupPaths.push(codexHome);
    await writeFile(
      path.join(codexHome, ".codex-global-state.json"),
      JSON.stringify({
        "thread-workspace-root-hints": {
          "thread-worktree": "/Users/demo/Projects/spaceship",
          "thread-empty": "",
          "thread-invalid": 42,
        },
        unrelated: { private: "ignored" },
      }),
    );

    await expect(
      readCodexThreadWorkspaceRootHints({
        homeDir: "/Users/demo",
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual(
      new Map([["thread-worktree", "/Users/demo/Projects/spaceship"]]),
    );
  });

  it("fails closed when the native desktop metadata is absent or malformed", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "codex-home-"));
    cleanupPaths.push(codexHome);

    await expect(
      readCodexThreadWorkspaceRootHints({
        homeDir: "/Users/demo",
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual(new Map());

    await writeFile(
      path.join(codexHome, ".codex-global-state.json"),
      "not-json",
    );
    await expect(
      readCodexThreadWorkspaceRootHints({
        homeDir: "/Users/demo",
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual(new Map());
  });
});
