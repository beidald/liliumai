import fs from 'fs-extra';
import path from 'path';
import logger from '../utils/logger';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  timestamp: string;
  tools_used?: string[];
  tool_call_id?: string;
  name?: string;
  is_intermediate?: boolean;
  metadata?: any;
}

export interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
  lastMessage: string;
}

export class Session {
  messages: Message[] = [];
  title: string = 'New Chat';
  stopRequested: boolean = false;

  constructor(public id: string) {}

  requestStop() {
    this.stopRequested = true;
  }

  clearStop() {
    this.stopRequested = false;
  }

  isStopRequested(): boolean {
    return this.stopRequested;
  }

  addMessage(role: Message['role'], content: string | null, extra: Partial<Message> = {}) {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  }

  getMessages(): Message[] {
    return this.messages;
  }

  setMessages(messages: Message[]) {
    this.messages = messages;
  }

  getTitle(): string {
    return this.title;
  }

  setTitle(title: string) {
    this.title = title;
  }

  getHistory(): any[] {
    return this.messages.map((m) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      if (m.metadata) msg.metadata = m.metadata;
      if (m.timestamp) msg.timestamp = m.timestamp;
      return msg;
    });
  }

  clear() {
    this.messages = [];
  }
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionsDir: string;

  constructor(workspace: string) {
    this.sessionsDir = path.join(workspace, 'sessions');
    fs.ensureDirSync(this.sessionsDir);
  }

  getOrCreate(id: string): Session {
    if (this.sessions.has(id)) {
      return this.sessions.get(id)!;
    }

    const session = new Session(id);
    this.load(session);
    this.sessions.set(id, session);
    return session;
  }

  private getFilePath(id: string): string {
    return path.join(this.sessionsDir, `${encodeURIComponent(id)}.json`);
  }

  save(session: Session) {
    const filePath = this.getFilePath(session.id);
    try {
      const data = {
        id: session.id,
        messages: session.messages,
        title: session.title || (session.messages.length > 0 ? session.messages[0].content?.slice(0, 50) : 'New Chat')
      };
      fs.writeJsonSync(filePath, data, { spaces: 2 });
    } catch (err) {
      logger.error(`Failed to save session ${session.id}: ${err}`);
    }
  }

  private load(session: Session) {
    // Try new encoding format first
    let filePath = this.getFilePath(session.id);
    
    // Fallback to legacy format
    if (!fs.existsSync(filePath)) {
      const legacyPath = path.join(this.sessionsDir, `${session.id.replace(/:/g, '_')}.json`);
      if (fs.existsSync(legacyPath)) {
        filePath = legacyPath;
      }
    }

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readJsonSync(filePath);
        if (Array.isArray(data)) {
          // Legacy format
          session.messages = data;
        } else {
          session.messages = data.messages || [];
          session.title = data.title || 'New Chat';
        }
      } catch (err) {
        logger.error(`Failed to load session ${session.id}: ${err}`);
      }
    }
  }

  listSessions(prefix: string): SessionInfo[] {
    try {
      const files = fs.readdirSync(this.sessionsDir);
      
      // Filter relevant files first
      const relevantFiles = files.filter(f => f.endsWith('.json'));
      
      return relevantFiles
        .map(f => {
          const filePath = path.join(this.sessionsDir, f);
          let id = '';
          
          // Try to decode ID from filename
          try {
            if (f.includes('%')) {
              // New format: URL encoded
              id = decodeURIComponent(f.replace('.json', ''));
            } else {
              // Legacy format: _ replaced :
              // Try to reconstruct ID for migration
              // Pattern: web_user_xxx_thread_yyy -> web:user_xxx:thread_yyy
              // We know the structure is channel:sessionId:threadId
              // And sessionId usually starts with user_ and threadId with thread_
              const match = f.match(/^(web)_(user_[^_]+)_(thread_[^_]+)\.json$/);
              if (match) {
                id = `${match[1]}:${match[2]}:${match[3]}`;
                
                // MIGRATE: Rename file to new format
                const newPath = this.getFilePath(id);
                if (!fs.existsSync(newPath)) {
                  try {
                      // Read content to ensure we have the ID inside
                      const content = fs.readJsonSync(filePath);
                      if (!Array.isArray(content) && !content.id) {
                          content.id = id;
                          fs.writeJsonSync(filePath, content, { spaces: 2 });
                      }
                      fs.renameSync(filePath, newPath);
                      logger.info(`Migrated session file ${f} to ${path.basename(newPath)}`);
                  } catch (e) {
                      logger.error(`Failed to migrate session file ${f}: ${e}`);
                  }
                }
              } else {
                // Fallback for unknown patterns: just replace _ with :
                id = f.replace('.json', '').replace(/_/g, ':');
              }
            }
          } catch (e) {
            logger.warn(`Failed to parse session ID from filename ${f}`);
            return null;
          }

          // Check if ID matches prefix
          if (!id.startsWith(prefix)) {
            return null;
          }

          const stats = fs.statSync(filePath); // Note: might be the OLD path if migration failed, or NEW path if migrated?
          // Actually, if we migrated, filePath still points to old path which might not exist anymore.
          // Let's re-resolve path based on ID.
          const actualPath = this.getFilePath(id);
          if (!fs.existsSync(actualPath)) return null;

          const data = fs.readJsonSync(actualPath);
          
          let title = 'New Chat';
          let lastMessage = '';
          
          if (Array.isArray(data)) {
            title = data.length > 0 ? data[0].content?.slice(0, 50) : 'New Chat';
            lastMessage = data.length > 0 ? data[data.length-1].content : '';
          } else {
            title = data.title || (data.messages?.length > 0 ? data.messages[0].content?.slice(0, 50) : 'New Chat');
            lastMessage = data.messages?.length > 0 ? data.messages[data.messages.length-1].content : '';
          }

          return {
            id,
            title,
            updatedAt: stats.mtime.toISOString(),
            lastMessage: lastMessage?.slice(0, 100) || ''
          };
        })
        .filter((s): s is SessionInfo => s !== null)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch (err) {
      logger.error(`Failed to list sessions for ${prefix}: ${err}`);
      return [];
    }
  }

  deleteSession(id: string) {
    const filePath = this.getFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.removeSync(filePath);
      this.sessions.delete(id);
    } else {
        // Try legacy path
        const legacyPath = path.join(this.sessionsDir, `${id.replace(/:/g, '_')}.json`);
        if (fs.existsSync(legacyPath)) {
            fs.removeSync(legacyPath);
            this.sessions.delete(id);
        }
    }
  }
}
