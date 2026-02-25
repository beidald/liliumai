import { MessageBus } from '../bus/queue';
import { BaseChannel } from './base';
import logger from '../utils/logger';

const log = logger.child({ module: 'ChannelManager' });

export class ChannelManager {
  private channels: Map<string, BaseChannel> = new Map();

  constructor(private bus: MessageBus) {}

  register(name: string, channel: BaseChannel) {
    this.channels.set(name, channel);
    channel.onMessage = async (msg) => {
      await this.bus.publishInbound(msg);
    };
    channel.emitEvent = (event) => {
      this.emitGlobalEvent(name, event);
    };
    this.bus.subscribeOutbound(name, async (msg) => {
      await channel.send(msg);
    });
    log.info(`Channel registered: ${name}`);
  }

  private emitGlobalEvent(source: string, event: { type: string, data: any }) {
    for (const channel of this.channels.values()) {
      // Don't send the event back to the source
      if (channel.name !== source && channel.onEvent) {
        channel.onEvent({ 
          type: `channel:${source}:${event.type}`, 
          data: event.data 
        });
      }
    }
  }

  async start() {
    log.info('Starting channel manager...');
    const startPromises = Array.from(this.channels.values()).map((channel) => channel.start());
    await Promise.all(startPromises);
  }

  async stop() {
    log.info('Stopping channel manager...');
    const stopPromises = Array.from(this.channels.values()).map((channel) => channel.stop());
    await Promise.all(stopPromises);
  }
}
