import { join } from "node:path";
import {
  SPACESHIP_PROD_HOST_DAEMON_PORT,
  SPACESHIP_PROD_SERVER_PORT,
} from "@bb/config/runtime";

export const SPACESHIP_DATA_DIR_NAME = ".spaceship";
export const SPACESHIP_SERVER_PORT = SPACESHIP_PROD_SERVER_PORT;
export const SPACESHIP_HOST_DAEMON_PORT = SPACESHIP_PROD_HOST_DAEMON_PORT;

interface CreateSpaceshipRuntimeEnvArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

export function createSpaceshipRuntimeEnv(
  args: CreateSpaceshipRuntimeEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.env,
    BB_DATA_DIR:
      args.env.BB_DATA_DIR?.trim() ||
      join(args.homeDir, SPACESHIP_DATA_DIR_NAME),
    BB_HOST_DAEMON_PORT:
      args.env.BB_HOST_DAEMON_PORT?.trim() ||
      String(SPACESHIP_HOST_DAEMON_PORT),
    BB_SERVER_PORT:
      args.env.BB_SERVER_PORT?.trim() || String(SPACESHIP_SERVER_PORT),
  };
}
