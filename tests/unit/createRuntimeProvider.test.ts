import { describe, expect, it, vi } from "vitest";

import { createRuntimeProvider } from "@/lib/runtime/createRuntimeProvider";

describe("createRuntimeProvider", () => {
  const client = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    call: vi.fn(),
    onStatus: vi.fn(),
    onGap: vi.fn(),
    onEvent: vi.fn(),
  } as never;

  it("returns an IronClaw runtime provider", () => {
    const provider = createRuntimeProvider(
      "ironclaw",
      client,
      "http://localhost:3231",
      "runtime-token"
    );

    expect(provider.id).toBe("ironclaw");
    expect(provider.label).toBe("IronClaw");
    expect(provider.capabilities.has("agents")).toBe(true);
    expect(provider.capabilities.has("chat")).toBe(true);
  });
});