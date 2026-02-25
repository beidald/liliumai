import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'Mochat' });

export class MochatChannel extends BaseChannel {
  private socket: Socket;
  private baseUrl: string;

  get name() { return 'mochat'; }

  constructor(
    private url: string, // socket url
    private apiUrl: string, // http api url
    private token: string,
    private sessions: string[] = [],
    private panels: string[] = []
  ) {
    super();
    this.baseUrl = apiUrl.replace(/\/$/, '');
    this.socket = io(url, {
      auth: { token },
      autoConnect: false,
      reconnection: true,
      transports: ['websocket'],
      path: '/socket.io'
    });

    this.socket.on('connect', () => {
      log.info('Connected');
      this.subscribe();
    });

    this.socket.on('disconnect', () => {
      log.warn('Disconnected');
    });

    this.socket.on('notify:chat.message.add', (data: any) => {
        this.handleMessage(data);
    });
  }

  async start(): Promise<void> {
    this.socket.connect();
  }

  async stop(): Promise<void> {
    this.socket.disconnect();
  }

  private subscribe() {
     if (this.sessions.length > 0) {
         this.socket.emit('com.claw.im.subscribeSessions', {
             sessionIds: this.sessions,
             limit: 50
         });
     }
     if (this.panels.length > 0) {
         this.socket.emit('com.claw.im.subscribePanels', {
             panelIds: this.panels
         });
     }
  }

  async send(msg: OutboundMessage): Promise<void> {
      try {
          // Sending via HTTP API as per Python implementation
          // Endpoint: /api/v1/chat/messages (example, need to verify from Python code)
          // Python: `_api_send` calls `_post_json`.
          // Path depends on session vs panel.
          
          let path = '';
          let body: any = { content: msg.content };

          // Basic heuristic: if target starts with 'p_', it's panel?
          // Python code `_dispatch_entries` and `send` logic is complex.
          // It seems it posts to `/api/v1/sessions/{id}/messages` or similar.
          
          // Let's assume a generic send endpoint if available, or just guess based on standard Claw API.
          // Actually, let's use the Python code reference.
          // In `mochat.py`:
          // `_api_send` is called by `send`.
          // If `target_kind == "session"`, path=`/im/sessions/message`
          // If `target_kind == "panel"`, path=`/im/panels/message`
          
          // We need to know if target is session or panel.
          // Heuristic: panel ids often differ.
          // For now, let's assume session if not specified.
          
          // API endpoint: /im/sessions/message
          const isPanel = msg.metadata?.is_panel || false;
          const endpoint = isPanel ? '/im/panels/message' : '/im/sessions/message';
          const idKey = isPanel ? 'panelId' : 'sessionId';

          await axios.post(`${this.baseUrl}${endpoint}`, {
              [idKey]: msg.chat_id,
              content: msg.content
          }, {
              headers: {
                  'Content-Type': 'application/json',
                  'X-Claw-Token': this.token
              }
          });

      } catch (error: any) {
          logger.error(`Mochat send error: ${error}`);
          throw new Error(`Failed to send Mochat message: ${error.message || error}`);
      }
  }

  private async handleMessage(payload: any) {
      try {
          // Payload structure:
          // { type: 'message.add', payload: { messageId, content, author, ... } }
          
          const data = payload.payload;
          if (!data) return;
          
          const content = data.content;
          const senderId = data.author;
          const messageId = data.messageId;
          const groupId = data.groupId; // if group chat
          
          // Check for self (if needed)
          
          if (content && this.onMessage) {
              const inbound: InboundMessage = {
                  channel: this.name,
                  sender_id: senderId,
                  chat_id: groupId || data.converseId || senderId, // Use converseId or groupId as chat target
                  content: typeof content === 'string' ? content : JSON.stringify(content),
                  timestamp: new Date(payload.timestamp || Date.now()),
                  metadata: {
                      message_id: messageId,
                      group_id: groupId
                  }
              };
              await this.onMessage(inbound);
          }
      } catch (error) {
          log.error(`Error handling message: ${error}`);
      }
  }
}
