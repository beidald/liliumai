import { InboundMessage, OutboundMessage } from '../bus/events';

export abstract class BaseChannel {
  abstract get name(): string;
  onMessage?: (msg: InboundMessage) => Promise<void>;
  
  // Called by the channel to notify the manager of an event
  emitEvent?: (event: { type: string, data: any }) => void;
  
  // Called by the manager to notify the channel of a global event
  onEvent?: (event: { type: string, data: any }) => void;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;
}
