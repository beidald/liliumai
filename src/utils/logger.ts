import pino from 'pino';
import pretty from 'pino-pretty';
import { Writable } from 'stream';
import { AsyncLocalStorage } from 'async_hooks';
import chalk from 'chalk';

// --- Async Context for User Isolation ---
export const logContext = new AsyncLocalStorage<{ sessionId: string }>();

// --- Log Buffer for AI Context ---
export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  sessionId?: string;
  module?: string;
  [key: string]: any;
}

class LogBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number = 100; // Increased size for multi-user context

  add(entry: LogEntry) {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /**
   * Get errors and warnings that occurred after the specified timestamp
   * Optionally filtered by sessionId
   */
  getRecentErrorsAndWarnings(since?: number, sessionId?: string): LogEntry[] {
    return this.buffer.filter(log => {
      // Basic level and time filter
      const isRelevant = (log.level >= 40) && (!since || log.time > since);
      if (!isRelevant) return false;

      // Session isolation logic:
      // 1. If no sessionId requested, return everything (system-wide view)
      // 2. If log has no sessionId, it's a global system log -> return it
      // 3. If log has sessionId, it must match the requested sessionId
      if (sessionId) {
        return !log.sessionId || log.sessionId === sessionId;
      }
      
      return true;
    });
  }
  
  clear() {
    this.buffer = [];
  }
}

export const logBuffer = new LogBuffer();

// --- Color Helper ---
const moduleColors: Record<string, chalk.Chalk> = {
  'TaskPoller': chalk.cyan.bold,
  'Wechat': chalk.green.bold,
  'Web': chalk.blue.bold,
  'System': chalk.magenta.bold,
  'CLI': chalk.yellow.bold,
  'Agent': chalk.hex('#FFA500').bold, // Orange
  'LLM': chalk.hex('#8A2BE2').bold,   // BlueViolet
  'Bus': chalk.gray.bold,
};

const getColor = (moduleName: string) => {
    // Check if it's a sub-module (e.g. Wechat:Scan)
    const baseModule = moduleName.split(':')[0];
    if (moduleColors[baseModule]) return moduleColors[baseModule];
    if (moduleColors[moduleName]) return moduleColors[moduleName];
    
    // Hash to pick a consistent color
    const colors = [chalk.red, chalk.green, chalk.yellow, chalk.blue, chalk.magenta, chalk.cyan];
    let hash = 0;
    for (let i = 0; i < moduleName.length; i++) {
        hash = moduleName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length].bold;
}

// --- Stream Interception ---
const prettyStream = pretty({
  colorize: true,
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname,module',
  messageFormat: (log, messageKey) => {
    const msg = log[messageKey] as string;
    let moduleName = log.module as string;
    let finalMsg = msg;

    // Try to extract [Module] from message if module property is missing
    // Matches [Module] or [Module:SubModule] at the start
    if (!moduleName && typeof msg === 'string' && msg.trim().startsWith('[')) {
        const match = msg.trim().match(/^\[([^\]]+)\]/);
        if (match) {
            moduleName = match[1];
            // Remove the prefix from the message
            finalMsg = msg.replace(match[0], '').trim();
        }
    }

    if (moduleName) {
        const color = getColor(moduleName);
        return `${color(`[${moduleName}]`)} ${finalMsg}`;
    }
    
    return finalMsg;
  }
});

// Create a stream that forks logs to both buffer and pretty printer
const capturingStream = new Writable({
  write(chunk, encoding, callback) {
    const line = chunk.toString();
    try {
      // Parse JSON log line
      const log = JSON.parse(line);
      
      // Capture warnings and errors (level >= 40)
      if (log.level && log.level >= 40) {
        // Try to retrieve sessionId from AsyncLocalStorage if not in log
        const store = logContext.getStore();
        if (store?.sessionId) {
          log.sessionId = store.sessionId;
        }
        logBuffer.add(log);
      }
      
      // Pass the log object directly to prettyStream.write if it's a string
      // But prettyStream expects a string (JSON) or object.
      // Since we already parsed it, we might want to let pretty handle the raw chunk
      // However, capturingStream is a Writable, prettyStream is a Transform/Writable.
      
    } catch (e) {
      // Ignore parse errors, just pass through
    }
    // Forward to pretty printer for console output
    prettyStream.write(chunk, encoding, callback);
  }
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: { pid: false },
  },
  capturingStream
);

export default logger;
