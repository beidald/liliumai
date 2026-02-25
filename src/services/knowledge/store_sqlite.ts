import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { KnowledgeBaseStore, KnowledgeDocument, SearchResult } from './types';
import logger from '../../utils/logger';

export class SQLiteStore implements KnowledgeBaseStore {
  private connections: Map<string, Database> = new Map();
  private dbDir: string;

  constructor(storagePath: string) {
    // If storagePath ends with .sqlite or .db, treat dirname as the root for multi-file
    // But since we are moving to multi-file, we prefer storagePath to be a directory.
    // If it's a file, we'll use its directory.
    if (storagePath.endsWith('.sqlite') || storagePath.endsWith('.db')) {
        this.dbDir = path.dirname(storagePath);
    } else {
        this.dbDir = storagePath;
    }
  }

  async initialize(): Promise<void> {
    try {
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }
      logger.info(`SQLite Knowledge Base initialized at ${this.dbDir}`);
    } catch (error) {
      logger.error('Failed to initialize SQLite Knowledge Base:', error);
      throw error;
    }
  }

  private getDatabase(collectionName: string): Database {
    const cleanName = collectionName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (this.connections.has(cleanName)) {
      return this.connections.get(cleanName)!;
    }

    const dbPath = path.join(this.dbDir, `${cleanName}.sqlite`);
    const db = new Database(dbPath);
    sqliteVec.load(db as any);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize base tables for this collection DB
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER
      );
    `);

    this.connections.set(cleanName, db);
    return db;
  }

  private ensureVectorTable(db: Database, dimension: number) {
    // Check if dimension matches existing
    const row = db.prepare("SELECT value FROM meta WHERE key = 'dimension'").get() as { value: string } | undefined;
    if (row) {
        const storedDim = parseInt(row.value, 10);
        if (storedDim !== dimension) {
            logger.warn(`Collection database has dimension ${storedDim} but requested ${dimension}. Using stored dimension.`);
            // We could throw error, but for now just warn. 
            // If we proceed, vector insert might fail if dimension mismatch is enforced by sqlite-vec
        }
    } else {
        db.prepare("INSERT INTO meta (key, value) VALUES ('dimension', ?)").run(dimension.toString());
    }

    // Create vector table
    // In multi-file mode, we can just call it 'vectors'
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
        embedding float[${dimension}]
      );
    `);
  }

  async listCollections(): Promise<string[]> {
    if (!fs.existsSync(this.dbDir)) return [];
    const files = fs.readdirSync(this.dbDir);
    return files
        .filter(f => f.endsWith('.sqlite'))
        .map(f => path.basename(f, '.sqlite'));
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    const db = this.getDatabase(name);
    this.ensureVectorTable(db, dimension);
    logger.info(`Created collection ${name} with dimension ${dimension} in ${name}.sqlite`);
  }

  async deleteCollection(name: string): Promise<void> {
    const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // Close connection if open
    if (this.connections.has(cleanName)) {
        this.connections.get(cleanName)!.close();
        this.connections.delete(cleanName);
    }

    const dbPath = path.join(this.dbDir, `${cleanName}.sqlite`);
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        // Also remove -shm and -wal files if they exist
        if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
        if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
        logger.info(`Dropped collection ${name} (deleted ${dbPath})`);
    } else {
        logger.warn(`Collection ${name} does not exist`);
    }
  }
  
  async deleteDocument(collection: string, id: string): Promise<void> {
    const db = this.getDatabase(collection);
    
    // Get rowid from documents before deleting
    const row = db.prepare('SELECT rowid FROM documents WHERE id = ?').get(id) as { rowid: number };
    
    if (row) {
        db.prepare('DELETE FROM documents WHERE id = ?').run(id);
        
        try {
           db.prepare('DELETE FROM vectors WHERE rowid = ?').run(row.rowid);
        } catch (e) {
            // Ignore error if table doesn't exist
        }
    }
  }

  async addDocuments(collectionName: string, documents: KnowledgeDocument[]): Promise<void> {
    if (documents.length === 0) return;

    const db = this.getDatabase(collectionName);
    const dim = documents[0].vector?.length || 1536;
    this.ensureVectorTable(db, dim);
    
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (id, text, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertVec = db.prepare(`
       INSERT INTO vectors(rowid, embedding)
       VALUES (?, vec_normalize(?))
     `);

     const getRowId = db.prepare('SELECT rowid FROM documents WHERE id = ?');
     const deleteVec = db.prepare('DELETE FROM vectors WHERE rowid = ?');

     const transaction = db.transaction((docs: KnowledgeDocument[]) => {
       for (const doc of docs) {
         // Insert document metadata
         insertDoc.run(
           doc.id,
           doc.text,
           JSON.stringify(doc.metadata || {}),
           doc.created_at || Date.now()
         );
 
         // Insert vector using the rowid from the document insert
         const row = getRowId.get(doc.id) as { rowid: number | bigint };
         if (row) {
             // Remove old vector if exists (update scenario)
             deleteVec.run(row.rowid);
             
             if (doc.vector && doc.vector.length > 0) {
                 const vectorBuffer = Buffer.from(new Float32Array(doc.vector).buffer);
                 insertVec.run(BigInt(row.rowid), vectorBuffer);
             }
         }
       }
     });

    try {
      transaction(documents);
      logger.info(`Added ${documents.length} documents to ${collectionName}`);
    } catch (error) {
      logger.error(`Failed to add documents to ${collectionName}:`, error);
      throw error;
    }
  }

  async search(collectionName: string, queryVector: number[], limit: number): Promise<SearchResult[]> {
    const db = this.getDatabase(collectionName);
    
    // Check if vector table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'").get();
    if (!tableExists) {
        logger.warn(`Vector table does not exist for collection ${collectionName}`);
        return [];
    }

    const query = `
      SELECT 
        d.id, d.text, d.metadata, d.created_at,
        v.distance
      FROM vectors v
      JOIN documents d ON v.rowid = d.rowid
      WHERE v.embedding MATCH vec_normalize(?)
        AND k = ?
      ORDER BY v.distance
    `;

    try {
        const vectorBuffer = Buffer.from(new Float32Array(queryVector).buffer);
        const rows = db.prepare(query).all(vectorBuffer, limit) as any[];

        return rows.map(row => ({
          document: {
            id: row.id,
            text: row.text,
            vector: [], 
            metadata: JSON.parse(row.metadata),
            created_at: row.created_at
          },
          score: 1 - row.distance
        }));
    } catch (error) {
        logger.error('Vector search failed:', error);
        return [];
    }
  }
}
