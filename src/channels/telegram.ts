import { Telegraf } from 'telegraf';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import axios from 'axios';
import { BaseChannel } from './base';
import { InboundMessage, OutboundMessage } from '../bus/events';
import { TranscriptionProvider } from '../providers/transcription';
import logger from '../utils/logger';

const log = logger.child({ module: 'Telegram' });

export class TelegramChannel extends BaseChannel {
  private bot?: Telegraf;

  get name() { return 'telegram'; }

  constructor(
    private token: string,
    private allowFrom: string[] = [],
    private proxy?: string,
    private transcriptionProvider?: TranscriptionProvider
  ) {
    super();
  }

  async start(): Promise<void> {
    if (!this.token) {
      log.warn('Telegram token not provided, skipping Telegram channel');
      return;
    }

    const options: any = {};
    if (this.proxy) {
      // telegraf proxy support usually via https-proxy-agent
      log.warn('Telegram proxy support not fully implemented in this version');
    }

    this.bot = new Telegraf(this.token, options);

    this.bot.on('text', async (ctx) => {
      const userId = ctx.from?.id.toString();
      const chatId = ctx.chat.id.toString();
      const text = ctx.message.text;

      if (this.allowFrom.length > 0 && userId && !this.allowFrom.includes(userId)) {
        log.warn(`Unauthorized access attempt from Telegram user ${userId}`);
        return;
      }

      await this.onMessage?.({
        channel: 'telegram',
        sender_id: userId || 'unknown',
        chat_id: chatId,
        content: text,
        timestamp: new Date(),
      });
    });

    this.bot.on('photo', async (ctx) => {
      const userId = ctx.from?.id.toString();
      const chatId = ctx.chat.id.toString();
      const text = ctx.message.caption || '';
      
      if (this.allowFrom.length > 0 && userId && !this.allowFrom.includes(userId)) {
        return;
      }

      // Handle photo (get the largest one)
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);

      await this.onMessage?.({
        channel: 'telegram',
        sender_id: userId || 'unknown',
        chat_id: chatId,
        content: text,
        media: [{ type: 'image', url: fileLink.toString() }],
        timestamp: new Date(),
      });
    });

    this.bot.on('voice', async (ctx) => {
      const userId = ctx.from?.id.toString();
      const chatId = ctx.chat.id.toString();
      
      if (this.allowFrom.length > 0 && userId && !this.allowFrom.includes(userId)) {
        return;
      }

      if (!this.transcriptionProvider) {
        log.warn('Voice message received but no transcription provider configured');
        await ctx.reply('抱歉，目前未配置语音转文字功能。');
        return;
      }

      try {
        const fileId = ctx.message.voice.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        
        // Download file to temp
        const tempPath = path.join(os.tmpdir(), `liliumai_voice_${Date.now()}.ogg`);
        const response = await axios.get(fileLink.toString(), { responseType: 'arraybuffer' });
        await fs.writeFile(tempPath, response.data);
        
        // Transcribe
        const text = await this.transcriptionProvider.transcribe(tempPath);
        
        // Cleanup
        await fs.remove(tempPath);

        if (text) {
          log.info(`Transcribed voice message: ${text}`);
          await this.onMessage?.({
            channel: 'telegram',
            sender_id: userId || 'unknown',
            chat_id: chatId,
            content: text,
            timestamp: new Date(),
          });
        } else {
          await ctx.reply('语音识别失败，请重试或发送文字。');
        }
      } catch (err) {
        log.error(`Error handling voice message: ${err}`);
        await ctx.reply('处理语音消息时出错。');
      }
    });

    this.bot.launch();
    log.info('Channel started');

    // Enable graceful stop
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
  }

  async stop(): Promise<void> {
    this.bot?.stop();
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendMessage(msg.chat_id, msg.content);
    } catch (err: any) {
      log.error(`Failed to send message: ${err}`);
      throw new Error(`Failed to send Telegram message: ${err.message || err}`);
    }
  }
}
