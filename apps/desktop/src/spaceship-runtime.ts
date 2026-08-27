import { join } from "node:path";

export const SPACESHIP_DATA_DIR_NAME = ".spaceship";
export const SPACESHIP_SERVER_PORT = 38_896;

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
    BB_SERVER_PORT:
      args.env.BB_SERVER_PORT?.trim() || String(SPACESHIP_SERVER_PORT),
  };
}
