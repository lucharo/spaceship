import fs from "node:fs/promises";
import path from "node:path";
import {
  detectGitRepo,
  getCurrentBranch,
  getGitCommonDir,
  readDefaultBranchRefs,
  runGit,
  WorkspaceError,
  type GitProcessOptions,
} from "@bb/host-workspace";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const PROJECT_CLONE_TIMEOUT_MS = 20 * 60 * 1000;

function normalizeProjectSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return slug || "project";
}

export function resolveProjectCloneDefaultPath(
  dataDir: string,
  projectSlug: string,
): string {
  return path.resolve(dataDir, "checkouts", normalizeProjectSlug(projectSlug));
}

async function requireEmptyOrMissingTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory() || (await fs.readdir(targetPath)).length > 0) {
      throw new ExpectedCommandDispatchError(
        "target_not_empty",
        `Clone target is not empty: ${targetPath}`,
      );
    }
  } catch (error) {
    if (error instanceof ExpectedCommandDispatchError) {
      throw error;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function inspectProjectPath(
  projectPath: string,
  options: GitProcessOptions = {},
): Promise<{
  branchName: string | null;
  defaultBranch: string | null;
  gitRemoteUrl: string | null;
  isGitRepo: boolean;
  isWorktree: boolean;
  path: string;
}> {
  const resolvedPath = path.resolve(projectPath);
  const isGitRepo = await detectGitRepo(resolvedPath, options);
  if (!isGitRepo) {
    return {
      branchName: null,
      defaultBranch: null,
      gitRemoteUrl: null,
      isGitRepo: false,
      isWorktree: false,
      path: resolvedPath,
    };
  }

  const [remote, branchName, defaultBranchRefs, gitDirectory, gitCommonDir] =
    await Promise.all([
      runGit(["remote", "get-url", "origin"], {
        cwd: resolvedPath,
        ...options,
        allowFailure: true,
      }),
      getCurrentBranch(resolvedPath, options),
      readDefaultBranchRefs(resolvedPath, options),
      runGit(["rev-parse", "--absolute-git-dir"], {
        cwd: resolvedPath,
        ...options,
      }),
      getGitCommonDir(resolvedPath, options),
    ]);
  const [resolvedGitDirectory, resolvedGitCommonDir] = await Promise.all([
    fs.realpath(path.resolve(gitDirectory.stdout.trim())),
    fs.realpath(path.resolve(gitCommonDir)),
  ]);
  const gitRemoteUrl = remote.exitCode === 0 ? remote.stdout.trim() : "";
  return {
    branchName: branchName ?? null,
    defaultBranch: defaultBranchRefs.defaultBranch ?? branchName ?? null,
    gitRemoteUrl: gitRemoteUrl || null,
    isGitRepo: true,
    isWorktree: resolvedGitDirectory !== resolvedGitCommonDir,
    path: resolvedPath,
  };
}

export async function cloneProject(args: {
  dataDir: string;
  projectSlug: string;
  remoteUrl: string;
  targetPath?: string;
  shellPath?: string;
}): Promise<{ path: string; gitRemoteUrl: string | null }> {
  const targetPath = path.resolve(
    args.targetPath ??
      resolveProjectCloneDefaultPath(args.dataDir, args.projectSlug),
  );
  await requireEmptyOrMissingTarget(targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await runGit(["clone", args.remoteUrl, targetPath], {
      cwd: path.dirname(targetPath),
      ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
      timeoutMs: PROJECT_CLONE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new ExpectedCommandDispatchError(error.code, error.message);
    }
    throw error;
  }
  const inspection = await inspectProjectPath(
    targetPath,
    args.shellPath === undefined ? {} : { shellPath: args.shellPath },
  );
  return {
    path: inspection.path,
    gitRemoteUrl: inspection.gitRemoteUrl,
  };
}
