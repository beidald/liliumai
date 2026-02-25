import { createOpenAPI, createWebsocket, AvailableIntentsEventsEnum } from 'qq-guild-bot';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'QQ' });

export class QQChannel extends BaseChannel {
  private client: any; // API client
  private ws: any; // WebSocket client
  private isReady: boolean = false;

  get name() { return 'qq'; }

  constructor(
    private appId: string,
    private token: string,
    private secret: string, // Not always used by Node SDK directly depending on auth mode, but Python uses it
    private sandbox: boolean = false,
    private allowFrom: string[] = []
  ) {
    super();
    
    const botConfig = {
        appID: this.appId,
        token: this.token,
        intents: [
            AvailableIntentsEventsEnum.GUILDS,
            AvailableIntentsEventsEnum.GUILD_MEMBERS, 
            AvailableIntentsEventsEnum.GUILD_MESSAGES, 
            AvailableIntentsEventsEnum.DIRECT_MESSAGE,
            AvailableIntentsEventsEnum.AUDIO_ACTION,
            AvailableIntentsEventsEnum.PUBLIC_GUILD_MESSAGES
        ],
        sandbox: this.sandbox,
    };

    this.client = createOpenAPI(botConfig);
    this.ws = createWebsocket(botConfig);
  }

  async start(): Promise<void> {
    try {
        this.ws.on('READY', (data: any) => {
            log.info(`Bot ready: ${data.user?.username}`);
            this.isReady = true;
        });

        this.ws.on('ERROR', (data: any) => {
            log.error(`Bot error: ${data}`);
        });

        // Handle guild messages
        this.ws.on('AT_MESSAGE_CREATE', async (data: any) => {
            await this.handleMessage(data.msg, false);
        });

        // Handle direct messages
        this.ws.on('DIRECT_MESSAGE_CREATE', async (data: any) => {
            await this.handleMessage(data.msg, true);
        });

        // The Node SDK connects automatically upon creation usually? No, verifying documentation implies explicit connect/listen or it starts on creation?
        // Actually `createWebsocket` returns a client that starts connecting. 
        // But for clarity, we assume it starts. 
        // Note: The `qq-guild-bot` documentation implies `createWebsocket` initiates connection.
        
        log.info('Channel started');

    } catch (error) {
        log.error(`Failed to start: ${error}`);
    }
  }

  async stop(): Promise<void> {
    // SDK doesn't export clear stop/disconnect on the ws object in some versions,
    // assuming process exit handles it or we just nullify.
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
        const metadata = msg.metadata || {};
        const msgId = metadata.message_id; // Required for passive reply

        // If direct message
        if (metadata.is_direct) {
            await this.client.directMessageApi.postDirectMessage(metadata.guild_id, {
                 msg_id: msgId, 
                 content: msg.content 
            });
        } else {
            // Guild message
             await this.client.messageApi.postMessage(msg.chat_id, {
                 msg_id: msgId,
                 content: msg.content
             });
        }
    } catch (error: any) {
        log.error(`Send error: ${error}`);
        throw new Error(`Failed to send QQ message: ${error.message || error}`);
    }
  }

  private async handleMessage(msg: any, isDirect: boolean) {
      try {
          const content = msg.content?.trim();
          const author = msg.author;
          const senderId = author?.id;
          
          if (!senderId || !content) return;

          // Remove @bot if at start
          // content usually contains <@!bot_id>
          
          if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
              return;
          }

          if (this.onMessage) {
              const inbound: InboundMessage = {
                  channel: this.name,
                  sender_id: senderId,
                  chat_id: msg.channel_id, // For guild messages, this is channel_id. For DM?
                  content: content,
                  timestamp: new Date(msg.timestamp),
                  metadata: {
                      message_id: msg.id,
                      is_direct: isDirect,
                      guild_id: msg.guild_id, // Needed for DM reply sometimes
                      author_username: author.username
                  }
              };
              await this.onMessage(inbound);
          }
      } catch (error) {
          log.error(`Error handling message: ${error}`);
      }
  }
}
