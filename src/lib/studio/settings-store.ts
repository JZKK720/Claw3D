import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "@/lib/clawdbot/paths";
import {
  defaultStudioSettings,
  mergeStudioSettings,
  normalizeStudioSettings,
  type StudioGatewayAdapterType,
  type StudioGatewayProfile,
  type StudioGatewaySettings,
  type StudioSettings,
  type StudioSettingsPatch,
} from "@/lib/studio/settings";

// Studio settings are intentionally stored as a local JSON file for a single-user workflow.
// That includes gateway connection details, so treat the state directory as plaintext secret
// storage and document any changes to this threat model in README.md and SECURITY.md.
const SETTINGS_DIRNAME = "claw3d";
const SETTINGS_FILENAME = "settings.json";
const OPENCLAW_CONFIG_FILENAME = "openclaw.json";
const DEFAULT_LOCAL_GATEWAY_PORT = 18789;
const DEFAULT_LOCAL_GATEWAY_HOST = "localhost";

export const resolveStudioSettingsPath = () =>
  path.join(resolveStateDir(), SETTINGS_DIRNAME, SETTINGS_FILENAME);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const buildGatewaySettings = (params: {
  adapterType: StudioGatewayAdapterType;
  url: string;
  token?: string;
  profiles?: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>>;
}): StudioGatewaySettings => ({
  url: params.url,
  token: params.token ?? "",
  adapterType: params.adapterType,
  ...(params.profiles ? { profiles: params.profiles } : {}),
});

const buildLocalProfile = (url: string, token = ""): StudioGatewayProfile => ({ url, token });

const resolveSecretFilePath = (rawPath: string | undefined): string | null => {
  const trimmed = rawPath?.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
};

