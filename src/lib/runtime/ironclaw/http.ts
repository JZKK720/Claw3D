import { fetchCustomRuntimeJson } from "@/lib/runtime/custom/http";

export async function probeIronClawRuntime(
  runtimeUrl: string,
  runtimeToken = ""
): Promise<void> {
  await fetchCustomRuntimeJson(runtimeUrl, "/api/gateway/status", runtimeToken, "ironclaw");
}