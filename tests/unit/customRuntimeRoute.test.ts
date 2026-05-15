// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const makeTempDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

describe("/api/runtime/custom route", () => {
  const originalEnv = { ...process.env };
  let tempDir: string | null = null;

  afterEach(() => {
    process.env = { ...originalEnv };
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    vi.restoreAllMocks();
  });

  it("blocks custom runtime proxying in production when no allowlist is configured", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.CUSTOM_RUNTIME_ALLOWLIST;
    delete process.env.UPSTREAM_ALLOWLIST;

    const { POST } = await import("@/app/api/runtime/custom/route");
    const response = await POST(
      new Request("http://localhost/api/runtime/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeUrl: "http://127.0.0.1:7770",
          pathname: "/health",
          method: "GET",
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "runtimeUrl is not in the allowed hosts list.",
    });
  });

  it("allows only listed hosts when a custom runtime allowlist is configured", async () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      CUSTOM_RUNTIME_ALLOWLIST: "127.0.0.1",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { POST } = await import("@/app/api/runtime/custom/route");
    const response = await POST(
      new Request("http://localhost/api/runtime/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeUrl: "http://127.0.0.1:7770",
          pathname: "/health",
          method: "GET",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7770/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns 400 for malformed JSON request bodies", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });

    const { POST } = await import("@/app/api/runtime/custom/route");
    const response = await POST(
      new Request("http://localhost/api/runtime/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid JSON request body.",
    });
  });

  it("uses a server-side ironclaw token when the browser omits it", async () => {
    tempDir = makeTempDir("runtime-custom-ironclaw");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.CUSTOM_RUNTIME_ALLOWLIST = "127.0.0.1";
    process.env.IRONCLAW_GATEWAY_URL = "http://127.0.0.1:7770";

    const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-custom-secrets-"));
    const tokenPath = path.join(secretsDir, "ironclaw-token.txt");
    fs.writeFileSync(tokenPath, "server-ironclaw-token\n", "utf8");
    process.env.IRONCLAW_GATEWAY_TOKEN_FILE = tokenPath;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { POST } = await import("@/app/api/runtime/custom/route");
    const response = await POST(
      new Request("http://localhost/api/runtime/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeUrl: "http://127.0.0.1:7770",
          runtimeAdapterType: "ironclaw",
          pathname: "/api/gateway/status",
          method: "GET",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7770/api/gateway/status",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer server-ironclaw-token",
        }),
      })
    );
  });
});