const readSecretFile = (rawPath: string | undefined): string => {
  try {
    const filePath = resolveSecretFilePath(rawPath);
    if (!filePath || !fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
};

const readEnvSecret = (valueEnvKey: string, fileEnvKey: string): string => {
  const inlineValue = process.env[valueEnvKey]?.trim();
  if (inlineValue) return inlineValue;
  return readSecretFile(process.env[fileEnvKey]);
};

const readOpenclawGatewayDefaults = (): StudioGatewaySettings | null => {
  try {
    const configPath = path.join(resolveStateDir(), OPENCLAW_CONFIG_FILENAME);
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const gateway = isRecord(parsed.gateway) ? parsed.gateway : null;
    if (!gateway) return null;
    const auth = isRecord(gateway.auth) ? gateway.auth : null;
    const token = typeof auth?.token === "string" ? auth.token.trim() : "";
    const port = typeof gateway.port === "number" && Number.isFinite(gateway.port) ? gateway.port : null;
    if (!token) return null;
    const url = port ? `ws://localhost:${port}` : `ws://localhost:${DEFAULT_LOCAL_GATEWAY_PORT}`;
    if (!url) return null;
    return buildGatewaySettings({
      adapterType: "openclaw",
      url,
      token,
      profiles: {
        openclaw: buildLocalProfile(url, token),
      },
    });
  } catch {
    return null;
  }
};

const normalizeAdapterType = (value: string | undefined): StudioGatewayAdapterType | null => {
  const normalized = value?.trim().toLowerCase();
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

const readPortBasedGatewayProfile = (
  adapterType: Extract<StudioGatewayAdapterType, "hermes" | "demo">,
  envKey: "HERMES_ADAPTER_PORT" | "DEMO_ADAPTER_PORT",
  hostEnvKey: "HERMES_ADAPTER_HOST" | "DEMO_ADAPTER_HOST"
): StudioGatewayProfile | null => {
  const rawPort = process.env[envKey]?.trim();
  if (!rawPort) return null;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) return null;
  const host = process.env[hostEnvKey]?.trim() || DEFAULT_LOCAL_GATEWAY_HOST;
  return buildLocalProfile(`ws://${host}:${port}`);
};

const buildEnvGatewayDefaults = (): StudioGatewaySettings | null => {
  const envUrl = process.env.CLAW3D_GATEWAY_URL?.trim();
  const envToken = readEnvSecret("CLAW3D_GATEWAY_TOKEN", "CLAW3D_GATEWAY_TOKEN_FILE");
  const envAdapterType =
    normalizeAdapterType(process.env.CLAW3D_GATEWAY_ADAPTER_TYPE) ?? "openclaw";
  const ironclawUrl = process.env.IRONCLAW_GATEWAY_URL?.trim() ?? "";
  const ironclawToken = readEnvSecret("IRONCLAW_GATEWAY_TOKEN", "IRONCLAW_GATEWAY_TOKEN_FILE");

  const hermesProfile = readPortBasedGatewayProfile(
    "hermes",
    "HERMES_ADAPTER_PORT",
    "HERMES_ADAPTER_HOST"
  );
  const demoProfile = readPortBasedGatewayProfile(
    "demo",
    "DEMO_ADAPTER_PORT",
    "DEMO_ADAPTER_HOST"
  );

  const profiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {};
  if (ironclawUrl) profiles.ironclaw = buildLocalProfile(ironclawUrl, ironclawToken);
  if (hermesProfile) profiles.hermes = hermesProfile;
  if (demoProfile) profiles.demo = demoProfile;

  if (envUrl) {
    profiles[envAdapterType] = buildLocalProfile(envUrl, envToken);
    return buildGatewaySettings({
      adapterType: envAdapterType,
      url: envUrl,
      token: envToken,
      profiles,
    });
  }

  const fallbackProfile = profiles.ironclaw ?? profiles.hermes ?? profiles.demo ?? null;
  if (!fallbackProfile) return null;
  const fallbackAdapterType = profiles.ironclaw
    ? "ironclaw"
    : profiles.hermes
      ? "hermes"
      : "demo";
  return buildGatewaySettings({
    adapterType: fallbackAdapterType,
    url: fallbackProfile.url,
    token: fallbackProfile.token,
    profiles,
  });
};

const mergeGatewayProfiles = (
  base: StudioGatewaySettings,
  extra: StudioGatewaySettings | null
): StudioGatewaySettings => {
  if (!extra?.profiles) {
    return base;
  }
  const mergedProfiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {
    ...(base.profiles ?? {}),
  };
  for (const [adapterType, profile] of Object.entries(extra.profiles) as Array<
    [StudioGatewayAdapterType, StudioGatewayProfile | undefined]
  >) {
    if (!profile || mergedProfiles[adapterType]) {
      continue;
    }
    mergedProfiles[adapterType] = profile;
  }
  return {
    ...base,
    profiles: mergedProfiles,
  };
};

const resolveLocalGatewayProfile = (
  adapterType: StudioGatewayAdapterType,
  localDefaults: StudioGatewaySettings | null
): StudioGatewayProfile | null => {
  const explicitProfile = localDefaults?.profiles?.[adapterType];
  if (explicitProfile?.url) {
    return explicitProfile;
  }
  if (localDefaults?.adapterType === adapterType && localDefaults.url?.trim()) {
    return {
      url: localDefaults.url,
      token: localDefaults.token ?? "",
    };
  }
  return null;
};

export const loadLocalGatewayDefaults = (): StudioGatewaySettings | null => {
  const fromFile = readOpenclawGatewayDefaults();
  const fromEnv = buildEnvGatewayDefaults();
  if (fromEnv) {
    return mergeGatewayProfiles(fromEnv, fromFile);
  }
  if (fromFile) {
    return fromFile;
  }
  // No local defaults exist in either source.
  return null;
};

export const loadStudioSettings = (): StudioSettings => {
  const settingsPath = resolveStudioSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    const defaults = defaultStudioSettings();
    const gateway = loadLocalGatewayDefaults();
    return gateway ? { ...defaults, gateway } : defaults;
  }
  const raw = fs.readFileSync(settingsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const settings = normalizeStudioSettings(parsed);
  if (!settings.gateway?.token) {
    const localGatewayDefaults = loadLocalGatewayDefaults();
    if (localGatewayDefaults) {
      if (!settings.gateway?.url?.trim()) {
        return {
          ...settings,
          gateway: localGatewayDefaults,
        };
      }

      const selectedAdapterType = settings.gateway.adapterType;
      const selectedGatewayProfile = resolveLocalGatewayProfile(
        selectedAdapterType,
        localGatewayDefaults
      );
      const mergedProfiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {
        ...(localGatewayDefaults.profiles ?? {}),
        ...(settings.gateway.profiles ?? {}),
      };
      mergedProfiles[selectedAdapterType] = {
        url: settings.gateway.url.trim(),
        token:
          mergedProfiles[selectedAdapterType]?.token ??
          selectedGatewayProfile?.token ??
          "",
      };

      return {
        ...settings,
        gateway: {
          ...settings.gateway,
          url: settings.gateway.url.trim(),
          token: mergedProfiles[selectedAdapterType]?.token ?? "",
          adapterType: selectedAdapterType,
          profiles: mergedProfiles,
        },
      };
    }
  }
  return settings;
};

export const saveStudioSettings = (next: StudioSettings) => {
  const settingsPath = resolveStudioSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
};

export const applyStudioSettingsPatch = (patch: StudioSettingsPatch): StudioSettings => {
  const current = loadStudioSettings();
  const next = mergeStudioSettings(current, patch);
  saveStudioSettings(next);
  return next;
};
