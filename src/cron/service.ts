import cron, { ScheduledTask } from 'node-cron';
import { MessageBus } from '../bus/queue';
import logger from '../utils/logger';

const log = logger.child({ module: 'Cron' });

export interface CronJob {
  id: string;
  expression: string;
  task: string;
  channel: string;
  chatId: string;
  enabled: boolean;
}

export class CronService {
  private jobs: Map<string, ScheduledTask> = new Map();

  constructor(private bus: MessageBus) {}

  async schedule(id: string, expression: string, task: string, channel: string, chatId: string) {
    if (this.jobs.has(id)) {
      this.jobs.get(id)?.stop();
    }

    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }

    const job = cron.schedule(expression, async () => {
      log.info(`Running cron job [${id}]: ${task}`);
      await this.bus.publishInbound({
        channel: 'cron',
        sender_id: id,
        chat_id: `${channel}:${chatId}`,
        content: task,
        timestamp: new Date(),
        metadata: { taskId: id }
      });
    });

    this.jobs.set(id, job);
    log.info(`Scheduled cron job [${id}]: ${expression}`);
  }

  async unschedule(id: string) {
    if (this.jobs.has(id)) {
      this.jobs.get(id)?.stop();
      this.jobs.delete(id);
      log.info(`Unscheduled cron job [${id}]`);
      return true;
    }
    return false;
  }

  listJobs(): string[] {
    return Array.from(this.jobs.keys());
  }
}
