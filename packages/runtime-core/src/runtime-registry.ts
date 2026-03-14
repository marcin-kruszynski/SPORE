import type { RuntimeAdapter, RuntimeSessionBinding } from "./index.js";

export class RuntimeRegistry {
  readonly #adapters = new Map<RuntimeSessionBinding["backendKind"], RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    this.#adapters.set(adapter.backendKind, adapter);
  }

  get(backendKind: RuntimeSessionBinding["backendKind"]): RuntimeAdapter | null {
    return this.#adapters.get(backendKind) ?? null;
  }

  require(backendKind: RuntimeSessionBinding["backendKind"]): RuntimeAdapter {
    const adapter = this.get(backendKind);
    if (!adapter) {
      throw new Error(`no runtime adapter registered for backend kind: ${backendKind}`);
    }
    return adapter;
  }
}
