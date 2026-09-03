import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "@bb/host-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { isExpectedCommandDispatchError } from "../command-dispatch-support.js";
import {
  cloneProject,
  inspectProjectPath,
  resolveProjectCloneDefaultPath,
} from "./project.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-project-clone-"));
  tempDirs.push(dir);
  return dir;
}

async function createRemoteRepo(root: string): Promise<string> {
  const source = path.join(root, "source");
  const remote = path.join(root, "remote.git");
  await fs.mkdir(source, { recursive: true });
  await runGit(["init"], { cwd: source });
  await fs.writeFile(path.join(source, "README.md"), "hello\n");
  await runGit(["add", "README.md"], { cwd: source });
  await runGit(
    [
      "-c",
      "user.name=BB Test",
      "-c",
      "user.email=bb@example.test",
      "commit",
      "-m",
      "initial",
    ],
    { cwd: source },
  );
  await runGit(["clone", "--bare", source, remote], { cwd: root });
  return remote;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("project.clone", () => {
  it("clones a real repository and reports the resolved path and origin", async () => {
    const root = await tempDir();
    const remoteUrl = await createRemoteRepo(root);
    const result = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "My Project",
      remoteUrl,
    });
    const canonicalCheckoutPath = await fs.realpath(
      path.join(root, "data", "checkouts", "my-project"),
    );

    expect(result).toEqual({
      path: canonicalCheckoutPath,
      gitRemoteUrl: remoteUrl,
    });
    await expect(
      fs.readFile(path.join(result.path, "README.md"), "utf8"),
    ).resolves.toBe("hello\n");
  });

  it("refuses a non-empty target with a structured error", async () => {
    const root = await tempDir();
    const targetPath = path.join(root, "target");
    await fs.mkdir(targetPath);
    await fs.writeFile(path.join(targetPath, "keep.txt"), "keep");

    const error = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "project",
      remoteUrl: path.join(root, "remote.git"),
      targetPath,
    }).catch((caught) => caught);
    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "target_not_empty" });
  });

  it("preserves git stderr in a structured clone failure", async () => {
    const root = await tempDir();
    const missingRemote = path.join(root, "missing.git");
    const error = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "project",
      remoteUrl: missingRemote,
    }).catch((caught) => caught);

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "git_command_failed" });
    expect(error.message).toContain(
      `fatal: repository '${missingRemote}' does not exist`,
    );
  });

  it("derives the checkout convention without touching the filesystem", async () => {
    const root = await tempDir();
    const dataDir = path.join(root, "data");
    expect(resolveProjectCloneDefaultPath(dataDir, " Project / Name ")).toBe(
      path.join(dataDir, "checkouts", "project-name"),
    );
    await expect(fs.stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("project.inspect", () => {
  it("resolves symlinked directories to their canonical path", async () => {
    const root = await tempDir();
    const target = path.join(root, "target");
    const link = path.join(root, "link");
    await fs.mkdir(target);
    await fs.symlink(target, link);
    const canonicalTarget = await fs.realpath(target);

    await expect(inspectProjectPath(link)).resolves.toMatchObject({
      path: canonicalTarget,
      isGitRepo: false,
    });
  });

  it("rejects a missing project directory", async () => {
    const root = await tempDir();

    await expect(
      inspectProjectPath(path.join(root, "missing")),
    ).rejects.toMatchObject({ code: "path_not_found" });
  });

  it("rejects a project path that is not a directory", async () => {
    const root = await tempDir();
    const file = path.join(root, "file.txt");
    await fs.writeFile(file, "not a directory");

    await expect(inspectProjectPath(file)).rejects.toMatchObject({
      code: "path_not_found",
    });
  });

  it("recognises a local Git repository without an origin remote", async () => {
    const root = await tempDir();
    await runGit(["init", "-b", "main"], { cwd: root });
    const canonicalRoot = await fs.realpath(root);

    await expect(inspectProjectPath(root)).resolves.toEqual({
      path: canonicalRoot,
      gitRemoteUrl: null,
      isGitRepo: true,
      isWorktree: false,
      branchName: "main",
      defaultBranch: "main",
    });
  });
});
