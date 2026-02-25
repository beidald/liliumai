import fs from 'fs-extra';
import path from 'path';
import { KnowledgeBaseService } from '../services/knowledge/service';
import logger from '../utils/logger';

// 中文功能描述：MemoryStore类
// 中文参数描述：
// - workspace: 工作空间路径
export class MemoryStore {
  private memoryDir: string;
  private memoryFile: string;
  private historyFile: string;

  constructor(workspace: string) {
    this.memoryDir = path.join(workspace, 'memory');
    fs.ensureDirSync(this.memoryDir);
    this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');
    this.historyFile = path.join(this.memoryDir, 'HISTORY.md');
  }

  readLongTerm(): string {
    if (fs.existsSync(this.memoryFile)) {
      return fs.readFileSync(this.memoryFile, 'utf-8');
    }
    return '';
  }

  writeLongTerm(content: string): void {
    fs.writeFileSync(this.memoryFile, content, 'utf-8');
  }

  appendHistory(entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) return;
    
    fs.appendFileSync(this.historyFile, trimmed + '\n\n', 'utf-8');

    // Sync to Knowledge Base
    const kb = KnowledgeBaseService.getInstance();
    if (kb && kb.isInitialized()) {
        const timestamp = Date.now();
        const id = `history_${timestamp}_${Math.random().toString(36).substring(7)}`;
        
        kb.addDocument(trimmed, {
            source: 'history',
            created_at: timestamp
        }, 'history', id).catch(err => {
            logger.warn(`Failed to sync history to DB: ${err}`);
        });
    }
  }

  getMemoryContext(): string {
    let longTerm = this.readLongTerm();
    if (longTerm) {
      longTerm = longTerm
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    }
    return longTerm ? `## Long-term Memory\n${longTerm}` : '';
  }
}
