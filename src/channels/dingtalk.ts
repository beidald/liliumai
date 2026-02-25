import axios from 'axios';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'DingTalk' });

// Use require for the SDK as it might not have proper TS types exported or default export issues
const { DWClient } = require('dingtalk-stream-sdk-nodejs');

export class DingTalkChannel extends BaseChannel {
  private client: any;
  private accessToken: string = '';
  private tokenExpiry: number = 0;

  get name() { return 'dingtalk'; }

  constructor(
    private clientId: string,
    private clientSecret: string,
    private allowFrom: string[] = []
  ) {
    super();
    this.client = new DWClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    this.client.registerCallbackListener('/v1.0/im/bot/messages/get', async (res: any) => {
      await this.handleMessage(res);
    });
  }

  async start(): Promise<void> {
    try {
      await this.client.connect();
      log.info('Channel started');
    } catch (error) {
      log.error(`Failed to start channel: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.client && this.client.disconnect) {
        this.client.disconnect();
    }
    log.info('Channel stopped');
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        appKey: this.clientId,
        appSecret: this.clientSecret,
      });

      if (response.data && response.data.accessToken) {
        this.accessToken = response.data.accessToken;
        // Expire 60s early
        this.tokenExpiry = Date.now() + (response.data.expireIn * 1000) - 60000;
        return this.accessToken;
      }
    } catch (error) {
      log.error(`Failed to get access token: ${error}`);
    }
    return '';
  }

  async send(msg: OutboundMessage): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
        throw new Error('DingTalk access token not available');
    }

    try {
      // batchSend for private messages
      const url = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
      
      await axios.post(url, {
        robotCode: this.clientId,
        userIds: [msg.chat_id], // In DingTalk, chat_id here is usually staffId
        msgKey: 'sampleText', // Standard text message key
        msgParam: JSON.stringify({
          content: msg.content
        })
      }, {
        headers: {
          'x-acs-dingtalk-access-token': token
        }
      });

    } catch (error: any) {
      log.error(`Send error: ${error}`);
      throw new Error(`Failed to send DingTalk message: ${error.message || error}`);
    }
  }

  private async handleMessage(res: any) {
    try {
        const { headers, data } = res;
        const payload = JSON.parse(data);
        
        // payload structure depends on event
        // usually { senderStaffId, text: { content }, ... }
        
        const content = payload.text?.content?.trim();
        const senderId = payload.senderStaffId;
        const senderName = payload.senderNick;
        
        if (!content) return;
        
        if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
            return;
        }

        if (this.onMessage) {
            const inbound: InboundMessage = {
                channel: this.name,
                sender_id: senderId,
                chat_id: senderId, // Reply to sender
                content: content,
                timestamp: new Date(), // DingTalk stream might not have timestamp in root
                metadata: {
                    senderName,
                    messageId: headers.messageId
                }
            };
            await this.onMessage(inbound);
        }

    } catch (error) {
        log.error(`Error handling message: ${error}`);
    }
  }
}
