import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = async () => {
  for (let i = 0; i < 30; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error("Failed to find a free port for runtime-default smoke test.");
};

const expectedProfiles = {
  openclaw: {
    url: "ws://host.docker.internal:18789",
    tokenConfigured: true,
  },
  hermes: {
    url: "ws://host.docker.internal:18791",
    tokenConfigured: false,
  },
  ironclaw: {
    url: "http://host.docker.internal:3231",
    tokenConfigured: true,
  },
};

const readJson = async (url) => {
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status} for ${url}`);
  }
  return response.json();
};

const assertProfile = (name, actual) => {
  const expected = expectedProfiles[name];
  if (!actual) {
    throw new Error(`Missing ${name} profile in /api/studio response.`);
  }
  if (actual.url !== expected.url) {
    throw new Error(`Profile ${name} URL mismatch: expected ${expected.url}, got ${actual.url}.`);
  }
  if (actual.tokenConfigured !== expected.tokenConfigured) {
    throw new Error(
      `Profile ${name} tokenConfigured mismatch: expected ${expected.tokenConfigured}, got ${actual.tokenConfigured}.`
    );
  }
};

const main = async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-runtime-defaults-"));

  const child = spawn(process.execPath, ["server/index.js", "--dev"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OPENCLAW_STATE_DIR: stateDir,
      STUDIO_ACCESS_TOKEN: "",
      CLAW3D_GATEWAY_URL: expectedProfiles.openclaw.url,
      CLAW3D_GATEWAY_TOKEN: "smoke-openclaw-token",
      CLAW3D_GATEWAY_ADAPTER_TYPE: "openclaw",
      HERMES_ADAPTER_HOST: "host.docker.internal",
      HERMES_ADAPTER_PORT: "18791",
      IRONCLAW_GATEWAY_URL: expectedProfiles.ironclaw.url,
      IRONCLAW_GATEWAY_TOKEN: "smoke-ironclaw-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  const pushLines = (chunk) => {
    const text = String(chunk ?? "");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      if (lines.length > 100) lines.shift();
    }
  };
  child.stdout.on("data", pushLines);
  child.stderr.on("data", pushLines);

  const deadline = Date.now() + 60_000;
  let lastError = null;

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Dev server exited early with code ${child.exitCode}.`);
      }

      try {
        const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
        if (root.status < 200 || root.status >= 500) {
          throw new Error(`Unexpected root status ${root.status}.`);
        }

        const payload = await readJson(`${baseUrl}/api/studio`);
        const localGatewayDefaults = payload?.localGatewayDefaults ?? null;
        const settingsGateway = payload?.settings?.gateway ?? null;
        if (!localGatewayDefaults) {
          throw new Error("Missing localGatewayDefaults in /api/studio response.");
        }

        if (localGatewayDefaults.adapterType !== "openclaw") {
          throw new Error(
            `Expected active adapterType openclaw, got ${localGatewayDefaults.adapterType || "null"}.`
          );
        }

        assertProfile("openclaw", localGatewayDefaults.profiles?.openclaw);
        assertProfile("hermes", localGatewayDefaults.profiles?.hermes);
        assertProfile("ironclaw", localGatewayDefaults.profiles?.ironclaw);

        if (!settingsGateway) {
          throw new Error("Missing settings.gateway in /api/studio response.");
        }
        if (settingsGateway.url !== expectedProfiles.openclaw.url) {
          throw new Error(
            `Expected settings.gateway.url ${expectedProfiles.openclaw.url}, got ${settingsGateway.url}.`
          );
        }

        process.stdout.write(`OK ${baseUrl}/api/studio\n`);
        process.stdout.write("Validated runtime defaults: openclaw, hermes, ironclaw\n");
        return;
      } catch (error) {
        lastError = error;
      }

      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for runtime-default smoke test to pass. Last error: ${lastError?.message || "unknown"}`
    );
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});