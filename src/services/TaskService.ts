import { SQLiteDB } from '../db/sqlite';
import { v4 as uuidv4 } from 'uuid';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import logger from '../utils/logger';

export interface Task {
  id: string;
  name?: string;
  type: 'prompt' | 'code' | 'composite' | 'system' | 'reminder';
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  schedule?: string;
  next_run?: number;
  max_executions: number;
  execution_count: number;
  retry_limit: number;
  timeout_ms: number;
  priority: number;
  tags: string[];
  created_at: number;
  updated_at: number;
  params?: any; // Runtime params
  origin_channel?: string;
  origin_chat_id?: string;
}

export interface TaskHistory {
  id?: number;
  task_id: string;
  status: 'success' | 'failed';
  output: string;
  duration_ms: number;
  executed_at: number;
}

import { EventEmitter } from 'events';
import CronExpressionParser from 'cron-parser';

export class TaskService extends EventEmitter {
  private static instance: TaskService;
  private db = SQLiteDB.getInstance().getDb();
  private pythonPath = 'python3'; // Assume in PATH
  
  private runningProcesses = new Map<string, ChildProcess>();

  // Use relative path from this file instead of process.cwd() which might be changed by deps
  private validatorScript = path.resolve(__dirname, '../../python/validator.py');
  private runnerScript = path.resolve(__dirname, '../../python/runner.py');

  private constructor() {
    super();
  }

  public static getInstance(): TaskService {
    if (!TaskService.instance) {
      TaskService.instance = new TaskService();
    }
    return TaskService.instance;
  }

  // --- CRUD Operations ---

