import { NextResponse } from "next/server";

import {
  loadLocalGatewayDefaults,
  loadStudioSettings,
} from "@/lib/studio/settings-store";
import type {
  StudioGatewayAdapterType,
  StudioGatewayProfile,
  StudioGatewaySettings,
} from "@/lib/studio/settings";

export const runtime = "nodejs";

type CustomRuntimeRequestBody = {
  runtimeUrl?: string;
  runtimeToken?: string;
  runtimeAdapterType?: StudioGatewayAdapterType;
  pathname?: string;
  method?: string;
  body?: unknown;
};

const normalizeAdapterType = (value: unknown): StudioGatewayAdapterType | null => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "openclaw" ||
    normalized === "ironclaw" ||
    normalized === "hermes" ||
    normalized === "demo" ||
    normalized === "local" ||
    normalized === "claw3d" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  return null;
};

const resolveStoredProfile = (
  adapterType: StudioGatewayAdapterType,
  gateway: StudioGatewaySettings | null
): StudioGatewayProfile | null => {
  const explicitProfile = gateway?.profiles?.[adapterType];
  if (explicitProfile?.url) {
    return explicitProfile;
  }
  if (gateway?.adapterType === adapterType && gateway.url.trim()) {
    return {
      url: gateway.url,
      token: gateway.token ?? "",
    };
  }
  return null;
};

const resolveServerRuntimeToken = (
  adapterType: StudioGatewayAdapterType | null,
  runtimeUrl: string
): string => {
  if (!adapterType) return "";

  const settings = loadStudioSettings();
  const localDefaults = loadLocalGatewayDefaults();
  const candidates = [
    resolveStoredProfile(adapterType, settings.gateway),
    resolveStoredProfile(adapterType, localDefaults),
  ].filter((profile): profile is StudioGatewayProfile => Boolean(profile?.url));

  for (const profile of candidates) {
    try {
      if (normalizeRuntimeUrl(profile.url) !== runtimeUrl) continue;
      const token = profile.token.trim();
      if (token) return token;
    } catch {
      continue;
    }
  }

  return "";
};

const isRuntimeUrlAllowed = (runtimeUrl: string): boolean => {
  const rawAllowlist = (
    process.env.CUSTOM_RUNTIME_ALLOWLIST ||
    process.env.UPSTREAM_ALLOWLIST ||
    ""
  ).trim();
  if (!rawAllowlist) {
    return process.env.NODE_ENV !== "production";
  }
  try {
    const parsed = new URL(runtimeUrl);
    const allowed = rawAllowlist
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return allowed.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const normalizeRuntimeUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("runtimeUrl is required.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("runtimeUrl must use http, https, ws, or wss.");
  }
  parsed.username = "";
  parsed.password = "";
  const normalized = parsed.toString().replace(/\/$/, "");
  if (!isRuntimeUrlAllowed(normalized)) {
    throw new Error("runtimeUrl is not in the allowed hosts list.");
  }
  return normalized;
};

const normalizePathname = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("pathname is required.");
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const normalizeMethod = (value: unknown): "GET" | "POST" => {
  if (typeof value !== "string") return "GET";
  const upper = value.trim().toUpperCase();
  if (upper === "POST") return "POST";
  return "GET";
};

export async function POST(request: Request) {
  let payload;
  try {
    payload = (await request.json()) as CustomRuntimeRequestBody;
  } catch (error) {
    console.error("[runtime/custom] Invalid JSON request body.", error);
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  try {
    const runtimeUrl = normalizeRuntimeUrl(payload.runtimeUrl ?? "");
    const runtimeAdapterType = normalizeAdapterType(payload.runtimeAdapterType);
    const runtimeToken =
      (typeof payload.runtimeToken === "string" ? payload.runtimeToken.trim() : "") ||
      resolveServerRuntimeToken(runtimeAdapterType, runtimeUrl);
    const pathname = normalizePathname(payload.pathname);
    const method = normalizeMethod(payload.method);
    // Propagate the browser abort signal so that cancelling the client-side fetch
    // (e.g. hitting Stop) also cancels the upstream runtime request.
    const response = await fetch(`${runtimeUrl}${pathname}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(runtimeToken ? { Authorization: `Bearer ${runtimeToken}` } : null),
        ...(method === "POST" ? { "Content-Type": "application/json" } : null),
      },
      body: method === "POST" ? JSON.stringify(payload.body ?? {}) : undefined,
      cache: "no-store",
      signal: request.signal,
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom runtime proxy failed.";
    const status =
      message === "runtimeUrl is required." ||
      message === "pathname is required." ||
      message === "runtimeUrl must use http, https, ws, or wss." ||
      message === "runtimeUrl is not in the allowed hosts list."
        ? 400
        : 502;
    console.error("[runtime/custom] Proxy request failed.", error);
    return NextResponse.json(
      {
        error:
          status === 400
            ? message
            : "Custom runtime proxy failed.",
      },
      { status }
    );
  }
}
