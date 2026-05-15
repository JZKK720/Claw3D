const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moltbot"];
const NEW_STATE_DIRNAME = ".openclaw";

const resolveUserPath = (input) => {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
};

const resolveDefaultHomeDir = () => {
  const home = os.homedir();
  if (home) {
    try {
      if (fs.existsSync(home)) return home;
    } catch {}
  }
  return os.tmpdir();
};

const resolveStateDir = (env = process.env) => {
  const override =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);

  const home = resolveDefaultHomeDir();
  const newDir = path.join(home, NEW_STATE_DIRNAME);
  const legacyDirs = LEGACY_STATE_DIRNAMES.map((dir) => path.join(home, dir));
  try {
    if (fs.existsSync(newDir)) return newDir;
  } catch {}
  for (const dir of legacyDirs) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {}
  }
  return newDir;
};

const resolveStudioSettingsPath = (env = process.env) => {
  return path.join(resolveStateDir(env), "claw3d", "settings.json");
};

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const resolveSecretFilePath = (input) => {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
};

const readSecretFile = (rawPath) => {
  try {
    const filePath = resolveSecretFilePath(rawPath);
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
};

const readEnvSecret = (env, valueEnvKey, fileEnvKey) => {
  const inlineValue = typeof env[valueEnvKey] === "string" ? env[valueEnvKey].trim() : "";
  if (inlineValue) return inlineValue;
  return readSecretFile(env[fileEnvKey]);
};

const DEFAULT_GATEWAY_URL = "ws://localhost:18789";
const OPENCLAW_CONFIG_FILENAME = "openclaw.json";
const DEFAULT_LOCAL_GATEWAY_HOST = "localhost";

const isRecord = (value) => Boolean(value && typeof value === "object");

const isProxyManagedAdapterType = (adapterType) =>
  adapterType === "openclaw" || adapterType === "hermes" || adapterType === "demo";

const normalizeAdapterType = (value, fallback = "openclaw") => {
  const adapterType = String(value ?? "").trim().toLowerCase();
  if (
    adapterType === "demo" ||
    adapterType === "ironclaw" ||
    adapterType === "hermes" ||
    adapterType === "openclaw" ||
    adapterType === "local" ||
    adapterType === "claw3d" ||
    adapterType === "custom"
  ) {
    return adapterType;
  }
  return fallback;
};

const buildLocalProfile = (url, token = "") => ({ url, token });

const readOpenclawGatewayDefaults = (env = process.env) => {
  try {
    const stateDir = resolveStateDir(env);
    const configPath = path.join(stateDir, OPENCLAW_CONFIG_FILENAME);
    const parsed = readJsonFile(configPath);
    if (!isRecord(parsed)) return null;
    const gateway = isRecord(parsed.gateway) ? parsed.gateway : null;
    if (!gateway) return null;
    const auth = isRecord(gateway.auth) ? gateway.auth : null;
    const token = typeof auth?.token === "string" ? auth.token.trim() : "";
    const port =
      typeof gateway.port === "number" && Number.isFinite(gateway.port) ? gateway.port : null;
    if (!token) return null;
    const url = port ? `ws://localhost:${port}` : "";
    if (!url) return null;
    return {
      url,
      token,
      adapterType: "openclaw",
      profiles: {
        openclaw: buildLocalProfile(url, token),
      },
    };
  } catch {
    return null;
  }
};

const readPortBasedGatewayProfile = (env, envKey, hostEnvKey) => {
  const rawPort = typeof env[envKey] === "string" ? env[envKey].trim() : "";
  if (!rawPort) return null;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) return null;
  const host = typeof env[hostEnvKey] === "string" && env[hostEnvKey].trim()
    ? env[hostEnvKey].trim()
    : DEFAULT_LOCAL_GATEWAY_HOST;
  return buildLocalProfile(`ws://${host}:${port}`);
};

const mergeGatewayProfiles = (base, extra) => {
  if (!extra?.profiles) return base;
  const profiles = {
    ...(base.profiles ?? {}),
  };
  for (const [adapterType, profile] of Object.entries(extra.profiles)) {
    if (!profile || profiles[adapterType]) continue;
    profiles[adapterType] = profile;
  }
  return {
    ...base,
    profiles,
  };
};

