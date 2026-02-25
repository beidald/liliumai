import { Tool } from './base';
import { TaskService, Task } from '../../services/TaskService';
import { CronService } from '../../cron/service';
import logger from '../../utils/logger';

export class TasksTool extends Tool {
  private taskService: TaskService;
  private currentChannel?: string;
  private currentChatId?: string;

  // CronService is kept for compatibility but not used
  constructor(workspace: string, cron?: CronService) {
    super();
    this.taskService = TaskService.getInstance();
  }

  setContext(channel: string, chatId: string) {
    this.currentChannel = channel;
    this.currentChatId = chatId;
  }

  get name(): string {
    return 'tasks';
  }

  get description(): string {
    return 'Manage tasks. Actions: add, list, update, delete, clear_completed. Types: "prompt" (AI executes instruction), "reminder" (Notify user with text), "code" (Python script).';
  }

  get parameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'list', 'update', 'delete', 'clear_completed', 'get_history'],
          description: 'The action to perform'
        },
        name: {
          type: 'string',
          description: 'Short task description or user prompt summary. Highly recommended.'
        },
        content: {
          type: 'string',
          description: 'Task content. For "prompt": AI instruction. For "reminder": Notification text. For "code": Python code.'
        },
        type: {
          type: 'string',
          enum: ['prompt', 'code', 'reminder', 'composite'],
          description: 'Task type. "prompt"=AI executes, "reminder"=Notification only, "code"=Python script.'
        },
        params: {
          type: 'string',
          description: 'JSON string of parameters for code tasks.'
        },
        schedule: {
          type: 'string',
          description: 'Cron expression for scheduled tasks.'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority'
        },
        id: {
          type: 'string',
          description: 'Task ID for update/delete'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled', 'failed', 'paused'],
          description: 'New status for update'
        }
      },
      required: ['action']
    };
  }

  async execute(params: Record<string, any>): Promise<string> {
    const { action } = params;

    try {
      if (action === 'add') {
        if (!params.content) return 'Error: content is required for add action';

        let parsedParams = undefined;
        if (params.params) {
            try {
                parsedParams = typeof params.params === 'string' ? JSON.parse(params.params) : params.params;
            } catch (e) {
                return 'Error: params must be a valid JSON string';
            }
        }

        const priorityMap: Record<string, number> = {
            'low': 1,
            'medium': 2,
            'high': 3
        };

        const taskData: Partial<Task> = {
          name: params.name,
          content: params.content,
          type: params.type || 'prompt',
          priority: priorityMap[params.priority || 'medium'],
          schedule: params.schedule,
          params: parsedParams,
          origin_channel: this.currentChannel,
          origin_chat_id: this.currentChatId
        };

        const task = await this.taskService.createTask(taskData);
        return `Task created with ID: ${task.id}`;
      }

      if (action === 'list') {
        const tasks = this.taskService.getPendingTasks();
        if (tasks.length === 0) return 'No pending tasks.';
        return JSON.stringify(tasks, null, 2);
      }

      if (action === 'update') {
        if (!params.id || !params.status) return 'Error: id and status required for update';
        this.taskService.updateTaskStatus(params.id, params.status);
        return `Task ${params.id} updated to ${params.status}`;
      }

      if (action === 'delete') {
        if (!params.id) return 'Error: id required for delete';
        this.taskService.deleteTask(params.id);
        return `Task ${params.id} deleted`;
      }

      if (action === 'clear_completed') {
        this.taskService.clearCompletedTasks();
        return 'Completed tasks cleared';
      }

      if (action === 'get_history') {
        if (!params.id) return 'Error: id required for get_history';
        const history = this.taskService.getTaskHistory(params.id);
        if (history.length === 0) return `No history found for task ${params.id}`;
        // Limit history to last 5 entries to avoid context overflow
        const recentHistory = history.slice(0, 5);
        return JSON.stringify(recentHistory, null, 2);
      }

      return `Unknown action: ${action}`;
    } catch (error: any) {
      logger.error(`TasksTool error: ${error.message}`);
      return `Error: ${error.message}`;
    }
  }
}
