import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const makeTempDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe("server studio upstream gateway settings", () => {
  const priorStateDir = process.env.OPENCLAW_STATE_DIR;
  const priorGatewayUrl = process.env.CLAW3D_GATEWAY_URL;
  const priorGatewayToken = process.env.CLAW3D_GATEWAY_TOKEN;
  const priorGatewayTokenFile = process.env.CLAW3D_GATEWAY_TOKEN_FILE;
  const priorGatewayAdapterType = process.env.CLAW3D_GATEWAY_ADAPTER_TYPE;
  const priorIronclawUrl = process.env.IRONCLAW_GATEWAY_URL;
  const priorIronclawToken = process.env.IRONCLAW_GATEWAY_TOKEN;
  const priorIronclawTokenFile = process.env.IRONCLAW_GATEWAY_TOKEN_FILE;
  const priorHermesAdapterHost = process.env.HERMES_ADAPTER_HOST;
  const priorHermesAdapterPort = process.env.HERMES_ADAPTER_PORT;
  let tempDir: string | null = null;

  afterEach(() => {
    restoreEnv("OPENCLAW_STATE_DIR", priorStateDir);
    restoreEnv("CLAW3D_GATEWAY_URL", priorGatewayUrl);
    restoreEnv("CLAW3D_GATEWAY_TOKEN", priorGatewayToken);
    restoreEnv("CLAW3D_GATEWAY_TOKEN_FILE", priorGatewayTokenFile);
    restoreEnv("CLAW3D_GATEWAY_ADAPTER_TYPE", priorGatewayAdapterType);
    restoreEnv("IRONCLAW_GATEWAY_URL", priorIronclawUrl);
    restoreEnv("IRONCLAW_GATEWAY_TOKEN", priorIronclawToken);
    restoreEnv("IRONCLAW_GATEWAY_TOKEN_FILE", priorIronclawTokenFile);
    restoreEnv("HERMES_ADAPTER_HOST", priorHermesAdapterHost);
    restoreEnv("HERMES_ADAPTER_PORT", priorHermesAdapterPort);
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("falls back to openclaw.json token/port when studio settings are missing", async () => {
    tempDir = makeTempDir("studio-upstream-openclaw-defaults");
    process.env.OPENCLAW_STATE_DIR = tempDir;

    fs.writeFileSync(
      path.join(tempDir, "openclaw.json"),
      JSON.stringify({ gateway: { port: 18790, auth: { token: "tok" } } }, null, 2),
      "utf8"
    );

    const { loadUpstreamGatewaySettings } = await import("../../server/studio-settings");
    const settings = loadUpstreamGatewaySettings(process.env);
    expect(settings.url).toBe("ws://localhost:18790");
    expect(settings.token).toBe("tok");
  });

  it("keeps a configured url and fills token from openclaw.json when missing", async () => {
    tempDir = makeTempDir("studio-upstream-url-keep");
    process.env.OPENCLAW_STATE_DIR = tempDir;

    fs.mkdirSync(path.join(tempDir, "claw3d"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "claw3d", "settings.json"),
      JSON.stringify({ gateway: { url: "ws://gateway.example:18789", token: "" } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "openclaw.json"),
      JSON.stringify({ gateway: { port: 18789, auth: { token: "tok-local" } } }, null, 2),
      "utf8"
    );

    const { loadUpstreamGatewaySettings } = await import("../../server/studio-settings");
    const settings = loadUpstreamGatewaySettings(process.env);
    expect(settings.url).toBe("ws://gateway.example:18789");
    expect(settings.token).toBe("tok-local");
  });

  it("falls back to an auto-managed profile when the saved selection is ironclaw", async () => {
    tempDir = makeTempDir("studio-upstream-ironclaw-defaults");
    process.env.OPENCLAW_STATE_DIR = tempDir;

    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-upstream-secrets-"));
    process.env.CLAW3D_GATEWAY_URL = "ws://host.docker.internal:18788";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "openclaw";
    process.env.IRONCLAW_GATEWAY_URL = "http://host.docker.internal:3231";
    process.env.HERMES_ADAPTER_HOST = "host.docker.internal";
    process.env.HERMES_ADAPTER_PORT = "18791";

    const openclawTokenPath = path.join(secretsDir, "openclaw-token.txt");
    const ironclawTokenPath = path.join(secretsDir, "ironclaw-token.txt");
    fs.writeFileSync(openclawTokenPath, "env-openclaw-token\n", "utf8");
    fs.writeFileSync(ironclawTokenPath, "env-ironclaw-token\n", "utf8");
    process.env.CLAW3D_GATEWAY_TOKEN_FILE = openclawTokenPath;
    process.env.IRONCLAW_GATEWAY_TOKEN_FILE = ironclawTokenPath;

    fs.mkdirSync(path.join(tempDir, "claw3d"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "claw3d", "settings.json"),
      JSON.stringify(
        {
          gateway: {
            url: "http://host.docker.internal:3231",
            token: "",
            adapterType: "ironclaw",
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const { loadUpstreamGatewaySettings } = await import("../../server/studio-settings");
    const settings = loadUpstreamGatewaySettings(process.env);
    expect(settings.url).toBe("ws://host.docker.internal:18788");
    expect(settings.token).toBe("env-openclaw-token");
    expect(settings.adapterType).toBe("openclaw");
  });

  it("falls back to the last known good auto-managed profile when the current selection is not proxy-managed", async () => {
    tempDir = makeTempDir("studio-upstream-last-known-good");
    process.env.OPENCLAW_STATE_DIR = tempDir;

    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-upstream-secrets-"));
    process.env.CLAW3D_GATEWAY_URL = "ws://host.docker.internal:18788";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "openclaw";
    process.env.IRONCLAW_GATEWAY_URL = "http://host.docker.internal:3231";
    process.env.HERMES_ADAPTER_HOST = "host.docker.internal";
    process.env.HERMES_ADAPTER_PORT = "18791";

    const openclawTokenPath = path.join(secretsDir, "openclaw-token.txt");
    fs.writeFileSync(openclawTokenPath, "env-openclaw-token\n", "utf8");
    process.env.CLAW3D_GATEWAY_TOKEN_FILE = openclawTokenPath;

    fs.mkdirSync(path.join(tempDir, "claw3d"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "claw3d", "settings.json"),
      JSON.stringify(
        {
          gateway: {
            url: "ws://host.docker.internal:18791",
            token: "",
            adapterType: "ironclaw",
            profiles: {
              openclaw: {
                url: "ws://host.docker.internal:18788",
                token: "",
              },
              ironclaw: {
                url: "ws://host.docker.internal:18791",
                token: "",
              },
            },
            lastKnownGood: {
              url: "ws://host.docker.internal:18788",
              token: "",
              adapterType: "openclaw",
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const { loadUpstreamGatewaySettings } = await import("../../server/studio-settings");
    const settings = loadUpstreamGatewaySettings(process.env);
    expect(settings.url).toBe("ws://host.docker.internal:18788");
    expect(settings.token).toBe("env-openclaw-token");
    expect(settings.adapterType).toBe("openclaw");
  });
});
