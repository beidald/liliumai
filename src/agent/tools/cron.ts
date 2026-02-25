import { Tool } from './base';
import { CronService } from '../../cron/service';
// 中文功能描述：定时任务工具类
export class CronTool extends Tool {
  get name() { return 'cron'; }
  get description() { return 'Schedule or unschedule a recurring task using cron expressions.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['schedule', 'unschedule', 'list'], description: 'Action to perform' },
        id: { type: 'string', description: 'Unique ID for the job' },
        expression: { type: 'string', description: 'Cron expression (e.g., "0 * * * *" for hourly)' },
        task: { type: 'string', description: 'The task description for the agent to execute' },
      },
      required: ['action'],
    };
  }

  private currentChannel: string = 'cli';
  private currentChatId: string = 'direct';

  constructor(private service: CronService) {
    super();
  }

  setContext(channel: string, chatId: string) {
    this.currentChannel = channel;
    this.currentChatId = chatId;
  }

  async execute(params: { action: string, id?: string, expression?: string, task?: string }): Promise<string> {
    switch (params.action) {
      case 'schedule':
        if (!params.id || !params.expression || !params.task) {
          return 'Error: Missing id, expression, or task for schedule action';
        }
        try {
          await this.service.schedule(params.id, params.expression, params.task, this.currentChannel, this.currentChatId);
          return `Scheduled job [${params.id}] with expression "${params.expression}"`;
        } catch (err: any) {
          return `Error scheduling job: ${err.message}`;
        }

      case 'unschedule':
        if (!params.id) return 'Error: Missing id for unschedule action';
        const removed = await this.service.unschedule(params.id);
        return removed ? `Unscheduled job [${params.id}]` : `Job [${params.id}] not found`;

      case 'list':
        const jobs = this.service.listJobs();
        return jobs.length > 0 ? `Scheduled jobs: ${jobs.join(', ')}` : 'No jobs scheduled';

      default:
        return `Error: Unknown action "${params.action}"`;
    }
  }
}
