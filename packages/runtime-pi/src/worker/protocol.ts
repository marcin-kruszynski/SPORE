import { z } from "zod";

export const WORKER_PROTOCOL_VERSION = "1";

const baseEnvelope = {
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  sessionId: z.string(),
  timestamp: z.string(),
};

export const WorkerCommandSchema = z.object({
  ...baseEnvelope,
  messageType: z.literal("command"),
  requestId: z.string(),
  command: z.enum([
    "session.start",
    "session.control",
    "session.snapshot",
    "session.shutdown",
    "runtime.ping",
  ]),
  payload: z.record(z.string(), z.unknown()),
});

export const WorkerResponseSchema = z.object({
  ...baseEnvelope,
  messageType: z.literal("response"),
  requestId: z.string(),
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.record(z.string(), z.unknown()).optional(),
});

export const WorkerEventSchema = z.object({
  ...baseEnvelope,
  messageType: z.literal("event"),
  eventId: z.string(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  payload: z.record(z.string(), z.unknown()),
  rawRef: z.string().nullable(),
});

export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;
export type WorkerEvent = z.infer<typeof WorkerEventSchema>;

export function serializeWorkerMessage(
  message: WorkerCommand | WorkerResponse | WorkerEvent,
): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseWorkerMessage(raw: string): WorkerCommand | WorkerResponse | WorkerEvent {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "messageType" in parsed &&
    (parsed as { messageType?: string }).messageType === "command"
  ) {
    return WorkerCommandSchema.parse(parsed);
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "messageType" in parsed &&
    (parsed as { messageType?: string }).messageType === "response"
  ) {
    return WorkerResponseSchema.parse(parsed);
  }
  return WorkerEventSchema.parse(parsed);
}
