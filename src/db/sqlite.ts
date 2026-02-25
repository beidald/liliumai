import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';
import logger from '../utils/logger';

export class SQLiteDB {
  private static instance: SQLiteDB;
  private db: Database;

  private constructor(workspaceRoot?: string) {
    const root = workspaceRoot || process.cwd();
    const workspaceDir = path.join(root, 'workspace');
    fs.ensureDirSync(workspaceDir);
    
    const dbPath = path.join(workspaceDir, 'nanobot.db');
    logger.info(`Initializing SQLite DB at: ${dbPath}`);
    this.db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    this.initSchema();
  }

  public static getInstance(workspaceRoot?: string): SQLiteDB {
    if (!SQLiteDB.instance) {
      SQLiteDB.instance = new SQLiteDB(workspaceRoot);
    }
    return SQLiteDB.instance;
  }

  public getDb(): Database {
    return this.db;
  }

  private initSchema() {
    try {
      // 1. Core Tasks Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          name TEXT,                  -- Short description or user prompt
          type TEXT DEFAULT 'prompt', -- 'prompt' | 'code' | 'composite'
          content TEXT NOT NULL,      -- Prompt text or Description (Code is in task_codes)
          status TEXT DEFAULT 'pending', -- pending, running, completed, failed, paused
          schedule TEXT,              -- Cron expression (optional)
          next_run INTEGER,           -- Timestamp for next scheduled execution
          
          -- Execution Control
          max_executions INTEGER DEFAULT -1,
          execution_count INTEGER DEFAULT 0,
          retry_limit INTEGER DEFAULT 0,
          timeout_ms INTEGER DEFAULT 30000,
          
          -- Metadata
          priority INTEGER DEFAULT 1,
          tags TEXT,                  -- JSON string
          params TEXT,                -- JSON string of runtime parameters
          created_at INTEGER,
          updated_at INTEGER,
          
          -- Legacy/Compatibility
          result TEXT,
          error_log TEXT
        );
      `);

      // 2. Task Codes Table (Separated for cleaner metadata queries)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS task_codes (
          task_id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          language TEXT DEFAULT 'python',
          entry_point TEXT DEFAULT 'run',
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
      `);

      // 3. Execution History (Audit Trail)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS task_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT,
          status TEXT,                -- success, failed
          output TEXT,                -- Result or Error message
          duration_ms INTEGER,
          executed_at INTEGER,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
      `);

      // 4. Admin Users Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'admin',
          created_at INTEGER,
          updated_at INTEGER
        );
      `);

      // 5. Linked Accounts Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS linked_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          provider TEXT NOT NULL,       -- e.g., 'wechat', 'feishu'
          provider_id TEXT NOT NULL,    -- e.g., wxid_..., open_id
          provider_name TEXT,           -- e.g., nickname
          provider_data TEXT,           -- JSON string for extra info (avatar, tokens, etc.)
          created_at INTEGER,
          updated_at INTEGER,
          FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
          UNIQUE(provider, provider_id) -- Prevent same external account linking multiple times (or maybe per user?)
        );
      `);

      // 5. User Sessions Table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER,
          created_at INTEGER,
          expires_at INTEGER,
          FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
        );
      `);

      // Add name column if not exists (migration)
      try {
        this.db.exec('ALTER TABLE tasks ADD COLUMN name TEXT');
      } catch (e) {
        // Ignore if column exists
      }

      // Add params column if not exists (migration)
      try {
        this.db.exec('ALTER TABLE tasks ADD COLUMN params TEXT');
      } catch (e) {
        // Ignore if column exists
      }

      // Add origin tracking columns if not exist (migration)
      try {
        this.db.exec('ALTER TABLE tasks ADD COLUMN origin_channel TEXT');
      } catch (e) {
        // Ignore if column exists
      }
      try {
        this.db.exec('ALTER TABLE tasks ADD COLUMN origin_chat_id TEXT');
      } catch (e) {
        // Ignore if column exists
      }

      logger.info('SQLite schema initialized successfully');
    } catch (error: any) {
      logger.error(`Failed to initialize SQLite schema: ${error.message}`);
      throw error;
    }
  }
}
