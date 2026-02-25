import { Client, GatewayIntentBits, Partials, TextChannel } from 'discord.js';
import { BaseChannel } from './base';
import { OutboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'Discord' });

export class DiscordChannel extends BaseChannel {
  private client?: Client;

  get name() { return 'discord'; }

  constructor(
    private token: string,
    private allowFrom: string[] = []
  ) {
    super();
  }

  async start(): Promise<void> {
    if (!this.token) {
      log.warn('Token not provided, skipping channel');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.client.on('ready', () => {
      log.info(`Started as ${this.client?.user?.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const userId = message.author.id;
      const chatId = message.channelId;

      if (this.allowFrom.length > 0 && !this.allowFrom.includes(userId)) {
        log.warn(`Unauthorized access from user ${userId}`);
        return;
      }

      await this.onMessage?.({
        channel: 'discord',
        sender_id: userId,
        chat_id: chatId,
        content: message.content,
        timestamp: new Date(),
        media: message.attachments.map(a => ({ type: 'file', url: a.url })),
      });
    });

    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(msg.chat_id);
      if (channel instanceof TextChannel || channel?.isTextBased()) {
        await (channel as any).send(msg.content);
      } else {
        const errorMsg = `Channel ${msg.chat_id} is not a text channel`;
        log.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      log.error(`Failed to send message: ${err}`);
      throw new Error(`Failed to send Discord message: ${err.message || err}`);
    }
  }
}