  async createTask(data: Partial<Task>, options: { verify?: boolean } = {}): Promise<Task> {
    let nextRun = undefined;
    if (data.schedule) {
        try {
            nextRun = CronExpressionParser.parse(data.schedule).next().getTime();
        } catch (e) {
            logger.warn(`Invalid cron expression for task: ${data.schedule}`);
        }
    }

    const task: Task = {
      id: uuidv4(),
      name: data.name,
      type: data.type || 'prompt',
      content: data.content || '',
      status: 'pending',
      schedule: data.schedule,
      max_executions: data.max_executions ?? -1,
      execution_count: 0,
      retry_limit: data.retry_limit ?? 0,
      timeout_ms: data.timeout_ms ?? 30000,
      priority: data.priority ?? 1,
      tags: data.tags || [],
      created_at: Date.now(),
      updated_at: Date.now(),
      params: data.params || {},
      next_run: nextRun,
      origin_channel: data.origin_channel,
      origin_chat_id: data.origin_chat_id
    };

    // If it's code, validate first!
    if (task.type === 'code' || task.type === 'system') {
      const validation = this.validateCodeSync(task.content);
      if (!validation.valid) {
        throw new Error(`Code validation failed: ${validation.errors.join(', ')}`);
      }

      // Verify execution if requested (default to true for code tasks)
      if (options.verify !== false) {
          logger.info(`Verifying task execution for ${task.id}...`);
          try {
              await this.verifyTaskExecution(task);
              logger.info(`Task verification successful for ${task.id}`);
          } catch (e: any) {
              logger.error(`Task verification failed for ${task.id}: ${e.message}`);
              throw new Error(`Task verification failed (runtime error): ${e.message}`);
          }
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, name, type, content, status, schedule, next_run, max_executions, execution_count, 
        retry_limit, timeout_ms, priority, tags, params, created_at, updated_at, origin_channel, origin_chat_id
      ) VALUES (
        @id, @name, @type, @content, @status, @schedule, @next_run, @max_executions, @execution_count,
        @retry_limit, @timeout_ms, @priority, @tags, @params, @created_at, @updated_at, @origin_channel, @origin_chat_id
      )
    `);

    // Serialize params and tags for DB
    const dbTask = { 
        ...task, 
        params: JSON.stringify(task.params),
        tags: JSON.stringify(task.tags)
    };
    
    stmt.run(dbTask);

    // If code, insert into task_codes
    if (task.type === 'code' || task.type === 'system') {
      const codeStmt = this.db.prepare(`
        INSERT INTO task_codes (task_id, code) VALUES (?, ?)
      `);
      codeStmt.run(task.id, task.content);
    }

    logger.info(`Task created: ${task.id} (${task.type})`);
    
    // Event: Emit task created for immediate execution if no schedule
    if (!task.schedule) {
        this.emit('task_created', task);
    }
    
    return task;
  }

  private async verifyTaskExecution(task: Task): Promise<void> {
      // Create a temporary params object with system info to mimic real execution
      const systemInfo = {
        uptime: os.uptime(),
        loadavg: os.loadavg(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname()
    };
    const executionParams = { ...(task.params || {}), system_info: systemInfo };
    
    // Use a temporary ID for verification
    const tempId = `verify-${task.id}`;
    
    // Run with timeout
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Verification timed out (5s limit)')), 5000);
    });

    const executionPromise = this.runPythonCode(tempId, task.content, executionParams);
    
    const result: any = await Promise.race([executionPromise, timeoutPromise]);
    
    if (!result.success) {
        throw new Error(result.output || 'Unknown error');
    }
    // If successful, we just return. 
    // Note: This effectively runs the task once! Side effects happen!
  }

  getTask(id: string): Task | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;
    
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      params: JSON.parse(row.params || '{}')
    };
  }
  
  getPendingTasks(): Task[] {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC");
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      params: JSON.parse(row.params || '{}')
    }));
  }

  listTasks(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      params: JSON.parse(row.params || '{}')
    }));
  }

  getDueTasks(): Task[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE 
      (
        (schedule IS NOT NULL AND next_run <= ?) 
        OR 
        (schedule IS NULL AND status = 'pending')
      )
      AND status != 'running'
      AND status != 'paused'
      AND (max_executions = -1 OR execution_count < max_executions)
    `);
    const rows = stmt.all(now) as any[];
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      params: JSON.parse(row.params || '{}')
    }));
  }
  
  updateTaskStatus(id: string, status: string) {
    const stmt = this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, Date.now(), id);
  }

  updateTask(id: string, updates: Partial<Task>) {
    const keys = Object.keys(updates).filter(k => k !== 'id');
    if (keys.length === 0) return;

    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    const stmt = this.db.prepare(`UPDATE tasks SET ${setClause}, updated_at = @updated_at WHERE id = @id`);
    
    // Process JSON fields if necessary
    const params: any = { ...updates, id, updated_at: Date.now() };
    if (updates.tags) params.tags = JSON.stringify(updates.tags);
    if (updates.params) params.params = JSON.stringify(updates.params);

    stmt.run(params);
  }

  deleteTask(id: string) {
    // Check if system task
    const task = this.getTask(id);
    if (task && task.tags.some(tag => tag.startsWith('system:'))) {
        throw new Error(`Cannot delete system task: ${task.name}`);
    }

    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const info = stmt.run(id);

    if (info.changes > 0) {
        logger.info(`Deleted task: ${id}`);
    }
  }

  deleteAllTasks() {
    // Only delete non-system tasks
    const stmt = this.db.prepare("DELETE FROM tasks WHERE tags NOT LIKE '%system:%'");
    const info = stmt.run();
    logger.info(`Deleted ${info.changes} user tasks (system tasks preserved).`);
  }

  clearCompletedTasks() {
    // Only clear non-system tasks
    const stmt = this.db.prepare("DELETE FROM tasks WHERE status IN ('completed', 'cancelled') AND tags NOT LIKE '%system:%'");
    const info = stmt.run();
    if (info.changes > 0) {
        logger.info(`Cleared ${info.changes} completed/cancelled tasks.`);
    }
  }

  // --- Maintenance ---

  resetZombieTasks() {
    const stmt = this.db.prepare("UPDATE tasks SET status = 'pending' WHERE status = 'running'");
    const info = stmt.run();
    if (info.changes > 0) {
      logger.info(`Reset ${info.changes} zombie tasks to pending status.`);
    }
  }

  async ensureSystemTasks() {
    // Check if system tasks exist
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE tags LIKE '%system:monitor%'");
    const existing = stmt.get() as any;
    
    if (existing) {
        // Migration: Update type if needed
        if (existing.type !== 'system') {
            logger.info(`Migrating System Monitor task type from ${existing.type} to system...`);
            this.db.prepare("UPDATE tasks SET type = 'system' WHERE id = ?").run(existing.id);
        }
        return;
    }

    logger.info('Initializing default system monitor task...');
    await this.createTask({
        name: 'System Monitor',
        type: 'system',
        content: `
def run(params):
    import json
    info = params.get('system_info', {})
    uptime = info.get('uptime', 0)
    load = info.get('loadavg', [0,0,0])
    mem = info.get('freemem', 0) / 1024 / 1024
    
    msg = f"Server Monitor: Uptime={uptime}s, Load={load}, FreeMem={mem:.2f}MB"
    print(msg)
    return {"status": "ok", "msg": msg}
`.trim(),
        schedule: '* * * * *',
        tags: ['system:monitor'],
        priority: 1,
        max_executions: -1,
        retry_limit: 3
    }, { verify: false });
  }

  // --- Execution Logic ---

  stopTask(taskId: string): boolean {
    // 1. Mark as paused in DB immediately so race conditions in executeTask can be handled
    this.updateTaskStatus(taskId, 'paused');

    // 2. Kill process if running
    const child = this.runningProcesses.get(taskId);
    if (child) {
      child.kill(); // SIGTERM
      return true;
    }
    
    // 3. If no process, we already updated status to paused.
    // Check if it was running but lost process ref?
    // The updateTaskStatus call handles the DB update.
    
    // Add history entry for manual stop
    this.addTaskHistory(taskId, 'failed', 'Task stopped/paused manually by user', 0);
    
    return true;
  }

  resumeTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    // Recalculate next run if it's a scheduled task
    let nextRun = task.next_run;
    if (task.schedule) {
        try {
            const interval = CronExpressionParser.parse(task.schedule);
            nextRun = interval.next().getTime();
        } catch (e) {
            logger.warn(`Invalid cron for resumed task ${taskId}`);
        }
    }

    const stmt = this.db.prepare('UPDATE tasks SET status = ?, next_run = ?, updated_at = ? WHERE id = ?');
    stmt.run('pending', nextRun, Date.now(), taskId);
    
    logger.info(`Task ${taskId} resumed.`);
    return true;
  }

  async executeTask(taskId: string): Promise<TaskHistory> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Double check status to avoid race conditions if called concurrently
    // Atomic check-and-set to avoid race conditions
    // Also ensure we don't run paused tasks
    const stmt = this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status != 'running' AND status != 'paused'");
    const info = stmt.run(Date.now(), taskId);

    if (info.changes === 0) {
        logger.warn(`Task ${taskId} is already running or paused, skipping.`);
        throw new Error(`Task ${taskId} is already running or paused`);
    }
    
    const startTime = Date.now();
    let result: any = { success: false, output: 'Unknown error' };

    try {
      if (task.type === 'code' || task.type === 'system') {
        // Fetch code
        const codeStmt = this.db.prepare('SELECT code FROM task_codes WHERE task_id = ?');
        const codeRow = codeStmt.get(taskId) as any;
        if (!codeRow) throw new Error('Code content missing for task');

        // Execute Python
        const systemInfo = {
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            totalmem: os.totalmem(),
            freemem: os.freemem(),
            platform: os.platform(),
            release: os.release(),
            hostname: os.hostname()
        };
        const executionParams = { ...(task.params || {}), system_info: systemInfo };
        
        result = await this.runPythonCode(taskId, codeRow.code, executionParams);
      } else {
        // Prompt task
        result = { success: true, output: task.content };
      }
    } catch (error: any) {
      result = { success: false, output: error.message };
      logger.error(`Task ${taskId} failed: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    const finalStatus = result.success ? 'success' : 'failed';
    
    // Truncate output if too long (e.g., 10KB)
    let outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    if (outputStr.length > 10000) {
        outputStr = outputStr.substring(0, 10000) + '... [TRUNCATED]';
    }

    // Record History
    const history: TaskHistory = {
      task_id: taskId,
      status: finalStatus,
      output: outputStr,
      duration_ms: duration,
      executed_at: Date.now()
    };
    
    const histStmt = this.db.prepare(`
      INSERT INTO task_history (task_id, status, output, duration_ms, executed_at)
      VALUES (@task_id, @status, @output, @duration_ms, @executed_at)
    `);
    histStmt.run({
        task_id: taskId,
        status: finalStatus,
        output: outputStr,
        duration_ms: duration,
        executed_at: Date.now()
    });

    // Notify listeners about completion (useful for Agent to report back)
    this.emit('task_completed', {
        taskId,
        status: finalStatus,
        output: outputStr,
        origin_channel: task.origin_channel,
        origin_chat_id: task.origin_chat_id
    });

    // Update Task Status & Reschedule & Retry Logic
    const currentExecCount = task.execution_count + 1;
    let newStatus = finalStatus === 'success' ? 'completed' : 'failed';
    let nextRun = task.next_run;

    // Check if task was paused during execution (e.g. by stopTask)
    const freshTask = this.getTask(taskId);
    const isPaused = freshTask && freshTask.status === 'paused';

    if (isPaused) {
        newStatus = 'paused';
        // Still calculate next run so we know when it *would* run if resumed
        if (task.schedule) {
             try {
                const interval = CronExpressionParser.parse(task.schedule);
                nextRun = interval.next().getTime();
            } catch (e) {
                // ignore
            }
        }
    } else {
        // 1. Recurring Tasks (Cron)
        if (task.schedule) {
            if (task.max_executions !== -1 && currentExecCount >= task.max_executions) {
                newStatus = 'completed'; // Done forever
                nextRun = undefined;
            } else {
                // Reschedule regardless of success/failure
                newStatus = 'pending';
                try {
                    const interval = CronExpressionParser.parse(task.schedule);
                    nextRun = interval.next().getTime();
                } catch (e) {
                    logger.error(`Failed to calculate next run for task ${taskId}: ${e}`);
                    newStatus = 'failed';
                }
            }
        } 
        // 2. One-off Tasks (Retry Logic)
        else if (finalStatus === 'failed' && task.retry_limit > 0 && currentExecCount <= task.retry_limit) {
            newStatus = 'pending';
            // Simple backoff: 10 seconds * attempt
            nextRun = Date.now() + (10000 * currentExecCount); 
            logger.info(`Task ${taskId} failed. Retrying (${currentExecCount}/${task.retry_limit}) in ${nextRun - Date.now()}ms`);
        }
    }

    const updateStmt = this.db.prepare(`
        UPDATE tasks 
        SET status = ?, 
            execution_count = ?, 
            next_run = ?, 
            updated_at = ? 
        WHERE id = ?
    `);
    updateStmt.run(newStatus, currentExecCount, nextRun, Date.now(), taskId);
    
    return history;
  }

  addTaskHistory(taskId: string, status: 'running' | 'success' | 'failed', output: string, duration: number) {
    const stmt = this.db.prepare('INSERT INTO task_history (task_id, status, output, duration_ms, executed_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(taskId, status, output, duration, Date.now());
  }

  getTaskHistory(taskId: string): TaskHistory[] {
    const stmt = this.db.prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY executed_at DESC');
    return stmt.all(taskId) as TaskHistory[];
  }

  // --- Helper: Run Python ---

  private runPythonCode(taskId: string, code: string, params: any): Promise<{ success: boolean; output: any }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, [this.runnerScript], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.runningProcesses.set(taskId, child);

      let stdout = '';
      let stderr = '';
      const MAX_BUFFER = 1024 * 1024 * 5; // 5MB limit

      child.stdout.on('data', (data) => {
        if (stdout.length < MAX_BUFFER) {
            stdout += data.toString();
            if (stdout.length >= MAX_BUFFER) {
                stdout = stdout.substring(0, MAX_BUFFER) + '\n... [TRUNCATED EXCESSIVE OUTPUT]';
            }
        }
      });

      child.stderr.on('data', (data) => {
          if (stderr.length < MAX_BUFFER) {
              stderr += data.toString();
          }
      });

      child.on('close', (code, signal) => {
        this.runningProcesses.delete(taskId);

        if (signal) {
          resolve({ success: false, output: `Process killed by signal ${signal}.` });
          return;
        }

        if (code !== 0) {
          resolve({ success: false, output: `Process exited with code ${code}. Stderr: ${stderr}` });
          return;
        }
        try {
            // The runner outputs the last line as JSON result
            // But it might have printed other things. 
            // Our runner.py ONLY prints the JSON result at the end (unless system error)
            // Wait, runner.py prints json.dumps(result).
            const result = JSON.parse(stdout.trim());
            if (result.success) {
                resolve({ success: true, output: result.data });
            } else {
                resolve({ success: false, output: result.error || result.stderr });
            }
        } catch (e: any) {
            resolve({ success: false, output: `Failed to parse runner output: ${stdout}. Error: ${e.message}` });
        }
      });

      // Write input
      const input = JSON.stringify({ code, params });
      child.stdin.write(input);
      child.stdin.end();
    });
  }

  // --- Helper: Validate Python ---
  
  private validateCodeSync(code: string): { valid: boolean; errors: string[] } {
    const result = spawnSync(this.pythonPath, [this.validatorScript], {
      input: code,
      encoding: 'utf-8'
    });

    if (result.status !== 0) {
      return { valid: false, errors: [`Validator crashed: ${result.stderr}`] };
    }

    try {
      return JSON.parse(result.stdout);
    } catch (e) {
      return { valid: false, errors: ['Invalid validator output'] };
    }
  }
}
