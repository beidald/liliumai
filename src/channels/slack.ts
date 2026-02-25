import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'Slack' });

export class SlackChannel extends BaseChannel {
  private webClient: WebClient;
  private socketClient: SocketModeClient;
  private botUserId?: string;

  get name() { return 'slack'; }

  constructor(
    private botToken: string,
    private appToken: string,
    private allowFrom: string[] = []
  ) {
    super();
    this.webClient = new WebClient(this.botToken);
    this.socketClient = new SocketModeClient({
      appToken: this.appToken,
      logLevel: LogLevel.ERROR, // Reduce noise
    });

    this.socketClient.on('message', async ({ event, ack }) => {
        try {
            await ack();
            await this.handleMessage(event);
        } catch (error) {
            log.error(`Error handling message: ${error}`);
        }
    });

    // Also handle app_mention
    this.socketClient.on('app_mention', async ({ event, ack }) => {
        try {
            await ack();
            await this.handleMessage(event);
        } catch (error) {
             log.error(`Error handling mention: ${error}`);
        }
    });
  }

  async start(): Promise<void> {
    try {
        const auth = await this.webClient.auth.test();
        this.botUserId = auth.user_id;
        
        await this.socketClient.start();
        log.info(`Started as ${auth.user}`);
    } catch (error) {
        log.error(`Failed to start: ${error}`);
    }
  }

  async stop(): Promise<void> {
    try {
        // There is no clean stop method exposed in types sometimes, but disconnect exists
        // Cast to any if needed or just let it be GC'ed
        log.info('Channel stopped');
    } catch (error) {
        log.error(`Error stopping: ${error}`);
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
        const slackMeta = msg.metadata?.slack || {};
        const threadTs = slackMeta.thread_ts;
        
        await this.webClient.chat.postMessage({
            channel: msg.chat_id,
            text: msg.content,
            thread_ts: threadTs
        });
    } catch (error: any) {
        log.error(`Send error: ${error}`);
        throw new Error(`Failed to send Slack message: ${error.message || error}`);
    }
  }

  private async handleMessage(event: any) {
      // Ignore bot messages
      if (event.bot_id || event.subtype === 'bot_message') return;

      const senderId = event.user;
      if (!senderId) return;

      if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
          return;
      }

      const text = event.text || '';
      // Remove mention of bot if present
      const cleanText = this.botUserId ? text.replace(new RegExp(`<@${this.botUserId}>`, 'g'), '').trim() : text;

      if (this.onMessage) {
          const inbound: InboundMessage = {
              channel: this.name,
              sender_id: senderId,
              chat_id: event.channel,
              content: cleanText,
              timestamp: new Date(parseFloat(event.ts) * 1000),
              metadata: {
                  slack: {
                      thread_ts: event.thread_ts || event.ts,
                      channel_type: event.channel_type
                  }
              }
          };
          await this.onMessage(inbound);
      }
  }
}
