import cron from 'node-cron';
import { TaskService } from './TaskService';
import logger from '../utils/logger';

const log = logger.child({ module: 'TaskPoller' });

export class TaskPoller {
  private static instance: TaskPoller;
  private taskService: TaskService;
  private isRunning: boolean = false;

  private constructor() {
    this.taskService = TaskService.getInstance();
    
    // Listen for immediate tasks
    this.taskService.on('task_created', async (task) => {
        logger.info(`Received immediate task event: ${task.id}`);
        try {
            await this.taskService.executeTask(task.id);
        } catch (e: any) {
            logger.error(`Failed to execute immediate task ${task.id}: ${e.message}`);
        }
    });
  }

  public static getInstance(): TaskPoller {
    if (!TaskPoller.instance) {
      TaskPoller.instance = new TaskPoller();
    }
    return TaskPoller.instance;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Reset any tasks stuck in 'running' state from previous crash
    this.taskService.resetZombieTasks();
    
    // Ensure system tasks exist
    await this.taskService.ensureSystemTasks();

    logger.info('TaskPoller started. Checking for tasks every minute.');

    // Check every minute
    cron.schedule('* * * * *', async () => {
      await this.checkAndRunTasks();
    });
    
    // Also run immediately on start
    this.checkAndRunTasks();
  }

  private isProcessing = false;

  private async checkAndRunTasks() {
    logger.info(`[TaskPoller] Checking for tasks...`);
    if (this.isProcessing) {
        logger.warn('TaskPoller is still processing previous batch, skipping this tick.');
        return;
    }
    this.isProcessing = true;

    try {
      // 1. Get tasks due for execution
      const dueTasks = this.taskService.getDueTasks(); 
      logger.info(`[TaskPoller] Found ${dueTasks.length} due tasks.`);
      
      if (dueTasks.length === 0) {
          this.isProcessing = false;
          return;
      }

      // 2. Execute in parallel (but limited? for now, all at once since nodejs is async)
      // Note: executeTask handles locking by checking status='running' inside.
      // But we should catch errors here to ensure loop continues.
      // 中文注释：并行执行所有任务，捕获错误确保循环继续
      const promises = dueTasks.map(async (task) => {
        try {
            logger.info(`[TaskPoller] Executing scheduled task ${task.id}`);
            await this.taskService.executeTask(task.id);
        } catch (e: any) {
            logger.error(`[TaskPoller] Failed to execute task ${task.id}: ${e.message}`);
        }
      });

      await Promise.all(promises);
      
    } catch (error: any) {
      logger.error(`TaskPoller error: ${error.message}`);
    } finally {
        this.isProcessing = false;
    }
  }
}
