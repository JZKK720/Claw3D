import { CustomRuntimeProvider } from "@/lib/runtime/custom/provider";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { DemoRuntimeProvider } from "@/lib/runtime/demo/provider";
import { HermesRuntimeProvider } from "@/lib/runtime/hermes/provider";
import { IronClawRuntimeProvider } from "@/lib/runtime/ironclaw/provider";
import { OpenClawRuntimeProvider } from "@/lib/runtime/openclaw/provider";
import type { RuntimeProvider } from "@/lib/runtime/types";
import type { StudioGatewayAdapterType } from "@/lib/studio/settings";

export const createRuntimeProvider = (
  providerId: RuntimeProvider["id"] | StudioGatewayAdapterType,
  client: GatewayClient,
  runtimeUrl: string,
  runtimeToken = ""
): RuntimeProvider => {
  switch (providerId) {
    case "local":
      return new CustomRuntimeProvider(client, runtimeUrl, {
        id: "local",
        label: "Local Runtime",
        runtimeName: "Local Runtime",
        routeProfile: "local",
        runtimeToken,
      });
    case "claw3d":
      return new CustomRuntimeProvider(client, runtimeUrl, {
        id: "claw3d",
        label: "Claw3D Runtime",
        runtimeName: "Claw3D Runtime",
        routeProfile: "claw3d",
        runtimeToken,
      });
    case "custom":
      return new CustomRuntimeProvider(client, runtimeUrl, {
        id: "custom",
        label: "Custom Runtime",
        runtimeName: "Custom Runtime",
        routeProfile: "custom",
        runtimeToken,
      });
    case "ironclaw":
      return new IronClawRuntimeProvider(client, runtimeUrl, runtimeToken);
    case "demo":
      return new DemoRuntimeProvider(client);
    case "hermes":
      return new HermesRuntimeProvider(client);
    case "openclaw":
    default:
      return new OpenClawRuntimeProvider(client);
  }
};
