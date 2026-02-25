import { SQLiteDB } from '../db/sqlite';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import logger from '../utils/logger';

const scryptAsync = promisify(scrypt);

export interface User {
  id: number;
  username: string;
  role: string;
  created_at: number;
  updated_at: number;
}

export interface LinkedAccount {
  id: number;
  user_id: number;
  provider: string;
  provider_id: string;
  provider_name?: string;
  provider_data?: any;
  created_at: number;
  updated_at: number;
}

export class UserService {
  private static instance: UserService;
  private db = SQLiteDB.getInstance().getDb();

  private constructor() {}

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    const [salt, key] = hash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return timingSafeEqual(keyBuffer, derivedKey);
  }

  async createUser(username: string, password: string, role: string = 'admin'): Promise<User> {
    const passwordHash = await this.hashPassword(password);
    const now = Date.now();
    
    try {
      const stmt = this.db.prepare(`
        INSERT INTO admin_users (username, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const info = stmt.run(username, passwordHash, role, now, now);
      
      return {
        id: info.lastInsertRowid as number,
        username,
        role,
        created_at: now,
        updated_at: now
      };
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Username already exists');
      }
      throw error;
    }
  }

  getUser(username: string): User | undefined {
    const stmt = this.db.prepare('SELECT id, username, role, created_at, updated_at FROM admin_users WHERE username = ?');
    return stmt.get(username) as User | undefined;
  }

  async verifyUser(username: string, password: string): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM admin_users WHERE username = ?');
    const user = stmt.get(username) as any;

    if (!user) return null;

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) return null;

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  }

  listUsers(): User[] {
    const stmt = this.db.prepare('SELECT id, username, role, created_at, updated_at FROM admin_users');
    return stmt.all() as User[];
  }

  async changePassword(username: string, newPassword: string): Promise<boolean> {
    const passwordHash = await this.hashPassword(newPassword);
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      UPDATE admin_users 
      SET password_hash = ?, updated_at = ?
      WHERE username = ?
    `);
    
    const info = stmt.run(passwordHash, now, username);
    return info.changes > 0;
  }

  deleteUser(username: string): boolean {
    const stmt = this.db.prepare('DELETE FROM admin_users WHERE username = ?');
    const info = stmt.run(username);
    return info.changes > 0;
  }
  
  hasUsers(): boolean {
    const stmt = this.db.prepare('SELECT count(*) as count FROM admin_users');
    const result = stmt.get() as { count: number };
    return result.count > 0;
  }

  // --- Session Management ---

  createSession(userId: number, token: string, expiresInMs: number = 7 * 24 * 3600 * 1000): void {
    const now = Date.now();
    const expiresAt = now + expiresInMs;
    
    const stmt = this.db.prepare(`
      INSERT INTO user_sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(token, userId, now, expiresAt);
  }

  verifySession(token: string): User | null {
    const stmt = this.db.prepare(`
      SELECT u.id, u.username, u.role, u.created_at, u.updated_at, s.expires_at
      FROM user_sessions s
      JOIN admin_users u ON s.user_id = u.id
      WHERE s.token = ?
    `);
    
    const result = stmt.get(token) as any;
    
    if (!result) return null;
    
    if (Date.now() > result.expires_at) {
      // Session expired, clean it up
      this.deleteSession(token);
      return null;
    }
    
    return {
      id: result.id,
      username: result.username,
      role: result.role,
      created_at: result.created_at,
      updated_at: result.updated_at
    };
  }

  deleteSession(token: string): void {
    const stmt = this.db.prepare('DELETE FROM user_sessions WHERE token = ?');
    stmt.run(token);
  }

  cleanupExpiredSessions(): void {
    const stmt = this.db.prepare('DELETE FROM user_sessions WHERE expires_at < ?');
    stmt.run(Date.now());
  }

  // --- Linked Accounts ---

  linkAccount(userId: number, provider: string, providerId: string, providerName?: string, providerData?: any): void {
    const now = Date.now();
    const dataStr = providerData ? JSON.stringify(providerData) : null;
    
    // Check if already linked to ANY user (enforce uniqueness)
    const existing = this.db.prepare('SELECT id, user_id FROM linked_accounts WHERE provider = ? AND provider_id = ?').get(provider, providerId) as { id: number, user_id: number } | undefined;
    
    if (existing) {
        // If linked to another user, update it (re-bind/steal) or just update info if same user
        // We will allow re-binding to the current user
        const stmt = this.db.prepare(`
            UPDATE linked_accounts 
            SET user_id = ?, provider_name = ?, provider_data = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.run(userId, providerName, dataStr, now, existing.id);
    } else {
        // Create new link
        const stmt = this.db.prepare(`
          INSERT INTO linked_accounts (user_id, provider, provider_id, provider_name, provider_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(userId, provider, providerId, providerName, dataStr, now, now);
    }
  }

  getLinkedAccounts(userId: number): LinkedAccount[] {
    const stmt = this.db.prepare('SELECT * FROM linked_accounts WHERE user_id = ?');
    const rows = stmt.all(userId) as any[];
    return rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        provider: r.provider,
        provider_id: r.provider_id,
        provider_name: r.provider_name,
        provider_data: r.provider_data ? JSON.parse(r.provider_data) : null,
        created_at: r.created_at,
        updated_at: r.updated_at
    }));
  }
  
  unlinkAccount(userId: number, provider: string, providerId: string): void {
      const stmt = this.db.prepare('DELETE FROM linked_accounts WHERE user_id = ? AND provider = ? AND provider_id = ?');
      stmt.run(userId, provider, providerId);
  }
}
