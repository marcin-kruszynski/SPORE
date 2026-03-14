declare module "@spore/runtime-pi" {
  export { PROJECT_ROOT } from "./metadata/constants.js";
  export { buildSessionPlan } from "./planner/build-session-plan.js";
  export { writeStartupContext } from "./context/build-startup-context.js";
  export {
    createPiRpcAdapter,
    PI_RPC_CAPABILITIES,
  } from "./adapters/pi-rpc-adapter.js";
  export {
    createPiSdkEmbeddedAdapter,
    PI_SDK_EMBEDDED_CAPABILITIES,
  } from "./adapters/pi-sdk-embedded-adapter.js";
  export {
    createPiSdkWorkerAdapter,
    PI_SDK_WORKER_CAPABILITIES,
  } from "./adapters/pi-sdk-worker-adapter.js";
  export {
    registerPiRuntimeBackends,
  } from "./adapters/register-pi-backends.js";
  export {
    appendControlMessage,
    readControlMessagesFromOffset,
  } from "./control/session-control-queue.js";
  export {
    commandExists,
    resolveCommandBinary,
  } from "./launchers/resolve-binary.js";
  export {
    captureTmuxPane,
    sendTmuxText,
    stopTmuxSession,
    tmuxSessionExists,
  } from "./launchers/tmux-launcher.js";
  export type {
    LaunchAssets,
    ProcessResult,
    RuntimeAdapterConfig,
    RuntimeConfig,
    RuntimeProfile,
    RuntimeProjectConfig,
    SessionPlan,
    SessionWorkspace,
    WaitOptions,
  } from "./types.js";
  export {
    createPiSdkSession,
  } from "./sdk/create-pi-sdk-session.js";
  export {
    normalizePiRpcEvent,
  } from "./normalize/pi-rpc-events.js";
  export {
    normalizePiSdkEvent,
  } from "./normalize/pi-sdk-events.js";
  export {
    parseWorkerMessage,
    serializeWorkerMessage,
    WORKER_PROTOCOL_VERSION,
    WorkerCommandSchema,
    WorkerEventSchema,
    WorkerResponseSchema,
  } from "./worker/protocol.js";
}
