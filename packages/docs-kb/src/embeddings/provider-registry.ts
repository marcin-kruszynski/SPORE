import type { EmbeddingProvider } from "../types.js";
import { localHashProvider } from "./local-hash-provider.js";

const providers = new Map<string, EmbeddingProvider>([
  [localHashProvider.id, localHashProvider],
]);

export function getEmbeddingProvider(
  id = localHashProvider.id,
): EmbeddingProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`unknown embedding provider: ${id}`);
  }
  return provider;
}

export function getDefaultEmbeddingProvider(): EmbeddingProvider {
  return localHashProvider;
}
