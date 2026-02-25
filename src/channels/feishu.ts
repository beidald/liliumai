import * as Lark from '@larksuiteoapi/node-sdk';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'Feishu' });

export class FeishuChannel extends BaseChannel {
  private client: Lark.Client;
  private wsClient: Lark.WSClient;
  private eventDispatcher: Lark.EventDispatcher;

  get name() { return 'feishu'; }

  constructor(
    private appId: string,
    private appSecret: string,
    private encryptKey: string = '',
    private verificationToken: string = '',
    private allowFrom: string[] = []
  ) {
    super();
    this.client = new Lark.Client({
      appId,
      appSecret,
      loggerLevel: Lark.LoggerLevel.info
    });

    this.eventDispatcher = new Lark.EventDispatcher({
        encryptKey: this.encryptKey,
        verificationToken: this.verificationToken
    }).register({
        'im.message.receive_v1': async (data) => {
             await this.handleMessage(data);
        }
    });

    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    });
  }

  async start(): Promise<void> {
    try {
      await this.wsClient.start({
          eventDispatcher: this.eventDispatcher
      });
      log.info('Channel started');
    } catch (error) {
      log.error(`Failed to start channel: ${error}`);
    }
  }

  async stop(): Promise<void> {
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
        const content = JSON.stringify({
            text: msg.content
        });

        // Determine receive_id_type based on target format
        let receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id" = 'open_id';
        if (msg.chat_id.startsWith('oc_')) receiveIdType = 'chat_id';
        else if (msg.chat_id.includes('@')) receiveIdType = 'email';

        await this.client.im.message.create({
            params: {
                receive_id_type: receiveIdType,
            },
            data: {
                receive_id: msg.chat_id,
                msg_type: 'text',
                content: content,
            }
        });
    } catch (error: any) {
        log.error(`Send error: ${error}`);
        throw new Error(`Failed to send Feishu message: ${error.message || error}`);
    }
  }

  private async handleMessage(data: any) {
      try {
          const event = data?.message; 
          if (!event) return;

          const sender = data?.sender?.sender_id;
          const openId = sender?.open_id;
          const unionId = sender?.union_id;
          const userId = sender?.user_id;
          
          const senderId = openId || unionId || userId;
          
          if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
              return;
          }

          const msgType = event.message_type;
          let content = '';

          if (msgType === 'text') {
              const contentObj = JSON.parse(event.content);
              content = contentObj.text;
          } else {
              content = `[${msgType}]`;
          }
          
          const chatId = event.chat_id;

          if (content && this.onMessage) {
              const inbound: InboundMessage = {
                  channel: this.name,
                  sender_id: senderId,
                  chat_id: chatId,
                  content: content,
                  timestamp: new Date(Number(event.create_time)),
                  metadata: {
                      message_id: event.message_id,
                      chat_type: event.chat_type
                  }
              };
              await this.onMessage(inbound);
          }

      } catch (error) {
          log.error(`Error handling message: ${error}`);
      }
  }
}
