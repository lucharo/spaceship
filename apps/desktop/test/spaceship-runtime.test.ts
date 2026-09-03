import { describe, expect, it } from "vitest";
import {
  createSpaceshipRuntimeEnv,
  SPACESHIP_DATA_DIR_NAME,
  SPACESHIP_HOST_DAEMON_PORT,
  SPACESHIP_SERVER_PORT,
} from "../src/spaceship-runtime.js";

describe("Spaceship runtime identity", () => {
  it("uses its own data directory and port by default", () => {
    expect(
      createSpaceshipRuntimeEnv({ env: {}, homeDir: "/Users/example" }),
    ).toMatchObject({
      BB_DATA_DIR: `/Users/example/${SPACESHIP_DATA_DIR_NAME}`,
      BB_HOST_DAEMON_PORT: String(SPACESHIP_HOST_DAEMON_PORT),
      BB_SERVER_PORT: String(SPACESHIP_SERVER_PORT),
    });
  });

  it("honours explicit compatible bb runtime overrides", () => {
    expect(
      createSpaceshipRuntimeEnv({
        env: {
          BB_DATA_DIR: "/tmp/custom-spaceship",
          BB_HOST_DAEMON_PORT: "45556",
          BB_SERVER_PORT: "45555",
        },
        homeDir: "/Users/example",
      }),
    ).toMatchObject({
      BB_DATA_DIR: "/tmp/custom-spaceship",
      BB_HOST_DAEMON_PORT: "45556",
      BB_SERVER_PORT: "45555",
    });
  });
});
