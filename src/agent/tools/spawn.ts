import { Tool } from './base';
import { SubagentManager } from '../subagent';
// 中文功能描述：创建子智能体工具类
export class SpawnTool extends Tool {
  get name() { return 'spawn'; }
  get description() { return 'Spawn a subagent to handle a task in the background.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task description' },
        label: { type: 'string', description: 'Short label for the task' },
      },
      required: ['task'],
    };
  }

  private currentChannel: string = 'cli';
  private currentChatId: string = 'direct';

  constructor(private manager: SubagentManager) {
    super();
  }
  // 中文功能描述：设置上下文
  setContext(channel: string, chatId: string) {
    this.currentChannel = channel;
    this.currentChatId = chatId;
  }
  
  async execute(params: { task: string, label?: string }): Promise<string> {
    return await this.manager.spawn(
      params.task,
      params.label,
      this.currentChannel,
      this.currentChatId
    );
  }
}
