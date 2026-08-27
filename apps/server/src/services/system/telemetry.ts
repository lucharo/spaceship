import type { RequestAppSurface } from "@bb/config/app-surface";

export type TelemetryEvent =
  | { name: "app_started" }
  | {
      name: "thread_created";
      properties: {
        is_child_thread: boolean;
        provider: string;
      };
    }
  | {
      name: "user_message_sent";
      properties: {
        is_child_thread: boolean;
        message_source: "queued_message" | "thread_create" | "thread_send";
        provider: string;
      };
    }
  | {
      /**
       * One user-initiated plugin install (CLI, store, or API). Bundled
       * plugins that auto-install at boot do not send this. Rank plugins by
       * install count with a trend on this event broken down by `plugin_id`.
       */
      name: "plugin_installed";
      properties: {
        /**
         * Manifest id for public plugins: bundled builtins and entries of the
         * curated `bb-community` marketplace. Null for direct installs and
         * third-party catalogs, whose ids and sources may name private code.
         */
        plugin_id: string | null;
        provenance: "builtin" | "catalog" | "direct";
        /** `bb-community` for curated catalog installs; null otherwise. */
        marketplace: string | null;
        source_kind: "builtin" | "git" | "npm" | "path";
      };
    };

export interface TelemetryService {
  capture(event: TelemetryEvent): void;
}

const noopTelemetryService: TelemetryService = {
  capture: () => {},
};

/** No-op service for tests and other places that need the dependency shape. */
export function createNoopTelemetryService(): TelemetryService {
  return noopTelemetryService;
}

export function runWithTelemetryAppSurface<T>(
  _appSurface: RequestAppSurface,
  callback: () => T,
): T {
  return callback();
}
