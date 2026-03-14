import type {
  RuntimeCapabilities,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeEventEnvelope,
  RuntimeProviderFamily,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "./types.js";

export interface RuntimeAdapterHooks {
  onEvent?(event: RuntimeEventEnvelope): Promise<void> | void;
  onError?(error: Error): Promise<void> | void;
}

export interface RuntimeAdapter {
  readonly providerFamily: RuntimeProviderFamily;
  readonly backendKind: RuntimeSessionBinding["backendKind"];
  readonly capabilities: RuntimeCapabilities;

  start(
    request: RuntimeStartRequest,
    hooks: RuntimeAdapterHooks,
  ): Promise<RuntimeStartResult>;

  attach?(
    binding: RuntimeSessionBinding,
    hooks: RuntimeAdapterHooks,
  ): Promise<RuntimeSessionBinding | null>;

  getSnapshot(binding: RuntimeSessionBinding): Promise<RuntimeSnapshot>;

  sendControl(
    binding: RuntimeSessionBinding,
    command: RuntimeControlCommand,
  ): Promise<RuntimeControlAck>;

  shutdown(binding: RuntimeSessionBinding, reason?: string): Promise<void>;
}
