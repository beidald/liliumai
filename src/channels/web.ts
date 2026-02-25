import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { BaseChannel } from './base';
import { InboundMessage, OutboundMessage } from '../bus/events';
import { Config } from '../config/schema';
import { updateConfig } from '../config/loader';
import logger from '../utils/logger';
import { SessionManager } from '../session/manager';
import { TaskService, Task } from '../services/TaskService';
import { UserService } from '../services/UserService';

const log = logger.child({ module: 'Web' });

import parser from 'cron-parser';
export class WebChannel extends BaseChannel {
  private app: express.Express;
  private server: http.Server;
  private io: Server;
  private port: number;
  private enabled: boolean;
  private config: Config;
  private lastEvent: { type: string, data: any, timestamp: number } | null = null;
  private sessionManager: SessionManager;
  // private sessionTokens: Set<string> = new Set(); // Replaced by UserService.verifySession
  private projectRoot: string;

  constructor(config: Config, sessionManager: SessionManager) {
    super();
    this.config = config;
    this.sessionManager = sessionManager;
    
    // Robust path resolution for project root
    this.projectRoot = process.cwd();
    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
      if (require('fs').existsSync(path.join(currentDir, 'package.json'))) {
        this.projectRoot = currentDir;
        break;
      }
      currentDir = path.dirname(currentDir);
    }
    log.info(`WebChannel resolved project root to: ${this.projectRoot}`);

