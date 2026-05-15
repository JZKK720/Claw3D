import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const createGatewayConnectionState = (overrides: Record<string, unknown>) => ({
  client: {
    getLastHello: () => null,
  },
  status: "connected",
  token: "",
  localGatewayDefaults: null,
  error: null,
  connectPromptReady: true,
  shouldPromptForConnect: false,
  connect: async () => {},
  disconnect: () => {},
  useLocalGatewayDefaults: () => {},
  setGatewayUrl: () => {},
  setToken: () => {},
  setSelectedAdapterType: () => {},
  clearError: () => {},
  ...overrides,
});

describe("useRuntimeConnection", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("selects the hermes provider from the active adapter type", async () => {
    vi.doMock("@/lib/gateway/GatewayClient", () => ({
      buildAgentMainSessionKey: (agentId: string, mainKey: string) => `agent:${agentId}:${mainKey}`,
      useGatewayConnection: () => createGatewayConnectionState({
        gatewayUrl: "ws://localhost:18789",
        selectedAdapterType: "hermes",
        detectedAdapterType: "hermes",
        activeAdapterType: "hermes",
      }),
    }));

    const { useRuntimeConnection } = await import("@/lib/runtime/useRuntimeConnection");

    const Probe = () => {
      const state = useRuntimeConnection({} as never);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "providerId" }, state.providerId),
        createElement("div", { "data-testid": "providerLabel" }, state.providerLabel)
      );
    };

    render(createElement(Probe));

    expect(screen.getByTestId("providerId")).toHaveTextContent("hermes");
    expect(screen.getByTestId("providerLabel")).toHaveTextContent("Hermes");
  });

  it("selects the custom provider from the active adapter type", async () => {
    vi.doMock("@/lib/gateway/GatewayClient", () => ({
      buildAgentMainSessionKey: (agentId: string, mainKey: string) => `agent:${agentId}:${mainKey}`,
      useGatewayConnection: () => createGatewayConnectionState({
        gatewayUrl: "http://127.0.0.1:7770",
        selectedAdapterType: "custom",
        detectedAdapterType: "custom",
        activeAdapterType: "custom",
      }),
    }));

    const { useRuntimeConnection } = await import("@/lib/runtime/useRuntimeConnection");

    const Probe = () => {
      const state = useRuntimeConnection({} as never);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "providerId" }, state.providerId),
        createElement("div", { "data-testid": "providerLabel" }, state.providerLabel)
      );
    };

    render(createElement(Probe));

    expect(screen.getByTestId("providerId")).toHaveTextContent("custom");
    expect(screen.getByTestId("providerLabel")).toHaveTextContent("Custom Runtime");
  });

  it("selects the local runtime provider from the active adapter type", async () => {
    vi.doMock("@/lib/gateway/GatewayClient", () => ({
      buildAgentMainSessionKey: (agentId: string, mainKey: string) => `agent:${agentId}:${mainKey}`,
      useGatewayConnection: () => createGatewayConnectionState({
        gatewayUrl: "http://127.0.0.1:7770",
        selectedAdapterType: "local",
        detectedAdapterType: "local",
        activeAdapterType: "local",
      }),
    }));

    const { useRuntimeConnection } = await import("@/lib/runtime/useRuntimeConnection");

    const Probe = () => {
      const state = useRuntimeConnection({} as never);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "providerId" }, state.providerId),
        createElement("div", { "data-testid": "providerLabel" }, state.providerLabel)
      );
    };

    render(createElement(Probe));

    expect(screen.getByTestId("providerId")).toHaveTextContent("local");
    expect(screen.getByTestId("providerLabel")).toHaveTextContent("Local Runtime");
  });

  it("selects the claw3d runtime provider from the active adapter type", async () => {
    vi.doMock("@/lib/gateway/GatewayClient", () => ({
      buildAgentMainSessionKey: (agentId: string, mainKey: string) => `agent:${agentId}:${mainKey}`,
      useGatewayConnection: () => createGatewayConnectionState({
        gatewayUrl: "http://127.0.0.1:3000/api/runtime/custom",
        selectedAdapterType: "claw3d",
        detectedAdapterType: "claw3d",
        activeAdapterType: "claw3d",
      }),
    }));

    const { useRuntimeConnection } = await import("@/lib/runtime/useRuntimeConnection");

    const Probe = () => {
      const state = useRuntimeConnection({} as never);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "providerId" }, state.providerId),
        createElement("div", { "data-testid": "providerLabel" }, state.providerLabel)
      );
    };

    render(createElement(Probe));

    expect(screen.getByTestId("providerId")).toHaveTextContent("claw3d");
    expect(screen.getByTestId("providerLabel")).toHaveTextContent("Claw3D Runtime");
  });
});
