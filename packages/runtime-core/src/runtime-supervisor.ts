import type {
  RuntimeAdapterHooks,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "./index.js";
import { RuntimeRegistry } from "./runtime-registry.js";

export interface RuntimeSupervisorOptions {
  registry: RuntimeRegistry;
}

export class RuntimeSupervisor {
  readonly #registry: RuntimeRegistry;

  constructor(options: RuntimeSupervisorOptions) {
    this.#registry = options.registry;
  }

  async start(
    request: RuntimeStartRequest,
    hooks: RuntimeAdapterHooks = {},
  ): Promise<RuntimeStartResult> {
    const adapter = this.#registry.require(request.backendKind);
    return adapter.start(request, hooks);
  }

  async getSnapshot(binding: RuntimeSessionBinding): Promise<RuntimeSnapshot> {
    const adapter = this.#registry.require(binding.backendKind);
    return adapter.getSnapshot(binding);
  }

  async sendControl(
    binding: RuntimeSessionBinding,
    command: RuntimeControlCommand,
  ): Promise<RuntimeControlAck> {
    const adapter = this.#registry.require(binding.backendKind);
    return adapter.sendControl(binding, command);
  }

  async shutdown(binding: RuntimeSessionBinding, reason?: string): Promise<void> {
    const adapter = this.#registry.require(binding.backendKind);
    await adapter.shutdown(binding, reason);
  }
}
