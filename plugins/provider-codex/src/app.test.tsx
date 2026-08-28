// @vitest-environment jsdom

import { expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

it("owns the native Codex thread list through the standard replacement slot", async () => {
  const app = await loadPluginApp(() => import("../app.js"));

  expect(app.threadLists).toHaveLength(1);
  expect(app.threadLists[0]).toMatchObject({
    id: "native-codex-sessions",
    title: "Native Codex sessions",
  });
});