    // @ts-ignore - Dynamic config access
    const webConfig = config.channels?.web || {};
    this.enabled = webConfig.enabled !== false; 
    this.port = webConfig.port || 3000;

    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server);

    this.setupRoutes();
    this.setupSocket();

    // Handle incoming events from other channels
    this.onEvent = (event) => {
      this.lastEvent = { ...event, timestamp: Date.now() };
      log.info(`WebChannel broadcasting event to clients: ${event.type}`);
      this.io.emit('system_event', event);
    };

    // Initialize Admin User if needed
    this.initializeAdmin();
  }

  private async initializeAdmin() {
    const userService = UserService.getInstance();
    if (!userService.hasUsers() && this.config.admin && this.config.admin.email && this.config.admin.password) {
        log.info('No admin users found in DB. Creating initial admin from config.');
        try {
            const user = await userService.createUser(this.config.admin.email, this.config.admin.password, 'admin');
            log.info(`Created initial admin user: ${user.username}`);
        } catch (err) {
            log.error(`Failed to create initial admin: ${err}`);
        }
    }
  }

  get name(): string {
    return 'web';
  }

  private async requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    // If no admin configured AND no users in DB, allow access (dev mode)
    const userService = UserService.getInstance();
    if ((!this.config.admin || !this.config.admin.password) && !userService.hasUsers()) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    // Support Basic Auth or Bearer Token
    const [type, credentials] = authHeader.split(' ');
    
    if (type === 'Basic') {
      const [email, password] = Buffer.from(credentials, 'base64').toString().split(':');
      // Verify against DB
      const user = await userService.verifyUser(email, password);
      if (user) {
        // Optionally attach user to request
        (req as any).user = user;
        return next();
      }
      
      // Fallback to config (migration/legacy support)
      if (this.config.admin && email === this.config.admin.email && password === this.config.admin.password) {
         return next();
      }
    } else if (type === 'Bearer') {
      // Check if it's a valid session token (Persistent)
      const user = userService.verifySession(credentials);
      if (user) {
        (req as any).user = user;
        return next();
      }
    }

    return res.status(403).json({ error: 'Invalid credentials' });
  }

  private setupRoutes() {
    const publicPath = path.join(this.projectRoot, 'public');
    log.info(`Web Channel static files path: ${publicPath}`);
    if (!require('fs').existsSync(publicPath)) {
      log.error(`Web Channel error: public directory NOT FOUND at ${publicPath}`);
    }
    
    this.app.use(express.static(publicPath, { index: 'index.html' }));
    
    // Serve workspace files at /workspace
    const workspacePath = path.resolve(this.projectRoot, this.config.workspace || 'workspace');
    log.info(`Web Channel serving workspace files from: ${workspacePath}`);
    if (require('fs').existsSync(workspacePath)) {
      this.app.use('/workspace', express.static(workspacePath));
    } else {
      log.warn(`Workspace directory not found at ${workspacePath}, skipping static serve.`);
    }
    this.app.use(express.json());

    // Explicitly serve index.html for the root route as a fallback
    this.app.get('/', (req, res) => {
      const indexPath = path.join(publicPath, 'index.html');
      if (require('fs').existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send(`index.html not found at ${indexPath}`);
      }
    });

    // Login API
    this.app.post('/api/login', async (req, res) => {
      const { email, password } = req.body;
      const userService = UserService.getInstance();
      
      // Check DB first
      const user = await userService.verifyUser(email, password);
      
      if (user) {
        const token = uuidv4();
        // Create Persistent Session (7 days)
        try {
            userService.createSession(user.id, token, 7 * 24 * 3600 * 1000);
            return res.json({ status: 'ok', token, user: { username: user.username, role: user.role } });
        } catch (e) {
            log.error(`Failed to create session: ${e}`);
            return res.status(500).json({ error: 'Login failed' });
        }
      }

      // Fallback to config if DB is empty or user not found (but better to rely on sync)
      if (this.config.admin && email === this.config.admin.email && password === this.config.admin.password) {
        // Generate secure session token instead of exposing password
        const token = uuidv4();
        // For config-based user, we don't have a DB ID, so we can't persist it easily in user_sessions table linked to admin_users.
        // However, we just auto-migrated admin users on startup (initializeAdmin), so this fallback should rarely be hit if startup succeeded.
        // If we really need to support config-only persistence, we'd need a dummy user in DB or allow null user_id.
        // For now, let's just use memory for fallback config user to encourage DB usage.
        // this.sessionTokens.add(token); // Removed memory set
        
        // Auto-migrate to DB if not exists? Maybe later.
        return res.json({ status: 'ok', token, user: { username: email, role: 'admin' } });
      }

      // If no admin configured at all
      if ((!this.config.admin || !this.config.admin.password) && !userService.hasUsers()) {
         return res.json({ status: 'ok', token: 'no-auth-needed' });
      }

      return res.status(401).json({ error: 'Invalid credentials' });
    });

    // API to get current user info
    this.app.get('/api/me', this.requireAuth.bind(this), (req, res) => {
      const user = (req as any).user;
      if (user) {
        res.json({ username: user.username, role: user.role });
      } else {
        // Fallback for config-based admin
        if (this.config.admin) {
            res.json({ username: this.config.admin.email, role: 'admin' });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
      }
    });

    // API to change password
    this.app.post('/api/change-password', this.requireAuth.bind(this), async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const user = (req as any).user;
        const userService = UserService.getInstance();

        if (!user) {
            // Config-based admin change not supported via API for security (must edit config file)
            return res.status(400).json({ error: 'Cannot change password for config-based admin. Please update config.json.' });
        }

        try {
            // Verify old password
            const verified = await userService.verifyUser(user.username, oldPassword);
            if (!verified) {
                return res.status(401).json({ error: 'Incorrect old password' });
            }

            // Change password
            await userService.changePassword(user.username, newPassword);
            return res.json({ status: 'ok', message: 'Password changed successfully' });
        } catch (err: any) {
            log.error(`Password change failed: ${err.message}`);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // API to get config
    this.app.get('/api/config', this.requireAuth.bind(this), (req, res) => {
      // Remove sensitive info before sending
      const safeConfig = JSON.parse(JSON.stringify(this.config));
      if (safeConfig.admin) {
        delete safeConfig.admin.password;
      }
      // TODO: Redact other sensitive keys
      res.json(safeConfig);
    });
    
    // API to update config
    this.app.post('/api/config', this.requireAuth.bind(this), async (req, res) => {
      try {
        const partialConfig = req.body;
        
        // Basic security check: prevent updating sensitive fields blindly if needed
        // For now, we assume the user has access.
        
        log.info('Received config update request');
        
        // Update config with backup
        const newConfig = await updateConfig(partialConfig);
        
        // Update local config instance
        this.config = newConfig;
        
        // Notify other components if needed (Simple Hot Reload)
        // Since we don't have a global event bus for config changes yet, 
        // we just update the reference. Components that read config on the fly will see changes.
        // Components that read only at startup (like this WebChannel's port) won't update until restart.
        
        res.json({ status: 'ok', message: 'Config updated successfully', config: newConfig });
      } catch (err: any) {
        log.error(`Config update failed: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
      }
    });

    // API to link an external account
    this.app.post('/api/user/link', this.requireAuth.bind(this), async (req, res) => {
        try {
            const { provider, providerId, providerName, providerData } = req.body;
            
            if (!provider || !providerId) {
                return res.status(400).json({ error: 'Provider and Provider ID are required' });
            }

            // Get current user ID from session
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Unauthorized' });
            
            const userService = UserService.getInstance();
            const user = userService.verifySession(token);
            if (!user) return res.status(401).json({ error: 'Invalid session' });

            await userService.linkAccount(user.id, provider, providerId, providerName, providerData);
            
            log.info(`Linked ${provider} account (${providerId}) to user ${user.username}`);
            res.json({ status: 'ok' });
        } catch (err: any) {
            log.error(`Failed to link account: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });

    // API to get linked accounts
    this.app.get('/api/user/linked-accounts', this.requireAuth.bind(this), async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Unauthorized' });
            
            const userService = UserService.getInstance();
            const user = userService.verifySession(token);
            if (!user) return res.status(401).json({ error: 'Invalid session' });

            const accounts = userService.getLinkedAccounts(user.id);
            res.json(accounts);
        } catch (err: any) {
            log.error(`Failed to get linked accounts: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });

    // API to get chat history
    this.app.get('/api/history', this.requireAuth.bind(this), (req, res) => {
      const sessionId = (req.query.sessionId as string) || 'default';
      // Allow accessing non-web sessions if specified or detected
      let fullId = sessionId;
      if (!sessionId.startsWith('web:') && !sessionId.startsWith('wechat:')) {
        fullId = `web:${sessionId}`;
      }
      const session = this.sessionManager.getOrCreate(fullId);
      res.json(session.getMessages());
    });

    // API to list sessions
    this.app.get('/api/sessions', this.requireAuth.bind(this), (req, res) => {
      const type = (req.query.type as string) || 'web';
      
      if (type === 'wechat') {
        const sessions = this.sessionManager.listSessions('wechat:');
        res.json(sessions);
      } else {
        const userPrefix = (req.query.userPrefix as string) || 'default';
        const sessions = this.sessionManager.listSessions(`web:${userPrefix}`);
        // Remove the prefix from IDs for frontend web sessions
        const cleanedSessions = sessions.map(s => ({
          ...s,
          id: s.id.replace('web:', '')
        }));
        res.json(cleanedSessions);
      }
    });

    // API to delete a session
    this.app.delete('/api/sessions/:id', this.requireAuth.bind(this), (req, res) => {
      const sessionId = req.params.id as string;
      // Determine prefix based on content or request
      let fullId = sessionId;
      if (!sessionId.startsWith('web:') && !sessionId.startsWith('wechat:')) {
        fullId = `web:${sessionId}`;
      }
      this.sessionManager.deleteSession(fullId);
      res.json({ status: 'ok' });
    });

    // API to get tasks
    this.app.get('/api/tasks', this.requireAuth.bind(this), async (req, res) => {
      try {
        const tasks = TaskService.getInstance().listTasks();
        // Attach history for backward compatibility with frontend
        const tasksWithHistory = tasks.map((t: Task) => {
            const history = TaskService.getInstance().getTaskHistory(t.id);
            return { ...t, history };
        });
        res.json(tasksWithHistory);
      } catch (err: any) {
        log.error(`Failed to load tasks: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to update a task (e.g. max_executions)
    this.app.patch('/api/tasks/:id', this.requireAuth.bind(this), async (req, res) => {
      try {
        const taskId = req.params.id as string;
        const updates = req.body;
        const taskService = TaskService.getInstance();
        
        const task = taskService.getTask(taskId);
        if (!task) {
          return res.status(404).json({ error: 'Task not found' });
        }
        
        const dbUpdates: any = {};
        
        if (updates.max_executions !== undefined) {
          const newMax = parseInt(updates.max_executions, 10);
          dbUpdates.max_executions = newMax;
          
          if (task.status === 'completed' && (newMax === 0 || task.execution_count < newMax)) {
            dbUpdates.status = 'pending';
            log.info(`Task ${taskId} auto-resumed (pending) due to increased execution limit`);
          }
        }
        
        if (updates.reset_count) {
          dbUpdates.execution_count = 0;
          dbUpdates.status = 'pending';
        }

        if (updates.name !== undefined) {
          dbUpdates.name = updates.name;
        }

        if (Object.keys(dbUpdates).length > 0) {
            taskService.updateTask(taskId, dbUpdates);
            const updatedTask = taskService.getTask(taskId);
            log.info(`Updated task ${taskId}`);
            res.json({ status: 'ok', task: updatedTask });
        } else {
            res.json({ status: 'ok', task });
        }
      } catch (err: any) {
        log.error(`Failed to update task: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to delete all tasks
    this.app.delete('/api/tasks', this.requireAuth.bind(this), async (req, res) => {
      try {
        TaskService.getInstance().deleteAllTasks();
        log.info('Deleted all tasks');
        res.json({ status: 'ok' });
      } catch (err: any) {
        log.error(`Failed to delete all tasks: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to delete a task
    this.app.delete('/api/tasks/:id', this.requireAuth.bind(this), async (req, res) => {
      try {
        const taskId = req.params.id as string;
        TaskService.getInstance().deleteTask(taskId);
        log.info(`Deleted task ${taskId}`);
        res.json({ status: 'ok' });
      } catch (err: any) {
        log.error(`Failed to delete task: ${err.message}`);
        // Return 403 for forbidden actions (like deleting system tasks)
        if (err.message.includes('system task')) {
            res.status(403).json({ error: err.message });
        } else {
            res.status(500).json({ error: err.message });
        }
      }
    });

    const runOnceHandler = async (taskId: string, sessionId: string | undefined, res: express.Response) => {
      try {
        const taskService = TaskService.getInstance();
        const task = taskService.getTask(taskId);
        
        if (!task) {
          return res.status(404).json({ error: 'Task not found' });
        }

        if (task.max_executions !== -1 && task.execution_count >= task.max_executions) {
             return res.status(409).json({ error: 'Task execution limit reached. Restart the task to run again.' });
        }

        // Handle Code/Composite Task
        if (task.type === 'code' || task.type === 'composite') {
             try {
                 const result = await taskService.executeTask(taskId);
                 res.json({ status: 'ok', result });
             } catch (e: any) {
                 res.status(500).json({ error: e.message });
             }
             return;
        }

        // Handle Prompt Task
        const originChannel = sessionId ? 'web' : (task.origin_channel || 'web');
        const originChatId = sessionId || task.origin_chat_id || 'default';
        
        let connectionStatus = 'Unknown';
        if (originChannel === 'web') {
             let targetId = originChatId;
             const idsToCheck: string[] = [targetId];
             let room = this.io.sockets.adapter.rooms.get(targetId);
             
             if (!room || room.size === 0) {
                 if (targetId.includes(':thread_')) {
                     const baseId = targetId.split(':thread_')[0];
                     idsToCheck.push(baseId);
                     room = this.io.sockets.adapter.rooms.get(baseId);
                     if ((!room || room.size === 0) && !baseId.startsWith('web:')) {
                         const webBaseId = `web:${baseId}`;
                         idsToCheck.push(webBaseId);
                         const webBaseRoom = this.io.sockets.adapter.rooms.get(webBaseId);
                         if (webBaseRoom && webBaseRoom.size > 0) room = webBaseRoom;
                     }
                 }
                 if ((!room || room.size === 0) && !targetId.startsWith('web:')) {
                      const webId = `web:${targetId}`;
                      idsToCheck.push(webId);
                      const webRoom = this.io.sockets.adapter.rooms.get(webId);
                      if (webRoom && webRoom.size > 0) room = webRoom;
                 }
             }
             connectionStatus = (room && room.size > 0) ? 'Online' : 'Offline';
             log.info(`Task ${task.id} execution: Web client ${originChatId} status is ${connectionStatus}.`);
        }

        const baseInstruction = `[System Instruction]
Task ID: ${task.id}
Connection Status: ${connectionStatus}
Target Chat ID: ${originChatId}
User Request: "${task.content}"

You are executing a scheduled task.
1. Execute the user request.
2. VERIFY the outcome.
3. REPORT execution result by calling 'tasks' tool with action='update', id='${task.id}', history_entry='Detailed result...', status='completed' (if done).
`;

        if (!this.onMessage) {
             return res.status(500).json({ error: 'Message handler not ready' });
        }
        
        await this.onMessage({
            channel: originChannel,
            sender_id: task.id,
            chat_id: originChatId,
            content: baseInstruction,
            timestamp: new Date(),
            metadata: { 
                triggered_by: 'web_run_once',
                is_task_run: true
            }
        });
        
        // Add pending history
        taskService.addTaskHistory(taskId, 'running', 'Manual run triggered by user', 0);
        
        log.info(`Manual run triggered for task ${taskId}`);
        res.json({ status: 'ok' });

      } catch (err: any) {
        log.error(`Failed to run task once: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    };

    // API to run a task immediately (ignore schedule)
    this.app.post('/api/tasks/:id/run-once', this.requireAuth.bind(this), async (req, res) => {
      const taskId = req.params.id as string;
      const sessionId = req.body?.sessionId as string | undefined;
      await runOnceHandler(taskId, sessionId as string | undefined, res);
    });

    this.app.post('/api/tasks/run-once', this.requireAuth.bind(this), async (req, res) => {
      const taskId = req.body?.id as string | undefined;
      if (!taskId) {
        return res.status(400).json({ error: 'Task id is required' });
      }
      const sessionId = req.body?.sessionId as string | undefined;
      await runOnceHandler(taskId, sessionId, res);
    });

    // API to restart a task
    this.app.post('/api/tasks/:id/restart', this.requireAuth.bind(this), async (req, res) => {
      try {
        const taskId = req.params.id as string;
        const taskService = TaskService.getInstance();
        const task = taskService.getTask(taskId);
        
        if (!task) {
          return res.status(404).json({ error: 'Task not found' });
        }
        
        taskService.updateTask(taskId, {
            status: 'pending',
            execution_count: 0
        });
        
        // Add restart history
        taskService.addTaskHistory(taskId, 'success', 'Task restarted by user', 0);
        
        log.info(`Restarted task ${taskId}`);
        
        const updatedTask = taskService.getTask(taskId);
        const history = taskService.getTaskHistory(taskId);
        res.json({ status: 'ok', task: { ...updatedTask, history } });
      } catch (err: any) {
        log.error(`Failed to restart task: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to stop a task (Pause)
    this.app.post('/api/tasks/:id/stop', this.requireAuth.bind(this), async (req, res) => {
      try {
        const taskId = req.params.id as string;
        const taskService = TaskService.getInstance();
        
        const success = taskService.stopTask(taskId);
        
        const task = taskService.getTask(taskId);
        if (task) {
            log.info(`Stopped/Paused task ${taskId}`);
            res.json({ status: 'ok', message: 'Task stopped/paused', task });
        } else {
            res.status(404).json({ error: 'Task not found' });
        }
      } catch (err: any) {
        log.error(`Failed to stop task: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to resume a task
    this.app.post('/api/tasks/:id/resume', this.requireAuth.bind(this), async (req, res) => {
      try {
        const taskId = req.params.id as string;
        const taskService = TaskService.getInstance();
        
        const success = taskService.resumeTask(taskId);
        
        if (success) {
            log.info(`Resumed task ${taskId}`);
            const task = taskService.getTask(taskId);
            res.json({ status: 'ok', message: 'Task resumed', task });
        } else {
            res.status(404).json({ error: 'Task not found' });
        }
      } catch (err: any) {
        log.error(`Failed to resume task: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to get file content (for viewing source code)
    this.app.get('/api/files/content', this.requireAuth.bind(this), async (req, res) => {
      try {
        const filePath = req.query.path as string;
        if (!filePath) {
          return res.status(400).json({ error: 'Path is required' });
        }

        // Security check: Ensure path is within project root and not trying to escape
        const normalizedPath = path.normalize(filePath);
        if (normalizedPath.includes('..') || path.isAbsolute(filePath)) {
           // Basic protection against directory traversal
           // For better security, we should resolve against project root and check if it starts with it
           // But here we'll just be strict about relative paths without ..
           // Actually, let's resolve it against project root to be safe
        }

        const fullPath = path.resolve(this.projectRoot, filePath);
        
        // Ensure the resolved path is inside the project root
        if (!fullPath.startsWith(this.projectRoot)) {
          return res.status(403).json({ error: 'Access denied: Path outside project root' });
        }

        // Check if file exists
        if (!await fs.pathExists(fullPath)) {
          return res.status(404).json({ error: 'File not found' });
        }

        // Check if it's a file
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          return res.status(400).json({ error: 'Not a file' });
        }

        // Read file content
        // Limit size to avoid memory issues (e.g. 1MB)
        if (stats.size > 1024 * 1024) {
          return res.status(400).json({ error: 'File too large to view' });
        }

        const content = await fs.readFile(fullPath, 'utf8');
        res.json({ content });
      } catch (err: any) {
        log.error(`Failed to read file: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // API to send a message (for external scripts)
    this.app.post('/api/messages', this.requireAuth.bind(this), async (req, res) => {
      try {
        const { content, chat_id, is_stream } = req.body;
        
        if (!content) {
          return res.status(400).json({ error: 'Content is required' });
        }

        const targetChatId = chat_id || 'default';

        await this.send({
          channel: 'web',
          chat_id: targetChatId,
          content,
          is_stream: !!is_stream
        });

        res.json({ status: 'ok' });
      } catch (err: any) {
        log.error(`Failed to send message: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });
  }

  private setupSocket() {
    this.io.on('connection', (socket) => {
      const sessionId = socket.handshake.query.sessionId as string || 'default';
      log.info(`Web client connected: ${socket.id} (session: ${sessionId})`);

      // Join a room named after the session ID so we can send messages back to this session
      socket.join(sessionId);
      
      // Also join with 'web:' prefix to support cross-channel addressing
      if (!sessionId.startsWith('web:')) {
        socket.join(`web:${sessionId}`);
      }

      // Also join the base session ID if it's a thread (e.g. wechat_xxx:thread_yyy -> wechat_xxx)
      // This allows sending messages to the user regardless of which thread they are viewing
      if (sessionId.includes(':thread_')) {
          const baseId = sessionId.split(':thread_')[0];
          socket.join(baseId);
          if (!baseId.startsWith('web:')) {
            socket.join(`web:${baseId}`);
          }
      }

      // If there's a pending event (like a QR code), send it to the newly connected client
      if (this.lastEvent) {
        // If it's a scan event, check if it's stale (e.g. older than 2 minutes)
        // QR codes expire, and if the user is already logged in, we don't want to show an old QR code
        if (this.lastEvent.type.includes('scan')) {
             const now = Date.now();
             const diff = now - this.lastEvent.timestamp;
             if (diff > 120000) { // 2 minutes
                 log.info(`Skipping stale scan event (age: ${diff}ms) for new client`);
             } else {
                 socket.emit('system_event', this.lastEvent);
             }
        } else {
             socket.emit('system_event', this.lastEvent);
        }
      }

      socket.on('message', async (data: { text: string }) => {
        const currentSessionId = socket.handshake.query.sessionId as string || 'default';
        log.info(`[WebChannel] Received message from ${socket.id} (session: ${currentSessionId}): ${JSON.stringify(data)}`);
        
        // Save user message immediately to session history
        let storageId = currentSessionId;
        if (!storageId.startsWith('web:') && !storageId.startsWith('wechat:')) {
             storageId = `web:${storageId}`;
        }
        
        try {
            const session = this.sessionManager.getOrCreate(storageId);
            session.addMessage('user', data.text);
            this.sessionManager.save(session);
        } catch (err) {
            log.error(`[WebChannel] Failed to save user message: ${err}`);
        }

        if (this.onMessage) {
          // Use the latest sessionId from the socket in case it was updated
          const msg: InboundMessage = {
            channel: 'web',
            sender_id: 'user',
            chat_id: currentSessionId, 
            content: data.text,
            timestamp: new Date(),
            metadata: { saved: true }
          };
          log.info(`[WebChannel] Dispatching message to bus: ${JSON.stringify(msg)}`);
          await this.onMessage(msg);
        } else {
          log.error(`[WebChannel] onMessage callback not set! Message dropped.`);
        }
      });

      // Allow client to update sessionId after login (e.g. WeChat login)
      socket.on('update_session', (newSessionId: string) => {
        log.info(`Web client ${socket.id} updating session from ${socket.handshake.query.sessionId} to ${newSessionId}`);
        const oldSessionId = socket.handshake.query.sessionId as string;
        socket.leave(oldSessionId);
        if (!oldSessionId.startsWith('web:')) socket.leave(`web:${oldSessionId}`);
        if (oldSessionId.includes(':thread_')) {
          const baseId = oldSessionId.split(':thread_')[0];
          socket.leave(baseId);
          if (!baseId.startsWith('web:')) socket.leave(`web:${baseId}`);
        }

        socket.handshake.query.sessionId = newSessionId;
        
        // Join new rooms
        socket.join(newSessionId);
        if (!newSessionId.startsWith('web:')) socket.join(`web:${newSessionId}`);
        if (newSessionId.includes(':thread_')) {
          const baseId = newSessionId.split(':thread_')[0];
          socket.join(baseId);
          if (!baseId.startsWith('web:')) socket.join(`web:${baseId}`);
        }
      });

      socket.on('stop_generation', () => {
        const sessionId = socket.handshake.query.sessionId as string || 'default';
        const fullId = `web:${sessionId}`;
        log.info(`Received stop request for session: ${fullId}`);
        const session = this.sessionManager.getOrCreate(fullId);
        session.requestStop();
      });

      socket.on('disconnect', () => {
        log.info(`Web client disconnected: ${socket.id}`);
      });
    });
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info(`Web Channel started at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async send(msg: OutboundMessage): Promise<void> {
    // If chat_id matches a sessionId (room), send to that room.
    // This allows multi-tab synchronization.
    
    let targetId = msg.chat_id;
    let room = this.io.sockets.adapter.rooms.get(targetId);

    // If exact match fails (e.g. specific thread closed), try the base session ID
    if ((!room || room.size === 0) && targetId.includes(':thread_')) {
        const baseId = targetId.split(':thread_')[0];
        log.info(`[WebChannel] Target room '${targetId}' empty/missing. Falling back to base session '${baseId}'`);
        const baseRoom = this.io.sockets.adapter.rooms.get(baseId);
        
        // Also try with 'web:' prefix if not present (since we join both)
        if ((!baseRoom || baseRoom.size === 0) && !baseId.startsWith('web:')) {
             const webBaseId = `web:${baseId}`;
             const webBaseRoom = this.io.sockets.adapter.rooms.get(webBaseId);
             if (webBaseRoom && webBaseRoom.size > 0) {
                 targetId = webBaseId;
                 room = webBaseRoom;
             }
        } else {
             targetId = baseId;
             room = baseRoom;
        }
    }

    // Persist message to session history (unless it's a stream chunk or already saved)
    // We do this BEFORE checking for active clients, so offline messages are saved.
    if (!msg.is_stream && msg.content && !msg.metadata?.saved) {
      try {
        let storageId = msg.chat_id;
        // Ensure prefix consistency with API history endpoint
        if (!storageId.startsWith('web:') && !storageId.startsWith('wechat:')) {
          storageId = `web:${storageId}`;
        }
        
        // Remove thread suffix if present, to store in main session file
        // Or keep it if we want per-thread storage. Currently SessionManager uses one file per session ID.
        // If the ID is 'web:sess_xxx:thread_yyy', SessionManager will use that as the ID.
        // The frontend requests history for 'sess_xxx:thread_yyy' (or similar).
        
        const session = this.sessionManager.getOrCreate(storageId);
        session.addMessage('assistant', msg.content, { metadata: msg.metadata });
        this.sessionManager.save(session);
        log.info(`[WebChannel] Saved outbound message to session ${storageId}`);
      } catch (err) {
        log.error(`[WebChannel] Failed to save outbound message: ${err}`);
      }
    }

    if (!room || room.size === 0) {
      // If no clients are connected, we cannot deliver the message to the web UI.
      // But we have saved it to history, so it's not "undeliverable" in the sense of data loss.
      // We just log a warning instead of throwing an error.
      log.warn(`Message stored but not pushed: No active web client connected for session '${msg.chat_id}' (or fallback '${targetId}').`);
      return;
    }

    this.io.to(targetId).emit('message', {
      content: msg.content,
      is_stream: msg.is_stream,
      from: 'bot',
      timestamp: Date.now(),
      metadata: msg.metadata
    });
  }
}
