import type { RuntimeRegistry } from "@spore/runtime-core";

import { createPiRpcAdapter } from "./pi-rpc-adapter.js";
import { createPiSdkEmbeddedAdapter } from "./pi-sdk-embedded-adapter.js";
import { createPiSdkWorkerAdapter } from "./pi-sdk-worker-adapter.js";

export function registerPiRuntimeBackends(registry: RuntimeRegistry): void {
  registry.register(createPiRpcAdapter());
  registry.register(createPiSdkEmbeddedAdapter());
  registry.register(createPiSdkWorkerAdapter());
}
