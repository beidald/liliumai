import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { InboundMessage, OutboundMessage } from './events';

const log = logger.child({ module: 'Bus' });

export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundResolvers: ((msg: InboundMessage) => void)[] = [];
  private outboundResolvers: ((msg: OutboundMessage) => void)[] = [];
  private outboundSubscribers: Map<string, ((msg: OutboundMessage) => Promise<void>)[]> = new Map();
  private running = false;

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundResolvers.length > 0) {
      const resolve = this.inboundResolvers.shift();
      resolve!(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  async consumeInbound(): Promise<InboundMessage> {
    if (this.inboundQueue.length > 0) {
      return this.inboundQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.inboundResolvers.push(resolve);
    });
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    if (this.outboundResolvers.length > 0) {
      const resolve = this.outboundResolvers.shift();
      resolve!(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    if (this.outboundQueue.length > 0) {
      return this.outboundQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.outboundResolvers.push(resolve);
    });
  }

  subscribeOutbound(channel: string, callback: (msg: OutboundMessage) => Promise<void>): () => void {
    if (!this.outboundSubscribers.has(channel)) {
      this.outboundSubscribers.set(channel, []);
    }
    const subscribers = this.outboundSubscribers.get(channel)!;
    subscribers.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = subscribers.indexOf(callback);
      if (index > -1) {
        subscribers.splice(index, 1);
      }
      // Clean up empty channel list if needed
      if (subscribers.length === 0) {
        this.outboundSubscribers.delete(channel);
      }
    };
  }

  async startDispatching(): Promise<void> {
    this.running = true;
    log.info('Message bus dispatcher started');
    while (this.running) {
      try {
        const msg = await this.consumeOutbound();
        const subscribers = this.outboundSubscribers.get(msg.channel) || [];
        
        if (subscribers.length === 0) {
          log.warn(`No subscribers for channel ${msg.channel}`);
          if (msg.onError) {
            msg.onError(new Error(`No subscribers for channel ${msg.channel}`));
          }
          continue;
        }

        await Promise.all(
          subscribers.map(async (callback) => {
            try {
              await callback(msg);
              if (msg.onSuccess) msg.onSuccess();
            } catch (err: any) {
              log.error(`Error dispatching to ${msg.channel}: ${err}`);
              if (msg.onError) msg.onError(err);
            }
          })
        );
      } catch (err) {
        log.error(`Error in dispatching loop: ${err}`);
      }
    }
  }

  stop(): void {
    this.running = false;
    log.info('Message bus dispatcher stopping');
  }

  get inboundSize(): number {
    return this.inboundQueue.length;
  }

  get outboundSize(): number {
    return this.outboundQueue.length;
  }
}
