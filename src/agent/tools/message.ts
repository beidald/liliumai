import { Tool } from './base';
import { OutboundMessage } from '../../bus/events';

export class MessageTool extends Tool {
  get name() { return 'message'; }
  get description() { return 'Send a message to the user or a specific channel/chat. This is the primary and preferred way to send messages.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The message content to send' },
        channel: { type: 'string', description: 'Target channel name (e.g., "wechat", "email", "telegram"). Defaults to the channel where the request originated.' },
        chat_id: { type: 'string', description: 'Target recipient ID. For WeChat/Telegram/etc, this is the user/group ID. For Email, this is the email address. Defaults to the sender of the original request.' },
      },
      required: ['content'],
    };
  }

  private currentChannel?: string;
  private currentChatId?: string;

  constructor(private publishCallback: (msg: OutboundMessage) => Promise<void>) {
    super();
  }

  setContext(channel: string, chatId: string) {
    this.currentChannel = channel;
    this.currentChatId = chatId;
  }

  async execute(params: { content: string, channel?: string, chat_id?: string }): Promise<string> {
    const channel = params.channel || this.currentChannel;
    const chat_id = params.chat_id || this.currentChatId;

    if (!channel || !chat_id) {
      return 'Error: Missing channel or chat_id context';
    }

    return new Promise((resolve) => {
      this.publishCallback({
        channel,
        chat_id,
        content: params.content,
        onSuccess: () => resolve(`Message sent successfully to ${channel}:${chat_id}`),
        onError: (err: Error) => resolve(`Error sending message to ${channel}:${chat_id}: ${err.message}`)
      }).catch((err: any) => {
        resolve(`Error publishing message: ${err.message || err}`);
      });
    });
  }
}
