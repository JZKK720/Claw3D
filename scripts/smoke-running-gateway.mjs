import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const PASS = "PASS";
const WARN = "WARN";
const FAIL = "FAIL";
const GATEWAY_PROTOCOL_VERSION = 4;

const checks = [];

const pushCheck = (status, label, detail) => {
  checks.push({ status, label, detail });
  process.stdout.write(`[${status}] ${label}: ${detail}\n`);
};

const loadDotenvFile = (filePath, target) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (target[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    target[key] = value;
  }
};

const loadEnv = () => {
  const merged = { ...process.env };
  loadDotenvFile(path.join(process.cwd(), ".env.local"), merged);
  loadDotenvFile(path.join(process.cwd(), ".env"), merged);
  return merged;
};

const buildBaseUrl = (env) => {
  const protocol = (env.CLAW3D_SMOKE_PROTOCOL || "http").trim() || "http";
  const host = (env.CLAW3D_SMOKE_HOST || env.HOST_BIND || "127.0.0.1").trim() || "127.0.0.1";
  const port = (env.CLAW3D_SMOKE_PORT || env.HOST_PORT || "3006").trim() || "3006";
  return `${protocol}://${host}:${port}`;
};

const toWsUrl = (baseUrl, pathname) => {
  const url = new URL(pathname, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const withTimeout = async (work, timeoutMs, label) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const parseJsonText = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const readResponse = async (response) => {
  const text = await response.text();
  return {
    text,
    json: parseJsonText(text),
  };
};

const getSetCookieHeader = (response) => {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie()[0] || "";
  }
  return response.headers.get("set-cookie") || "";
};

const extractCookie = (setCookieHeader) => {
  const first = String(setCookieHeader || "").split(",")[0];
  return first.split(";")[0].trim();
};

const loginToStudio = async (baseUrl, token) => {
  if (!token) {
    throw new Error("STUDIO_ACCESS_TOKEN is required for smoke:running-gateway.");
  }
  const response = await withTimeout(
    (signal) =>
      fetch(new URL("/studio-access", baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token, redirect: "/" }).toString(),
        redirect: "manual",
        signal,
      }),
    5000,
    "studio login"
  );
  const cookie = extractCookie(getSetCookieHeader(response));
  if (!cookie) {
    const { text } = await readResponse(response);
    throw new Error(`Studio access did not return a cookie (${response.status}): ${text}`);
  }
  return cookie;
};

const fetchStudioJson = async (baseUrl, cookie, init = {}) => {
  const response = await withTimeout(
    (signal) =>
      fetch(new URL("/api/studio", baseUrl), {
        ...init,
        headers: {
          Cookie: cookie,
          ...(init.headers || {}),
        },
        signal,
      }),
    5000,
    "studio api"
  );
  const payload = await readResponse(response);
  if (!response.ok) {
    throw new Error(`Studio API ${response.status}: ${payload.text}`);
  }
  return payload.json;
};

const toGatewayProfilesPatch = (profiles) => {
  if (!profiles || typeof profiles !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(profiles)
      .filter(([, profile]) => profile && typeof profile === "object" && typeof profile.url === "string")
      .map(([adapterType, profile]) => [adapterType, { url: profile.url }])
  );
};

const updateGatewaySelection = async (baseUrl, cookie, adapterType, url, profiles) => {
  const body = {
    gateway: {
      adapterType,
      url,
      ...(profiles ? { profiles } : {}),
    },
  };
  return fetchStudioJson(baseUrl, cookie, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
};

const probeGatewayWebSocket = async ({ baseUrl, cookie, label }) =>
  await new Promise((resolve) => {
    const ws = new WebSocket(toWsUrl(baseUrl, "/api/gateway/ws"), {
      headers: {
        Cookie: cookie,
      },
      handshakeTimeout: 5000,
    });

    let settled = false;
    let connectSent = false;
    let fallbackTimer = null;
    const connectId = `smoke-${Date.now()}`;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    const sendConnect = (nonce) => {
      if (connectSent) return;
      connectSent = true;
      const params = {
        minProtocol: GATEWAY_PROTOCOL_VERSION,
        maxProtocol: GATEWAY_PROTOCOL_VERSION,
        client: {
          id: "webchat-ui",
          version: "smoke",
          platform: "node",
          mode: "webchat",
        },
        role: "operator",
        scopes: ["operator.read", "operator.admin", "operator.approvals", "operator.pairing"],
        caps: [],
        auth: {},
        userAgent: "claw3d-smoke-running-gateway",
        locale: "en-US",
      };
      ws.send(
        JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params,
        })
      );
    };

    const timeout = setTimeout(() => finish({ ok: false, detail: "Timed out waiting for gateway response." }), 6500);

    ws.once("open", () => {
      fallbackTimer = setTimeout(() => sendConnect(null), 250);
    });

    ws.on("message", (raw) => {
      const parsed = parseJsonText(String(raw || ""));
      if (!parsed || typeof parsed !== "object") return;
      if (parsed.type === "event" && parsed.event === "connect.challenge") {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        sendConnect(parsed.payload?.nonce || null);
        return;
      }
      if (parsed.type === "res" && parsed.id === connectId) {
        clearTimeout(timeout);
        finish({
          ok: Boolean(parsed.ok),
          detail: parsed.ok ? "Gateway connect succeeded." : JSON.stringify(parsed.error || parsed.payload || {}),
        });
      }
    });

    ws.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      finish({ ok: false, detail: `Unexpected HTTP ${response.statusCode ?? "response"} during WebSocket upgrade.` });
    });

    ws.once("error", (error) => {
      clearTimeout(timeout);
      finish({ ok: false, detail: error instanceof Error ? error.message : "Gateway WebSocket failed." });
    });

    ws.once("close", (code, reason) => {
      if (settled) return;
      clearTimeout(timeout);
      const message = typeof reason === "string" ? reason : String(reason || "");
      finish({ ok: false, detail: `Gateway socket closed early (${code})${message ? `: ${message}` : ""}.` });
    });
  });

