import { describe, expect, it, vi } from "vitest";
import {
  createNoopTelemetryService,
  runWithTelemetryAppSurface,
} from "../../src/services/system/telemetry.js";

describe("telemetry service", () => {
  it("is permanently inert", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const telemetry = createNoopTelemetryService();

    runWithTelemetryAppSurface("desktop", () => {
      telemetry.capture({
        name: "thread_created",
        properties: {
          is_child_thread: true,
          provider: "claude-code",
        },
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
