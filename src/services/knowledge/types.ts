
export interface KnowledgeDocument {
  id: string;
  text: string;
  vector?: number[];
  metadata?: Record<string, any>;
  created_at?: number;
}

export interface SearchResult {
  document: KnowledgeDocument;
  score: number;
}

export interface KnowledgeBaseStore {
  initialize(): Promise<void>;
  addDocuments(collection: string, documents: KnowledgeDocument[]): Promise<void>;
  search(collection: string, vector: number[], limit: number): Promise<SearchResult[]>;
  deleteDocument(collection: string, id: string): Promise<void>;
  listCollections(): Promise<string[]>;
  createCollection(name: string, dimension: number): Promise<void>;
  deleteCollection(name: string): Promise<void>;
}

export interface EmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>;
  getDimension(): number;
}
