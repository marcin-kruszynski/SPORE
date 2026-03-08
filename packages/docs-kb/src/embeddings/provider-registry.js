import { localHashProvider } from "./local-hash-provider.js";

const providers = new Map([[localHashProvider.id, localHashProvider]]);

export function getEmbeddingProvider(id = localHashProvider.id) {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`unknown embedding provider: ${id}`);
  }
  return provider;
}

export function getDefaultEmbeddingProvider() {
  return localHashProvider;
}
