import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("loadLocalGatewayDefaults with CLAW3D_GATEWAY_URL", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("returns env-based defaults when CLAW3D_GATEWAY_URL is set and no openclaw.json exists", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://my-gateway:18789";
    process.env.CLAW3D_GATEWAY_TOKEN = "my-token";
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toEqual({
      url: "ws://my-gateway:18789",
      token: "my-token",
      adapterType: "openclaw",
      profiles: {
        openclaw: { url: "ws://my-gateway:18789", token: "my-token" },
      },
    });
  });

  it("returns env-based defaults with empty token when only URL is set", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://my-gateway:18789";
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    delete process.env.CLAW3D_GATEWAY_TOKEN_FILE;
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toEqual({
      url: "ws://my-gateway:18789",
      token: "",
      adapterType: "openclaw",
      profiles: {
        openclaw: { url: "ws://my-gateway:18789", token: "" },
      },
    });
  });

  it("reads runtime tokens from local token files when inline env vars are absent", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://host.docker.internal:18788";
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "openclaw";
    process.env.IRONCLAW_GATEWAY_URL = "http://host.docker.internal:3231";
    delete process.env.IRONCLAW_GATEWAY_TOKEN;

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-defaults-"));
    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-secrets-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const openclawTokenPath = path.join(secretsDir, "openclaw-token.txt");
    const ironclawTokenPath = path.join(secretsDir, "ironclaw-token.txt");
    fs.writeFileSync(openclawTokenPath, "file-openclaw-token\n", "utf8");
    fs.writeFileSync(ironclawTokenPath, "file-ironclaw-token\n", "utf8");
    process.env.CLAW3D_GATEWAY_TOKEN_FILE = openclawTokenPath;
    process.env.IRONCLAW_GATEWAY_TOKEN_FILE = ironclawTokenPath;

    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();

    expect(result).toEqual({
      url: "ws://host.docker.internal:18788",
      token: "file-openclaw-token",
      adapterType: "openclaw",
      profiles: {
        openclaw: {
          url: "ws://host.docker.internal:18788",
          token: "file-openclaw-token",
        },
        ironclaw: {
          url: "http://host.docker.internal:3231",
          token: "file-ironclaw-token",
        },
      },
    });
  });

  it("rehydrates the selected adapter token from matching local defaults", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://host.docker.internal:18788";
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "openclaw";
    process.env.HERMES_ADAPTER_HOST = "host.docker.internal";
    process.env.HERMES_ADAPTER_PORT = "18791";
    process.env.IRONCLAW_GATEWAY_URL = "http://host.docker.internal:3231";
    delete process.env.IRONCLAW_GATEWAY_TOKEN;

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-defaults-"));
    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-secrets-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const openclawTokenPath = path.join(secretsDir, "openclaw-token.txt");
    const ironclawTokenPath = path.join(secretsDir, "ironclaw-token.txt");
    fs.writeFileSync(openclawTokenPath, "file-openclaw-token\n", "utf8");
    fs.writeFileSync(ironclawTokenPath, "file-ironclaw-token\n", "utf8");
    process.env.CLAW3D_GATEWAY_TOKEN_FILE = openclawTokenPath;
    process.env.IRONCLAW_GATEWAY_TOKEN_FILE = ironclawTokenPath;

    fs.mkdirSync(path.join(stateDir, "claw3d"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "claw3d", "settings.json"),
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

    const { loadStudioSettings } = await import("../../src/lib/studio/settings-store");
    const result = loadStudioSettings();

    expect(result.gateway).toEqual({
      url: "http://host.docker.internal:3231",
      token: "file-ironclaw-token",
      adapterType: "ironclaw",
      profiles: {
        openclaw: {
          url: "ws://host.docker.internal:18788",
          token: "file-openclaw-token",
        },
        ironclaw: {
          url: "http://host.docker.internal:3231",
          token: "file-ironclaw-token",
        },
        hermes: {
          url: "ws://host.docker.internal:18791",
          token: "",
        },
      },
    });
  });

  it("returns null when no env var and no openclaw.json", async () => {
    delete process.env.CLAW3D_GATEWAY_URL;
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    delete process.env.CLAW3D_GATEWAY_TOKEN_FILE;
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toBeNull();
  });

  it("prefers env vars over openclaw.json when both exist while preserving the file-backed profile", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://env-gateway:18789";
    process.env.CLAW3D_GATEWAY_TOKEN = "env-token";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "hermes";

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-defaults-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    fs.writeFileSync(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        gateway: {
          port: 18791,
          auth: { token: "file-token" },
        },
      }),
      "utf8"
    );

    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();

    expect(result).toEqual({
      url: "ws://env-gateway:18789",
      token: "env-token",
      adapterType: "hermes",
      profiles: {
        hermes: { url: "ws://env-gateway:18789", token: "env-token" },
        openclaw: { url: "ws://localhost:18791", token: "file-token" },
      },
    });
  });

  it("uses CLAW3D_GATEWAY_ADAPTER_TYPE for Hermes env defaults", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://my-hermes:18789";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "hermes";
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toEqual({
      url: "ws://my-hermes:18789",
      token: "",
      adapterType: "hermes",
      profiles: {
        hermes: { url: "ws://my-hermes:18789", token: "" },
      },
    });
  });

  it("exposes local Hermes adapter defaults when only HERMES_ADAPTER_PORT is set", async () => {
    delete process.env.CLAW3D_GATEWAY_URL;
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    process.env.HERMES_ADAPTER_PORT = "19444";
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toEqual({
      url: "ws://localhost:19444",
      token: "",
      adapterType: "hermes",
      profiles: {
        hermes: { url: "ws://localhost:19444", token: "" },
      },
    });
  });

  it("uses HERMES_ADAPTER_HOST for Docker-hosted Studio defaults", async () => {
    delete process.env.CLAW3D_GATEWAY_URL;
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    process.env.HERMES_ADAPTER_HOST = "host.docker.internal";
    process.env.HERMES_ADAPTER_PORT = "19444";
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();
    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();
    expect(result).toEqual({
      url: "ws://host.docker.internal:19444",
      token: "",
      adapterType: "hermes",
      profiles: {
        hermes: { url: "ws://host.docker.internal:19444", token: "" },
      },
    });
  });

  it("prefers Hermes adapter defaults over file-backed OpenClaw defaults while preserving the OpenClaw profile", async () => {
    delete process.env.CLAW3D_GATEWAY_URL;
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    delete process.env.CLAW3D_GATEWAY_ADAPTER_TYPE;
    process.env.HERMES_ADAPTER_PORT = "19444";

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-defaults-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    fs.writeFileSync(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        gateway: {
          port: 18789,
          auth: { token: "file-token" },
        },
      }),
      "utf8"
    );

    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();

    expect(result).toEqual({
      url: "ws://localhost:19444",
      token: "",
      adapterType: "hermes",
      profiles: {
        hermes: { url: "ws://localhost:19444", token: "" },
        openclaw: { url: "ws://localhost:18789", token: "file-token" },
      },
    });
  });

  it("prefers explicit env adapter defaults over file-backed OpenClaw defaults", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://env-gateway:19999";
    process.env.CLAW3D_GATEWAY_TOKEN = "env-token";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "hermes";

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-gateway-defaults-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    fs.writeFileSync(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify({
        gateway: {
          port: 18789,
          auth: { token: "file-token" },
        },
      }),
      "utf8"
    );

    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();

    expect(result).toEqual({
      url: "ws://env-gateway:19999",
      token: "env-token",
      adapterType: "hermes",
      profiles: {
        openclaw: { url: "ws://localhost:18789", token: "file-token" },
        hermes: { url: "ws://env-gateway:19999", token: "env-token" },
      },
    });
  });

  it("surfaces openclaw, hermes, and ironclaw defaults together from env", async () => {
    process.env.CLAW3D_GATEWAY_URL = "ws://host.docker.internal:18789";
    process.env.CLAW3D_GATEWAY_TOKEN = "openclaw-token";
    process.env.CLAW3D_GATEWAY_ADAPTER_TYPE = "openclaw";
    process.env.HERMES_ADAPTER_HOST = "host.docker.internal";
    process.env.HERMES_ADAPTER_PORT = "18791";
    process.env.IRONCLAW_GATEWAY_URL = "http://host.docker.internal:3231";
    process.env.IRONCLAW_GATEWAY_TOKEN = "ironclaw-token";
    process.env.OPENCLAW_STATE_DIR = "/tmp/claw3d-test-nonexistent-" + Date.now();

    const { loadLocalGatewayDefaults } = await import(
      "../../src/lib/studio/settings-store"
    );
    const result = loadLocalGatewayDefaults();

    expect(result).toEqual({
      url: "ws://host.docker.internal:18789",
      token: "openclaw-token",
      adapterType: "openclaw",
      profiles: {
        openclaw: { url: "ws://host.docker.internal:18789", token: "openclaw-token" },
        ironclaw: {
          url: "http://host.docker.internal:3231",
          token: "ironclaw-token",
        },
        hermes: { url: "ws://host.docker.internal:18791", token: "" },
      },
    });
  });
});
