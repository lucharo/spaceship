// First-party HTTP endpoints for the marketing page, ported from the old
// standalone landing worker (apps/landing/src/worker.ts). Routing now lives in
// TanStack server routes (routes/download.macos.tsx, routes/api.subscribe.tsx);
// this module keeps the framework-free request/response logic testable.
import {
  DOWNLOAD_MACOS_FALLBACK_URL,
  DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL,
  DOWNLOAD_MACOS_VERSION_FEED_URL,
} from "./site";
const RESEND_CONTACTS_URL = "https://api.resend.com/audiences";
const MAX_EMAIL_LENGTH = 254;
const MACOS_INSTALLER_EXTENSION = ".dmg";
// Permissive single-line email shape; Resend does the authoritative validation.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MarketingEnv = {
  // Set in production via wrangler secret / vars; unset on forks and local dev,
  // where /api/subscribe reports that signup is not configured.
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
};

export async function handleDownloadMacos(
  _request: Request,
  _env: MarketingEnv,
  _waitUntil: (promise: Promise<void>) => void,
): Promise<Response> {
  const location = await resolveMacosDownloadUrl();
  return redirectResponse(location);
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "content-type": "application/json",
    },
    status,
  });
}

// Adds the submitted email to the bb marketing audience in Resend. Same-origin
// only (the form lives on this site), so no CORS handling is needed.
export async function handleSubscribe(
  request: Request,
  env: MarketingEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!env.RESEND_API_KEY || !env.RESEND_AUDIENCE_ID) {
    return jsonResponse({ error: "Email signup is not configured." }, 503);
  }

  const email = await readEmail(request);
  if (!email) {
    return jsonResponse({ error: "Enter a valid email address." }, 400);
  }

  let resendResponse: Response;
  try {
    resendResponse = await fetch(
      `${RESEND_CONTACTS_URL}/${env.RESEND_AUDIENCE_ID}/contacts`,
      {
        body: JSON.stringify({ email, unsubscribed: false }),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
  } catch {
    return jsonResponse({ error: "Could not reach the signup service." }, 502);
  }

  // Resend returns 2xx for new contacts and, for an already-subscribed email,
  // either 2xx or an "already exists" error — both mean the visitor is on the
  // list, so treat them as success.
  if (resendResponse.ok || (await isAlreadySubscribed(resendResponse))) {
    return jsonResponse({ ok: true }, 200);
  }
  return jsonResponse({ error: "Could not add you to the list." }, 502);
}

async function readEmail(request: Request): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as { email?: unknown }).email;
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

async function isAlreadySubscribed(response: Response): Promise<boolean> {
  if (response.status !== 409 && response.status !== 422) {
    return false;
  }
  const body = await response.text();
  return /already/i.test(body);
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: location,
    },
    status: 302,
  });
}

async function resolveMacosDownloadUrl(): Promise<string> {
  try {
    const response = await fetch(DOWNLOAD_MACOS_VERSION_FEED_URL, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return DOWNLOAD_MACOS_FALLBACK_URL;
    }

    const assetName = findMacosInstallerAssetName(await response.json());
    if (!assetName) {
      return DOWNLOAD_MACOS_FALLBACK_URL;
    }

    return `${DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL}/${encodeURIComponent(assetName)}`;
  } catch {
    return DOWNLOAD_MACOS_FALLBACK_URL;
  }
}

function findMacosInstallerAssetName(feed: unknown): string | null {
  if (!isRecord(feed) || !Array.isArray(feed.files)) {
    return null;
  }

  for (const file of feed.files) {
    if (!isRecord(file) || typeof file.url !== "string") {
      continue;
    }
    if (isMacosInstallerAssetName(file.url)) {
      return file.url;
    }
  }
  return null;
}

function isMacosInstallerAssetName(value: string): boolean {
  return (
    value.length > MACOS_INSTALLER_EXTENSION.length &&
    value.endsWith(MACOS_INSTALLER_EXTENSION) &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
