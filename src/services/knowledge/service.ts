
import { KnowledgeBaseStore, EmbeddingProvider, KnowledgeDocument, SearchResult } from './types';
import { SQLiteStore } from './store_sqlite';
import { OllamaEmbeddingProvider, AliyunEmbeddingProvider, OpenAIEmbeddingProvider } from './embedding';
import logger from '../../utils/logger';
import path from 'path';

export interface KnowledgeBaseConfig {
  enabled: boolean;
  provider: 'lancedb' | 'sqlite';
  storage_path: string;
  default_collection: string;
  dimension: number;
  embedding: {
    provider: 'openai' | 'ollama' | 'aliyun';
    // Legacy support
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    // New structured config
    ollama?: {
      enabled: boolean;
      model: string;
      baseUrl: string;
      dimension?: number;
    };
    aliyun?: {
      enabled: boolean;
      model: string;
      apiKey: string;
      baseUrl: string;
      dimension?: number;
    };
    openai?: {
      enabled: boolean;
      model: string;
      apiKey: string;
      baseUrl: string;
      dimension?: number;
    };
  };
}

export class KnowledgeBaseService {
  private static instance: KnowledgeBaseService;
  private store: KnowledgeBaseStore;
  private embeddingProvider: EmbeddingProvider;
  private config: KnowledgeBaseConfig;
  private initialized: boolean = false;

  private constructor(config: KnowledgeBaseConfig) {
    this.config = config;
    
    // Factory logic for embedding provider
    const embedConfig = config.embedding || { provider: 'ollama' }; // Default fallback
    const providerName = embedConfig.provider;

    switch (providerName) {
        case 'ollama':
            // Try new config first, then legacy
            const ollamaConfig = embedConfig.ollama;
            if (ollamaConfig && ollamaConfig.enabled) {
                this.embeddingProvider = new OllamaEmbeddingProvider(
                    ollamaConfig.baseUrl,
                    ollamaConfig.model,
                    ollamaConfig.dimension
                );
            } else {
                // Fallback to legacy or default
                this.embeddingProvider = new OllamaEmbeddingProvider(
                    embedConfig.baseUrl || 'http://localhost:11434',
                    embedConfig.model || 'nomic-embed-text'
                );
            }
            break;
            
        case 'aliyun':
            const aliyunConfig = embedConfig.aliyun;
            if (aliyunConfig && aliyunConfig.enabled) {
                if (!aliyunConfig.apiKey) throw new Error('API Key required for Aliyun embedding');
                this.embeddingProvider = new AliyunEmbeddingProvider(
                    aliyunConfig.apiKey,
                    aliyunConfig.model,
                    aliyunConfig.baseUrl,
                    aliyunConfig.dimension
                );
            } else {
                // Legacy
                if (!embedConfig.apiKey) throw new Error('API Key required for Aliyun embedding');
                this.embeddingProvider = new AliyunEmbeddingProvider(
                    embedConfig.apiKey,
                    embedConfig.model || 'text-embedding-v1',
                    embedConfig.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                );
            }
            break;
            
        case 'openai':
            const openaiConfig = embedConfig.openai;
            if (openaiConfig && openaiConfig.enabled) {
                if (!openaiConfig.apiKey) throw new Error('API Key required for OpenAI embedding');
                this.embeddingProvider = new OpenAIEmbeddingProvider(
                    openaiConfig.apiKey,
                    openaiConfig.model,
                    openaiConfig.baseUrl,
                    openaiConfig.dimension
                );
            } else {
                 // Legacy
                if (!embedConfig.apiKey) throw new Error('API Key required for OpenAI embedding');
                this.embeddingProvider = new OpenAIEmbeddingProvider(
                    embedConfig.apiKey,
                    embedConfig.model || 'text-embedding-3-small',
                    embedConfig.baseUrl || 'https://api.openai.com/v1'
                );
            }
            break;
            
        default:
             throw new Error(`Embedding provider ${providerName} not supported`);
    }
    
    // Factory logic for store
    if (config.provider === 'lancedb') {
      try {
        // Dynamically require store_lancedb to avoid loading native module if not used
        const { LanceDBStore } = require('./store_lancedb');
        this.store = new LanceDBStore(config.storage_path);
      } catch (e: any) {
        throw new Error(`Failed to load LanceDBStore: ${e.message}`);
      }
    } else if (config.provider === 'sqlite') {
      this.store = new SQLiteStore(config.storage_path);
    } else {
      throw new Error(`Provider ${config.provider} not implemented yet`);
    }
  }

  static initialize(config: KnowledgeBaseConfig): KnowledgeBaseService {
    if (!KnowledgeBaseService.instance) {
      KnowledgeBaseService.instance = new KnowledgeBaseService(config);
    }
    return KnowledgeBaseService.instance;
  }

  static getInstance(): KnowledgeBaseService | undefined {
    return KnowledgeBaseService.instance;
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    // ... logic ...
    if (!this.config.enabled) {
         // logger.info('KnowledgeBaseService is disabled in config.'); 
         // Reduce noise
         return;
    }

    try {
      await this.store.initialize();
      logger.info(`KnowledgeBaseService started with provider ${this.config.provider}`);
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to start KnowledgeBaseService:', error);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async addDocument(text: string, metadata: Record<string, any> = {}, collection?: string, id?: string): Promise<string> {
    if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');

    const vector = await this.embeddingProvider.getEmbedding(text);
    const docId = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    const doc: KnowledgeDocument = {
      id: docId,
      text,
      vector,
      metadata,
      created_at: Date.now()
    };

    await this.store.addDocuments(collection || this.config.default_collection, [doc]);
    return docId;
  }

  async search(query: string, limit: number = 5, collection?: string): Promise<SearchResult[]> {
    if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');

    const vector = await this.embeddingProvider.getEmbedding(query);
    return await this.store.search(collection || this.config.default_collection, vector, limit);
  }

  async deleteDocument(id: string, collection?: string): Promise<void> {
    if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');
    await this.store.deleteDocument(collection || this.config.default_collection, id);
  }

  async listCollections(): Promise<string[]> {
      if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');
      return await this.store.listCollections();
  }

  async createCollection(name: string): Promise<void> {
      if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');
      await this.store.createCollection(name, this.embeddingProvider.getDimension());
  }

  async deleteCollection(name: string): Promise<void> {
      if (!this.initialized) throw new Error('KnowledgeBaseService not initialized');
      await this.store.deleteCollection(name);
  }
}
