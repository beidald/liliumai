export interface MediaItem {
  type: 'image' | 'file';
  url: string;
}

export interface InboundMessage {
  channel: string;
  sender_id: string;
  chat_id: string;
  content: string;
  timestamp: Date;
  media?: (string | MediaItem)[];
  metadata?: Record<string, any>;
}

export function getSessionKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.chat_id}`;
}

export interface OutboundMessage {
  channel: string;
  chat_id: string;
  content: string;
  reply_to?: string;
  media?: (string | MediaItem)[];
  metadata?: Record<string, any>;
  is_stream?: boolean;
  is_final?: boolean;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}