const probeIronClawRuntime = async ({ baseUrl, cookie, runtimeUrl }) => {
  const response = await withTimeout(
    (signal) =>
      fetch(new URL("/api/runtime/custom", baseUrl), {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runtimeUrl,
          runtimeAdapterType: "ironclaw",
          pathname: "/api/gateway/status",
          method: "GET",
        }),
        signal,
      }),
    5000,
    "ironclaw proxy"
  );
  const payload = await readResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    text: payload.text,
    json: payload.json,
  };
};

const main = async () => {
  const env = loadEnv();
  const baseUrl = buildBaseUrl(env);
  const studioToken = (env.STUDIO_ACCESS_TOKEN || "").trim();
  const cookie = await loginToStudio(baseUrl, studioToken);
  pushCheck(PASS, "Studio access", `${baseUrl}/studio-access -> cookie acquired`);

  const studioState = await fetchStudioJson(baseUrl, cookie);
  const initialGateway = studioState?.settings?.gateway ?? null;
  const localDefaults = studioState?.localGatewayDefaults ?? null;
  const profiles = localDefaults?.profiles ?? {};

  const restoreProfiles = toGatewayProfilesPatch(initialGateway?.profiles);

  try {
    for (const adapterType of ["openclaw", "hermes"]) {
      const profile = profiles?.[adapterType];
      if (!profile?.url) {
        pushCheck(WARN, `${adapterType} gateway`, `No local ${adapterType} profile is configured in /api/studio.`);
        continue;
      }
      const updated = await updateGatewaySelection(
        baseUrl,
        cookie,
        adapterType,
        profile.url,
        { [adapterType]: { url: profile.url } }
      );
      const selected = updated?.settings?.gateway?.adapterType;
      if (selected !== adapterType) {
        throw new Error(`Studio did not switch to ${adapterType}.`);
      }
      const result = await probeGatewayWebSocket({ baseUrl, cookie, label: adapterType });
      pushCheck(
        result.ok ? PASS : FAIL,
        `${adapterType} gateway proxy`,
        `${profile.url} -> ${result.detail}`
      );
    }

    const ironclawProfile = profiles?.ironclaw;
    if (!ironclawProfile?.url) {
      pushCheck(WARN, "IronClaw runtime proxy", "No local ironclaw profile is configured in /api/studio.");
    } else {
      const updated = await updateGatewaySelection(
        baseUrl,
        cookie,
        "ironclaw",
        ironclawProfile.url,
        { ironclaw: { url: ironclawProfile.url } }
      );
      const selected = updated?.settings?.gateway?.adapterType;
      if (selected !== "ironclaw") {
        throw new Error("Studio did not switch to ironclaw.");
      }
      const result = await probeIronClawRuntime({
        baseUrl,
        cookie,
        runtimeUrl: ironclawProfile.url,
      });
      pushCheck(
        result.ok ? PASS : FAIL,
        "IronClaw runtime proxy",
        `${ironclawProfile.url}/api/gateway/status -> ${result.ok ? result.status : result.status || result.text}`
      );
    }
  } finally {
    if (initialGateway?.adapterType && initialGateway?.url) {
      try {
        await updateGatewaySelection(
          baseUrl,
          cookie,
          initialGateway.adapterType,
          initialGateway.url,
          restoreProfiles
        );
      } catch (error) {
        pushCheck(
          WARN,
          "Studio restore",
          error instanceof Error ? error.message : "Failed to restore initial gateway selection."
        );
      }
    }
  }

  const hasFail = checks.some((check) => check.status === FAIL);
  process.stdout.write(`Summary: ${hasFail ? FAIL : PASS}\n`);
  process.exitCode = hasFail ? 1 : 0;
};

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});