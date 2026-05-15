import { defineConfig } from "@playwright/test";
import path from "node:path";

const resolvePlaywrightPort = () => {
  const raw = process.env.PLAYWRIGHT_PORT?.trim() || "3000";
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 3000;
};

const playwrightPort = resolvePlaywrightPort();
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() || `http://127.0.0.1:${playwrightPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL,
  },
  webServer: {
    command: "npm run dev",
    port: playwrightPort,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: String(playwrightPort),
      OPENCLAW_STATE_DIR: path.resolve("./tests/fixtures/openclaw-empty-state"),
      NEXT_PUBLIC_GATEWAY_URL: "",
    },
  },
});
