import { findThreadByNativeIdentity } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public native thread archive", () => {
  it("archives an unprojected provider session without adopting it or resolving a cwd", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-archive",
      });
      const identity = {
        hostId: host.id,
        providerId: "codex",
        providerThreadId: "native-thread-unprojected",
      };

      const responsePromise = harness.app.request(
        "/api/v1/threads/archive-native",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        },
      );
      const archive = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          (command as { type: string }).type ===
            "provider.native_sessions.archive" &&
          "providerThreadId" in command &&
          command.providerThreadId === identity.providerThreadId,
      );

      expect(archive.command).toEqual({
        type: "provider.native_sessions.archive",
        providerId: "codex",
        providerThreadId: "native-thread-unprojected",
        bridgeLaunch: expect.any(Object),
      });
      await reportQueuedCommandSuccess(harness, archive as never, {} as never);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(findThreadByNativeIdentity(harness.db, identity)).toBeNull();
      expect(listQueuedCommands(harness, "project.inspect")).toEqual([]);
      expect(
        listQueuedCommands(harness, "provider.native_sessions.read"),
      ).toEqual([]);
    });
  });
});
