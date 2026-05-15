import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const PASS = "PASS";
const WARN = "WARN";
const FAIL = "FAIL";

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

const resolveSecretFilePath = (rawPath) => {
  const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
};

const readEnvSecret = (env, valueEnvKey, fileEnvKey) => {
  const inlineValue = env[valueEnvKey]?.trim();
  if (inlineValue) return inlineValue;
  try {
    const filePath = resolveSecretFilePath(env[fileEnvKey]);
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
};

const remapProbeUrl = (rawUrl) => {
  const parsed = new URL(rawUrl);
  if (parsed.hostname === "host.docker.internal") {
    parsed.hostname = "127.0.0.1";
  }
  return parsed.toString();
};

const probeWebSocket = async (url, timeoutMs = 3500) =>
  await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(result);
    };

    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
    const timer = setTimeout(
      () => finish({ ok: false, message: `Timed out after ${timeoutMs}ms.` }),
      timeoutMs + 250,
    );

    socket.once("open", () => finish({ ok: true, message: "WebSocket handshake succeeded." }));
    socket.once("unexpected-response", (_req, res) =>
      finish({
        ok: false,
        message: `Unexpected HTTP ${res.statusCode ?? "response"} during WebSocket upgrade.`,
      }),
    );
    socket.once("error", (error) =>
      finish({
        ok: false,
        message: error instanceof Error ? error.message : "WebSocket handshake failed.",
      }),
    );
  });

const probeHttp = async (url, { headers = {}, timeoutMs = 3500 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : "HTTP probe failed.",
    };
  } finally {
    clearTimeout(timer);
  }
};

const checks = [];

const pushCheck = (status, label, detail) => {
  checks.push({ status, label, detail });
  process.stdout.write(`[${status}] ${label}: ${detail}\n`);
};

const main = async () => {
  const env = loadEnv();
  const hermesApiKey = readEnvSecret(env, "HERMES_API_KEY", "HERMES_API_KEY_FILE");
  const ironclawToken = readEnvSecret(env, "IRONCLAW_GATEWAY_TOKEN", "IRONCLAW_GATEWAY_TOKEN_FILE");

  const openclawUrl = (env.CLAW3D_GATEWAY_URL || "").trim();
  if (openclawUrl) {
    const result = await probeWebSocket(remapProbeUrl(openclawUrl));
    pushCheck(
      result.ok ? PASS : FAIL,
      "OpenClaw gateway",
      `${openclawUrl} -> ${result.message}`,
    );
  } else {
    pushCheck(WARN, "OpenClaw gateway", "CLAW3D_GATEWAY_URL is not set.");
  }

  const hermesApiUrl = (env.HERMES_API_URL || "").trim();
  if (hermesApiUrl) {
    const health = await probeHttp(`${remapProbeUrl(hermesApiUrl).replace(/\/$/, "")}/health`);
    if (health.ok) {
      pushCheck(PASS, "Hermes API health", `${hermesApiUrl}/health -> ${health.status}`);
    } else {
      pushCheck(WARN, "Hermes API health", `${hermesApiUrl}/health -> ${health.status || health.text}`);
    }

    const authHeader = hermesApiKey
      ? { Authorization: `Bearer ${hermesApiKey}` }
      : {};
    const models = await probeHttp(
      `${remapProbeUrl(hermesApiUrl).replace(/\/$/, "")}/v1/models`,
      { headers: authHeader },
    );
    if (models.ok) {
      pushCheck(PASS, "Hermes API models", `${hermesApiUrl}/v1/models -> ${models.status}`);
    } else if (models.status === 401 || models.status === 403) {
      pushCheck(WARN, "Hermes API models", `${hermesApiUrl}/v1/models -> ${models.status} (reachable but auth is missing or invalid)`);
    } else {
      pushCheck(FAIL, "Hermes API models", `${hermesApiUrl}/v1/models -> ${models.status || models.text}`);
    }
  } else {
    pushCheck(WARN, "Hermes API", "HERMES_API_URL is not set.");
  }

  const hermesAdapterHost = (env.HERMES_ADAPTER_HOST || "").trim();
  const hermesAdapterPort = (env.HERMES_ADAPTER_PORT || "").trim();
  if (hermesAdapterHost && hermesAdapterPort) {
    const hermesAdapterUrl = `ws://${hermesAdapterHost}:${hermesAdapterPort}`;
    const result = await probeWebSocket(remapProbeUrl(hermesAdapterUrl));
    pushCheck(
      result.ok ? PASS : FAIL,
      "Hermes adapter",
      `${hermesAdapterUrl} -> ${result.message}`,
    );
  } else {
    pushCheck(WARN, "Hermes adapter", "HERMES_ADAPTER_HOST or HERMES_ADAPTER_PORT is not set.");
  }

  const ironclawUrl = (env.IRONCLAW_GATEWAY_URL || "").trim();
  if (ironclawUrl) {
    const root = await probeHttp(remapProbeUrl(ironclawUrl));
    if (root.ok) {
      pushCheck(PASS, "IronClaw root", `${ironclawUrl} -> ${root.status}`);
    } else {
      pushCheck(FAIL, "IronClaw root", `${ironclawUrl} -> ${root.status || root.text}`);
    }

    const gatewayStatus = await probeHttp(
      `${remapProbeUrl(ironclawUrl).replace(/\/$/, "")}/api/gateway/status`,
      ironclawToken
        ? { headers: { Authorization: `Bearer ${ironclawToken}` } }
        : {},
    );
    if (gatewayStatus.ok) {
      pushCheck(PASS, "IronClaw gateway API", `${ironclawUrl}/api/gateway/status -> ${gatewayStatus.status}`);
    } else if (gatewayStatus.status === 401 || gatewayStatus.status === 403) {
      pushCheck(WARN, "IronClaw gateway API", `${ironclawUrl}/api/gateway/status -> ${gatewayStatus.status} (reachable but auth is missing or invalid)`);
    } else {
      pushCheck(FAIL, "IronClaw gateway API", `${ironclawUrl}/api/gateway/status -> ${gatewayStatus.status || gatewayStatus.text}`);
    }
  } else {
    pushCheck(WARN, "IronClaw", "IRONCLAW_GATEWAY_URL is not set.");
  }

  const hasFail = checks.some((check) => check.status === FAIL);
  process.stdout.write(`Summary: ${hasFail ? FAIL : PASS}\n`);
  process.exitCode = hasFail ? 1 : 0;
};

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});