export type EmbeddingVector = number[];

export interface EmbeddingProvider {
  id: string;
  dimensions: number;
  embed(text: string): EmbeddingVector;
}

export interface DocumentChunk {
  order: number;
  sectionTitle: string;
  text: string;
}

export interface IndexedChunk extends DocumentChunk {
  id: string;
  path: string;
  tokens: string[];
}

export interface IndexedDocument {
  id: string;
  path: string;
  hash: string;
  modifiedAt: string;
  chunkCount: number;
  chunks: IndexedChunk[];
}

export interface ExistingDocumentRecord {
  id: string;
  path: string;
  hash: string;
  modifiedAt: string;
  chunkCount: number;
}

export type MetaValue = string | number | boolean | null | undefined;

export interface DocsIndexStatus {
  ok: true;
  indexed: boolean;
  indexPath: string;
  root: string;
  generatedAt: string | null;
  documentCount: number;
  chunkCount: number;
  provider: string | null;
  indexMode: string;
}

export interface SearchChunkResult {
  chunkId: string;
  path: string;
  sectionTitle: string;
  text: string;
  keywordScore: number;
  semanticScore: number;
  score: number;
}

export interface CliParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean | undefined> & {
    json?: boolean;
  };
}