const buildEnvGatewayDefaults = (env = process.env) => {
  const envUrl = typeof env.CLAW3D_GATEWAY_URL === "string" ? env.CLAW3D_GATEWAY_URL.trim() : "";
  const envToken = readEnvSecret(env, "CLAW3D_GATEWAY_TOKEN", "CLAW3D_GATEWAY_TOKEN_FILE");
  const envAdapterType = normalizeAdapterType(env.CLAW3D_GATEWAY_ADAPTER_TYPE, "openclaw");
  const ironclawUrl = typeof env.IRONCLAW_GATEWAY_URL === "string" ? env.IRONCLAW_GATEWAY_URL.trim() : "";
  const ironclawToken = readEnvSecret(env, "IRONCLAW_GATEWAY_TOKEN", "IRONCLAW_GATEWAY_TOKEN_FILE");
  const hermesProfile = readPortBasedGatewayProfile(env, "HERMES_ADAPTER_PORT", "HERMES_ADAPTER_HOST");
  const demoProfile = readPortBasedGatewayProfile(env, "DEMO_ADAPTER_PORT", "DEMO_ADAPTER_HOST");

  const profiles = {};
  if (ironclawUrl) profiles.ironclaw = buildLocalProfile(ironclawUrl, ironclawToken);
  if (hermesProfile) profiles.hermes = hermesProfile;
  if (demoProfile) profiles.demo = demoProfile;

  if (envUrl) {
    profiles[envAdapterType] = buildLocalProfile(envUrl, envToken);
    return {
      url: envUrl,
      token: envToken,
      adapterType: envAdapterType,
      profiles,
    };
  }

  const fallbackProfile = profiles.ironclaw || profiles.hermes || profiles.demo || null;
  if (!fallbackProfile) return null;
  const fallbackAdapterType = profiles.ironclaw ? "ironclaw" : profiles.hermes ? "hermes" : "demo";
  return {
    url: fallbackProfile.url,
    token: fallbackProfile.token,
    adapterType: fallbackAdapterType,
    profiles,
  };
};

const loadLocalGatewayDefaults = (env = process.env) => {
  const fromFile = readOpenclawGatewayDefaults(env);
  const fromEnv = buildEnvGatewayDefaults(env);
  if (fromEnv) return mergeGatewayProfiles(fromEnv, fromFile);
  if (fromFile) return fromFile;
  return null;
};

const resolveLocalGatewayProfile = (adapterType, localDefaults) => {
  const explicitProfile = localDefaults?.profiles?.[adapterType];
  if (explicitProfile?.url) return explicitProfile;
  if (localDefaults?.adapterType === adapterType && localDefaults.url) {
    return buildLocalProfile(localDefaults.url, localDefaults.token || "");
  }
  return null;
};

const resolveSavedGatewayProfile = (adapterType, gateway) => {
  const savedProfiles = isRecord(gateway?.profiles) ? gateway.profiles : null;
  const profile = isRecord(savedProfiles?.[adapterType]) ? savedProfiles[adapterType] : null;
  if (!profile) return null;
  const url = typeof profile.url === "string" ? profile.url.trim() : "";
  const token = typeof profile.token === "string" ? profile.token.trim() : "";
  if (!url) return null;
  return { url, token };
};

const resolveLastKnownGoodGateway = (gateway) => {
  const lastKnownGood = isRecord(gateway?.lastKnownGood) ? gateway.lastKnownGood : null;
  if (!lastKnownGood) return null;
  const adapterType = normalizeAdapterType(lastKnownGood.adapterType, "");
  if (!isProxyManagedAdapterType(adapterType)) {
    return null;
  }
  const url = typeof lastKnownGood.url === "string" ? lastKnownGood.url.trim() : "";
  const token = typeof lastKnownGood.token === "string" ? lastKnownGood.token.trim() : "";
  if (!url) return null;
  return { url, token, adapterType };
};

const resolveProxyTargetAdapterType = (adapterType, gateway, localDefaults) => {
  if (isProxyManagedAdapterType(adapterType)) {
    return adapterType;
  }
  const lastKnownGood = resolveLastKnownGoodGateway(gateway);
  if (lastKnownGood) {
    return lastKnownGood.adapterType;
  }
  for (const candidate of ["openclaw", "hermes", "demo"]) {
    if (resolveSavedGatewayProfile(candidate, gateway)?.url) {
      return candidate;
    }
  }
  if (isProxyManagedAdapterType(localDefaults?.adapterType)) {
    return localDefaults.adapterType;
  }
  return "openclaw";
};

const loadUpstreamGatewaySettings = (env = process.env) => {
  const settingsPath = resolveStudioSettingsPath(env);
  const parsed = readJsonFile(settingsPath);
  const gateway = parsed && typeof parsed === "object" ? parsed.gateway : null;
  const selectedUrl = typeof gateway?.url === "string" ? gateway.url.trim() : "";
  const selectedToken = typeof gateway?.token === "string" ? gateway.token.trim() : "";
  const selectedAdapterType = normalizeAdapterType(gateway?.adapterType, "openclaw");
  const localDefaults = loadLocalGatewayDefaults(env);
  const adapterType = resolveProxyTargetAdapterType(selectedAdapterType, gateway, localDefaults);
  const lastKnownGood = resolveLastKnownGoodGateway(gateway);
  const savedProfile = resolveSavedGatewayProfile(adapterType, gateway);
  const localProfile = resolveLocalGatewayProfile(adapterType, localDefaults);
  const preferredUrl = isProxyManagedAdapterType(selectedAdapterType)
    ? selectedUrl
    : lastKnownGood?.adapterType === adapterType
      ? lastKnownGood.url
      : "";
  const preferredToken = isProxyManagedAdapterType(selectedAdapterType)
    ? selectedToken
    : lastKnownGood?.adapterType === adapterType
      ? lastKnownGood.token
      : "";
  return {
    url: preferredUrl || savedProfile?.url || localProfile?.url || DEFAULT_GATEWAY_URL,
    token: preferredToken || savedProfile?.token || localProfile?.token || "",
    adapterType,
    settingsPath,
  };
};

module.exports = {
  resolveStateDir,
  resolveStudioSettingsPath,
  loadUpstreamGatewaySettings,
};
