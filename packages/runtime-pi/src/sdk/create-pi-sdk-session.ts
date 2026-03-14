import { createAgentSession, type AgentSession } from "@mariozechner/pi-coding-agent";

export interface CreatePiSdkSessionOptions {
  cwd?: string | null;
}

export async function createPiSdkSession(
  options: CreatePiSdkSessionOptions = {},
): Promise<AgentSession> {
  const result = await createAgentSession({
    cwd: options.cwd ?? process.cwd(),
  });
  return result.session;
}
