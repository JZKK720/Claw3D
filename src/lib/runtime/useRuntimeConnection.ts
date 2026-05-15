"use client";

import { useMemo } from "react";

import { type GatewayConnectionState, useGatewayConnection } from "@/lib/gateway/GatewayClient";
import { createRuntimeProvider } from "@/lib/runtime/createRuntimeProvider";
import {
  hasRuntimeCapability,
  type RuntimeCapability,
  type RuntimeProvider,
} from "@/lib/runtime/types";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

const resolveScopedRuntimeCapabilities = (
  provider: RuntimeProvider
): ReadonlySet<RuntimeCapability> => {
  const scopes = provider.getLastHello()?.auth?.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return provider.capabilities;
  }

  const grantedScopes = new Set<string>();
  for (const scope of scopes) {
    if (typeof scope !== "string") continue;
    const trimmed = scope.trim();
    if (!trimmed) continue;
    grantedScopes.add(trimmed);
  }

  const capabilities = new Set(provider.capabilities);
  if (!grantedScopes.has("operator.read")) {
    capabilities.delete("config");
    capabilities.delete("models");
    capabilities.delete("skills");
    capabilities.delete("cron");
  }
  if (
    !grantedScopes.has("operator.admin") &&
    !grantedScopes.has("operator.approvals")
  ) {
    capabilities.delete("approvals");
  }
  return capabilities;
};

export type RuntimeConnectionState = GatewayConnectionState & {
  provider: RuntimeProvider;
  providerId: RuntimeProvider["id"];
  providerLabel: string;
  providerMetadata: RuntimeProvider["metadata"];
  capabilities: ReadonlySet<RuntimeCapability>;
  supportsCapability: (capability: RuntimeCapability) => boolean;
};

export const useRuntimeConnection = (
  settingsCoordinator: StudioSettingsCoordinator
): RuntimeConnectionState => {
  const gateway = useGatewayConnection(settingsCoordinator);
  const provider = useMemo(
    () =>
      createRuntimeProvider(
        gateway.activeAdapterType,
        gateway.client,
        gateway.gatewayUrl,
        gateway.token
      ),
    [gateway.activeAdapterType, gateway.client, gateway.gatewayUrl, gateway.token]
  );
  const helloScopeKey = provider.getLastHello()?.auth?.scopes?.join("|") ?? "";
  const capabilities = useMemo(
    () => resolveScopedRuntimeCapabilities(provider),
    [helloScopeKey, provider]
  );

  return {
    ...gateway,
    provider,
    providerId: provider.id,
    providerLabel: provider.label,
    providerMetadata: provider.metadata,
    capabilities,
    supportsCapability: (capability) => hasRuntimeCapability(capabilities, capability),
  };
};
