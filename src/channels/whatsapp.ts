import WebSocket from 'ws';
import { BaseChannel } from './base';
import { OutboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'WhatsApp' });

export class WhatsAppChannel extends BaseChannel {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;

  get name() { return 'whatsapp'; }

  constructor(
    private bridgeUrl: string,
    private bridgeToken: string,
    private allowFrom: string[] = []
  ) {
    super();
  }

  async start(): Promise<void> {
    if (!this.bridgeUrl) {
      log.warn('Bridge URL not provided, skipping channel');
      return;
    }

    this.connect();
  }

  private connect() {
    log.info(`Connecting to bridge at ${this.bridgeUrl}`);
    this.ws = new WebSocket(this.bridgeUrl, {
      headers: {
        Authorization: `Bearer ${this.bridgeToken}`,
      },
    });

    this.ws.on('open', () => {
      log.info('Connected to bridge');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'inbound') {
          const payload = msg.payload;
          const senderId = payload.sender_id;

          if (this.allowFrom.length > 0 && !this.allowFrom.includes(senderId)) {
            log.warn(`Unauthorized access attempt from user ${senderId}`);
            return;
          }

          await this.onMessage?.({
            channel: 'whatsapp',
            sender_id: senderId,
            chat_id: payload.chat_id,
            content: payload.content,
            media: payload.media,
            timestamp: new Date(payload.timestamp || Date.now()),
          });
        }
      } catch (err) {
        log.error(`Error parsing bridge message: ${err}`);
      }
    });

    this.ws.on('close', () => {
      log.warn('Disconnected from bridge, reconnecting in 5s...');
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (err) => {
      log.error(`Bridge error: ${err.message}`);
    });
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'outbound',
        payload: {
          chat_id: msg.chat_id,
          content: msg.content,
          metadata: msg.metadata,
        },
      }));
    } else {
      const errorMsg = 'Cannot send message: Bridge not connected';
      log.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}
