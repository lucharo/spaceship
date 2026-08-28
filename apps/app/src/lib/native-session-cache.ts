import { systemNativeSessionsResponseSchema } from "@bb/server-contract";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";

const nativeSessionCache = createLastKnownCache({
  prefix: "spaceship.native-sessions",
  version: "2",
  schema: systemNativeSessionsResponseSchema,
});

const nativeSessionHostCache = createLastKnownCache({
  prefix: "spaceship.native-sessions.last-host",
  version: "1",
  schema: z.string().min(1),
});

export function nativeSessionCacheKey(args: {
  providerId: string;
  hostId: string | null;
  archived: boolean;
}): string {
  return nativeSessionCache.key(
    args.providerId,
    args.hostId,
    args.archived ? "archived" : "active",
  );
}

export const readCachedNativeSessions = nativeSessionCache.read;
export const writeCachedNativeSessions = nativeSessionCache.write;

export function readLastNativeSessionHostId(providerId: string): string | null {
  return nativeSessionHostCache.read(nativeSessionHostCache.key(providerId));
}

export function writeLastNativeSessionHostId(
  providerId: string,
  hostId: string,
): void {
  nativeSessionHostCache.write(nativeSessionHostCache.key(providerId), hostId);
}
