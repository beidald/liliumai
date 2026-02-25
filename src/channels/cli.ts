import readline from 'readline';
import { BaseChannel } from './base';
import { OutboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'CLI' });

export class CLIChannel extends BaseChannel {
  private rl?: readline.Interface;
  private isStreaming: boolean = false;

  get name() { return 'cli'; }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'User: ',
    });

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const content = line.trim();
      if (content) {
        await this.onMessage?.({
          channel: 'cli',
          sender_id: 'user',
          chat_id: 'direct',
          content,
          timestamp: new Date(),
        });
      }
      this.rl?.prompt();
    });

    this.rl.on('close', () => {
      log.info('CLI session ended');
    });

    log.info('CLI channel started');
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (msg.is_stream) {
      if (!this.rl) return;
      
      // If this is the first chunk of a stream, print the header
      if (!this.isStreaming) {
        process.stdout.write('\n\x1b[32mAgent:\x1b[0m ');
        this.isStreaming = true;
      }
      
      process.stdout.write(msg.content);
      // Force flush if needed (though usually not necessary for TTY)
      return;
    }

    // Handle final/non-stream message
    if (this.isStreaming) {
      process.stdout.write('\n');
      this.isStreaming = false;
    } else {
      process.stdout.write('\n');
      console.log(`\x1b[32mAgent:\x1b[0m ${msg.content}`);
    }
    
    this.rl?.prompt();
  }
}
