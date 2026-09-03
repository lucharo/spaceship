import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  systemCliSkillsStatusResponseSchema,
  systemInstallCliSkillsResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedHost, seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { resolveServerOwnedSkillCatalogEntries } from "../../src/services/skills/injected-skills.js";

const GLOBAL_CLI_SKILLS = ["bb-cli", "bb-plugin-authoring"] as const;

async function writeBuiltinCliSkills(harness: TestAppHarness): Promise<void> {
  await Promise.all(
    GLOBAL_CLI_SKILLS.map(async (name) => {
      const skillDirectory = join(
        harness.deps.config.builtinSkillsRootPath,
        name,
      );
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        join(skillDirectory, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test ${name}.\n---\n`,
      );
    }),
  );
}

/** The hash the server would install, read from its own registered tree. */
function expectedCliSkillTreeHash(
  harness: TestAppHarness,
  skillName: (typeof GLOBAL_CLI_SKILLS)[number],
): string {
  const entry = resolveServerOwnedSkillCatalogEntries({
    builtinSkillsRootPath: harness.deps.config.builtinSkillsRootPath,
    dataDir: harness.deps.config.dataDir,
    logger: harness.deps.logger,
    skillTreeRegistry: harness.deps.skillTreeRegistry,
  }).find(({ runtimeSource }) => runtimeSource.name === skillName);
  if (entry?.runtimeSource.kind !== "tree") {
    throw new Error(
      `The built-in ${skillName} skill did not resolve to a tree`,
    );
  }
  return entry.runtimeSource.treeHash;
}

function installRequest(hostIds: string[]): Request {
  return new Request("http://test/api/v1/system/cli-skills/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostIds }),
  });
}

describe("install cli skills", () => {
  it("installs the global built-in skill trees on every requested machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      const responders = [laptop, studio].map(({ host, session }) =>
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            expect(request.command.type).toBe("host.install_global_skills");
            if (request.command.type !== "host.install_global_skills") {
              throw new Error("Expected a global skill install request");
            }
            expect(request.command.skills).toHaveLength(2);
            expect(request.command.skills).toEqual(
              expect.arrayContaining(
                GLOBAL_CLI_SKILLS.map((name) => ({
                  name,
                  entryPath: "SKILL.md",
                  treeHash: expect.any(String),
                })),
              ),
            );
            return {
              ok: true,
              result: {
                installations: GLOBAL_CLI_SKILLS.map((name) => ({
                  name,
                  path: `/home/${host.id}/.agents/skills/${name}`,
                })),
              },
            };
          },
        }),
      );

      const response = await harness.app.request(
        installRequest([laptop.host.id, studio.host.id]),
      );
      expect(response.status).toBe(200);
      const body = systemInstallCliSkillsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.results.map((entry) => [entry.hostId, entry.ok])).toEqual([
        ["host-laptop", true],
        ["host-studio", true],
      ]);
      for (const responder of responders) {
        expect(responder.requests).toHaveLength(1);
      }
    });
  });

  it("reports a failing machine without dropping the one that worked", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      registerHostRpcResponder(harness, {
        hostId: laptop.host.id,
        sessionId: laptop.session.id,
        handle: () => ({
          ok: true,
          result: {
            installations: [{ name: "bb-cli", path: "/home/u/.agents/skills" }],
          },
        }),
      });
      registerHostRpcResponder(harness, {
        hostId: studio.host.id,
        sessionId: studio.session.id,
        handle: () => ({
          ok: false,
          errorCode: "install_failed",
          errorMessage: "disk is full",
        }),
      });

      const response = await harness.app.request(
        installRequest([laptop.host.id, studio.host.id]),
      );
      expect(response.status).toBe(200);
      const body = systemInstallCliSkillsResponseSchema.parse(
        await readJson(response),
      );
      const [installed, failed] = body.results;
      expect(installed).toMatchObject({ hostId: "host-laptop", ok: true });
      expect(failed).toMatchObject({ hostId: "host-studio", ok: false });
    });
  });

  it("rejects an unknown machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);

      const response = await harness.app.request(installRequest(["host-gone"]));
      expect(response.status).toBe(404);
    });
  });

  it("rejects an empty machine list", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);

      const response = await harness.app.request(installRequest([]));
      expect(response.status).toBe(400);
    });
  });

  it("maps each machine's reported hashes to a product status", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);
      const current = seedHostSession(harness.deps, { id: "host-current" });
      const stale = seedHostSession(harness.deps, { id: "host-stale" });
      const empty = seedHostSession(harness.deps, { id: "host-empty" });
      const expectedHashes = Object.fromEntries(
        GLOBAL_CLI_SKILLS.map((name) => [
          name,
          expectedCliSkillTreeHash(harness, name),
        ]),
      );
      const hashesByHostId: Record<string, Record<string, string | null>> = {
        "host-current": expectedHashes,
        "host-stale": {
          ...expectedHashes,
          "bb-plugin-authoring": "b".repeat(64),
        },
        "host-empty": Object.fromEntries(
          GLOBAL_CLI_SKILLS.map((name) => [name, null]),
        ),
      };
      for (const { host, session } of [current, stale, empty]) {
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            expect(request.command).toEqual({
              type: "host.global_skills_status",
              names: GLOBAL_CLI_SKILLS,
            });
            return {
              ok: true,
              result: {
                entries: GLOBAL_CLI_SKILLS.map((name) => ({
                  name,
                  path: `/home/${host.id}/.agents/skills/${name}`,
                  treeHash: hashesByHostId[host.id]?.[name] ?? null,
                })),
              },
            };
          },
        });
      }

      const response = await harness.app.request("/api/v1/system/cli-skills");
      expect(response.status).toBe(200);
      const body = systemCliSkillsStatusResponseSchema.parse(
        await readJson(response),
      );
      expect(
        Object.fromEntries(
          body.machines.map((machine) => [machine.hostId, machine.status]),
        ),
      ).toEqual({
        "host-current": "installed",
        "host-stale": "outdated",
        "host-empty": "missing",
      });
    });
  });

  it("reports a machine with no daemon session as unknown", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkills(harness);
      seedHost(harness.deps, { id: "host-offline" });

      const response = await harness.app.request("/api/v1/system/cli-skills");
      const body = systemCliSkillsStatusResponseSchema.parse(
        await readJson(response),
      );
      expect(body.machines).toEqual([
        { hostId: "host-offline", hostName: "Test Host", status: "unknown" },
      ]);
    });
  });
});
