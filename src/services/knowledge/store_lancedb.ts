
import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import * as fs from 'fs';
import { KnowledgeBaseStore, KnowledgeDocument, SearchResult } from './types';
import logger from '../../utils/logger';

export class LanceDBStore implements KnowledgeBaseStore {
  private db: lancedb.Connection | null = null;
  private dbPath: string;

  constructor(storagePath: string) {
    this.dbPath = storagePath;
  }

  async initialize(): Promise<void> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
      }
      this.db = await lancedb.connect(this.dbPath);
      logger.info(`LanceDB initialized at ${this.dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize LanceDB:', error);
      throw error;
    }
  }

  async listCollections(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');
    return await this.db.tableNames();
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = await this.listCollections();
    if (existing.includes(name)) {
      return;
    }

    // Create an empty table with schema implicitly defined by first insertion or explicitly?
    // LanceDB supports creating empty tables with schema.
    // For simplicity and flexibility, we'll let it infer from first data or just create it when adding.
    // But to support explicit creation, we can create a dummy table then clear it, or use schema API.
    // In LanceDB node, createTable needs data or schema.
    // We will defer creation to first add or use a dummy init.
    // Let's create with schema to ensure dimension consistency.
    
    // Actually, LanceDB schema definition in nodejs might be tricky without arrow.
    // We'll skip explicit creation for now and handle it in addDocuments.
    logger.info(`Collection ${name} will be created on first document addition.`);
  }

  async deleteCollection(name: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    try {
        await this.db.dropTable(name);
        logger.info(`Dropped collection ${name}`);
    } catch (e) {
        logger.warn(`Failed to drop collection ${name} (might not exist): ${e}`);
    }
  }

  async addDocuments(collectionName: string, documents: KnowledgeDocument[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    if (documents.length === 0) return;

    // Prepare data for insertion
    const data = documents.map(doc => ({
      id: doc.id,
      text: doc.text,
      vector: doc.vector,
      metadata: JSON.stringify(doc.metadata || {}),
      created_at: doc.created_at || Date.now()
    }));

    try {
      const existing = await this.listCollections();
      let table: lancedb.Table;

      if (existing.includes(collectionName)) {
        table = await this.db.openTable(collectionName);
        await table.add(data);
      } else {
        table = await this.db.createTable(collectionName, data);
      }
      logger.info(`Added ${documents.length} documents to ${collectionName}`);
    } catch (error) {
      logger.error(`Failed to add documents to ${collectionName}:`, error);
      throw error;
    }
  }

  async search(collectionName: string, vector: number[], limit: number): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const existing = await this.listCollections();
      if (!existing.includes(collectionName)) {
        logger.warn(`Collection ${collectionName} does not exist.`);
        return [];
      }

      // In LanceDB JS, vector search is a method on the query builder.
      // And we need to execute it.
      // The API might differ slightly between versions, checking docs/types is good.
      // Assuming standard `vectorSearch` -> `limit` -> `toArray` flow.
      const table = await this.db.openTable(collectionName);
      const results = await table.vectorSearch(vector)
        .limit(limit)
        .toArray();

      return results.map((row: any) => ({
        document: {
          id: row.id,
          text: row.text,
          vector: row.vector,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
          created_at: row.created_at
        },
        score: 1 - (row._distance || 0) 
      }));
    } catch (error) {
      logger.error(`Search failed in ${collectionName}:`, error);
      throw error;
    }
  }

  async deleteDocument(collectionName: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const existing = await this.listCollections();
      if (!existing.includes(collectionName)) return;

      const table = await this.db.openTable(collectionName);
      await table.delete(`id = '${id}'`);
      logger.info(`Deleted document ${id} from ${collectionName}`);
    } catch (error) {
      logger.error(`Failed to delete document ${id} from ${collectionName}:`, error);
      throw error;
    }
  }
}
