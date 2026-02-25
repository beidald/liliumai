import { MessageBus } from '../bus/queue';
import { LLMProvider } from '../providers/base';
import { ContextBuilder, CompressionConfig } from './context';
import { ToolRegistry } from './tools/registry';
import { ReadFileTool, WriteFileTool, ListDirTool, EditFileTool } from './tools/filesystem';
import { ExecTool } from './tools/shell';
import { WebSearchTool, WebFetchTool } from './tools/web';
import { BrowserTool } from './tools/browser';
import { MessageTool } from './tools/message';
import { SpawnTool } from './tools/spawn';
import { CronTool } from './tools/cron';
import { SaveSkillTool } from './tools/skill_tool';
import { TasksTool } from './tools/tasks';
import { KnowledgeAddTool, KnowledgeSearchTool } from './tools/knowledge';
import { SubagentManager } from './subagent';
import { CronService } from '../cron/service';
import { MemoryStore } from './memory';
import { SessionManager, Session } from '../session/manager';
import { InboundMessage, OutboundMessage } from '../bus/events';
import logger, { logBuffer, logContext } from '../utils/logger';

const log = logger.child({ module: 'Agent' });
// 中文功能描述：AgentLoop类
// 中文参数描述：
// - bus: 消息总线
// - provider: LLM提供程序
// - workspace: 工作空间路径
// - sessions: 会话管理器
// - model: 模型名称（可选）
// - maxIterations: 最大迭代次数（可选）
// - memoryWindow: 内存窗口大小（可选）
// - braveApiKey: Brave Search API密钥（可选）
// - restrictToWorkspace: 是否限制工作空间（可选）
// - chromePath: Chrome路径（可选）
// - compressContext: 是否压缩上下文（可选）
// - compressionThreshold: 压缩阈值（可选）
// - botName: 机器人名称（可选）
// - enabledChannels: 启用的渠道（可选）
// - showThinkingInConsole: 是否在控制台显示思考过程（可选）
import { SecurityConfig } from './tools/shell';
import { TaskService } from '../services/TaskService';
import path from 'path';
import { PluginLoader } from '../plugin/loader';

export class AgentLoop {
  private context: ContextBuilder;
  private tools: ToolRegistry;
  private subagents: SubagentManager;
  private cron: CronService;
  private running = false;
  private model: string;

  constructor(
    private bus: MessageBus,
    private provider: LLMProvider,
    private workspace: string,
    private sessions: SessionManager,
    model?: string,
    private maxIterations: number = 20,
    private memoryWindow: number = 50,
    private braveApiKey?: string,
    private restrictToWorkspace: boolean = false,
    private chromePath?: string,
    private compressContext: boolean = true,
    private compressionThreshold: number = 0.5,
    botName: string = 'Lilium',
    enabledChannels: string[] = [],
    private showThinkingInConsole: boolean = true,
    private securityConfig?: SecurityConfig,
    private compressionConfig?: CompressionConfig
  ) {
    this.context = new ContextBuilder(workspace, botName, enabledChannels);
    if (compressionConfig) {
      this.context.setCompressionConfig(compressionConfig);
    } else {
        // Fallback for backward compatibility
        this.context.setCompressionConfig({
            enabled: compressContext,
            threshold: compressionThreshold
        });
    }
    this.tools = new ToolRegistry();
    this.model = model || provider.getDefaultModel();
    this.subagents = new SubagentManager(
      provider,
      workspace,
      bus,
      this.model,
      braveApiKey,
      restrictToWorkspace,
      chromePath,
      securityConfig
    );
    this.cron = new CronService(bus);
    this.registerDefaultTools();
    
    // Auto-generate skill index on startup
    this.context.getSkillLoader().loadSkillsPrompt().catch(err => {
        log.error(`Failed to generate initial skill index: ${err}`);
    });
  }

  private registerDefaultTools() {
    // Security Policy:
    // 1. Read operations are allowed globally (pass undefined as allowedDir)
    // 2. Write/Edit operations are restricted to workspace (pass this.workspace)
    // 3. Exec operations are restricted to workspace context with strict checks
    
    // Determine write restriction based on config or default
    const restrictWrite = this.securityConfig?.restrict_fs_write ?? true;
    const writeDir = restrictWrite ? this.workspace : undefined;

    // Default protected system files (cannot be modified/deleted)
    const DEFAULT_PROTECTED_FILES = [
        'AGENTS.md',
        'HEARTBEAT.md',
        'SOUL.md',
        'TOOLS.md',
        'USER.md'
    ];
    const protectedPaths = this.securityConfig?.protected_paths || DEFAULT_PROTECTED_FILES;

    this.tools.register(new ReadFileTool(undefined));
    this.tools.register(new WriteFileTool(writeDir, protectedPaths));
    this.tools.register(new EditFileTool(writeDir, protectedPaths));
    this.tools.register(new ListDirTool(undefined));
    
    // ExecTool gets full security config
    const restrictExec = this.securityConfig?.restrict_shell_execution ?? true;
    
    // Construct effective security config with protected paths
    const effectiveSecurityConfig = {
        ...(this.securityConfig || {
            restrict_fs_write: true,
            restrict_shell_execution: true,
            allowed_read_only_commands: [],
            dangerous_code_patterns: { python: [], node: [] }
        }),
        protected_paths: protectedPaths
    };
    
    this.tools.register(new ExecTool(this.workspace, 30000, restrictExec, effectiveSecurityConfig)); 
    
    this.tools.register(new WebSearchTool(this.braveApiKey));
    this.tools.register(new WebFetchTool());
    this.tools.register(new BrowserTool(this.chromePath));
    this.tools.register(new MessageTool(async (msg) => this.bus.publishOutbound(msg)));
    this.tools.register(new SpawnTool(this.subagents));
    this.tools.register(new CronTool(this.cron));
    this.tools.register(new SaveSkillTool(this.context.getSkillLoader()));
    this.tools.register(new TasksTool(this.workspace, this.cron));
    this.tools.register(new KnowledgeAddTool());
    this.tools.register(new KnowledgeSearchTool(this.context.getSkillLoader()));
  }

  private async initializePlugins() {
    const pluginDir = path.resolve(process.cwd(), 'plugins');
    log.info(`Initializing plugins from ${pluginDir}`);
    
    const pluginContext = {
      tools: this.tools,
      bus: this.bus,
      workspace: this.workspace,
      logger: logger.child({ module: 'Plugin' })
    };
    
    const loader = new PluginLoader(pluginDir, pluginContext);
    await loader.loadPlugins();
  }

  async run() {
    // Initialize plugins before starting the loop
    await this.initializePlugins();

    this.running = true;
    log.info('Agent loop started');

    // Restore scheduled tasks
    // TaskService initializes its own scheduler (TaskPoller) automatically or via singleton access
    // No explicit initialization needed here for the new system
    /*
    const tasksTool = this.tools.get('tasks');
    if (tasksTool instanceof TasksTool) {
      // await tasksTool.initializeScheduler();
    }
    */

    // Listen for task completion to notify users
    TaskService.getInstance().on('task_completed', async (result: any) => {
      if (result.origin_channel && result.origin_chat_id) {
          try {
              // If type is 'prompt', treat it as an instruction for the AI
              if (result.type === 'prompt') {
                  const content = result.output; // The prompt content
                  log.info(`Executing Prompt Task ${result.taskId}: ${content}`);
                  
                  // Construct an InboundMessage to trigger Agent execution
                  const msg: InboundMessage = {
                      channel: result.origin_channel,
                      chat_id: result.origin_chat_id,
                      sender_id: 'system_scheduler',
                      content: result.output,
                      timestamp: new Date(),
                      media: [],
                      metadata: {
                          source: 'scheduled_task',
                          taskId: result.taskId
                      }
                  };
                  
                  await this.bus.publishInbound(msg);
                  return;
              }

              // Default behavior (reminder/code/system): Notify user
              const content = `✅ Task ${result.taskId} Completed\nStatus: ${result.status}\nOutput: ${result.output}`;
              await this.bus.publishOutbound({
                    channel: result.origin_channel,
                    chat_id: result.origin_chat_id,
                    content: content,
                    metadata: {
                        type: 'task_notification',
                        taskId: result.taskId,
                        status: result.status,
                        output: result.output
                    }
                });
                log.info(`Notified user of task ${result.taskId} completion.`);
            } catch (e) {
                log.error(`Failed to notify user of task completion: ${e}`);
            }
        }
    });

    while (this.running) {
      try {
        // Wait for next message (with a small timeout to allow stopping)
        const msg = await this.bus.consumeInbound();
        if (!msg) continue;

        // Process message asynchronously to handle concurrent users
        // Use an IIFE (Immediately Invoked Function Expression) to avoid blocking the loop
        (async () => {
            // Create a session ID for log isolation
            const sessionId = `${msg.channel}:${msg.chat_id}`;
            // Run within AsyncLocalStorage context
            logContext.run({ sessionId }, async () => {
              try {
                /*
                // Handle Cron Task Execution counting - REMOVED: TaskPoller handles execution internally
                if (msg.channel === 'cron') {
                  const tasksTool = this.tools.get('tasks');
                  if (tasksTool instanceof TasksTool) {
                    const taskId = msg.sender_id; // sender_id is the task ID for cron messages
                    // const shouldRun = await tasksTool.handleExecution(taskId);
                    
                    // if (!shouldRun) {
                    //   logger.info(`Task ${taskId} execution limit reached or task not found. Skipping execution.`);
                    //   return;
                    // }
                  }
                }
                */

                logger.info(`Processing message from ${msg.channel}:${msg.chat_id}: ${msg.content.slice(0, 50)}`);
                const response = await this.processMessage(msg, sessionId);
                if (response) {
                  // Log full response for better visibility in CLI/Terminal
                  logger.info(`Agent Response: ${response.content}`);
                  logger.info(`Publishing response to ${response.channel}:${response.chat_id}`);
                  await this.bus.publishOutbound(response);
                }
              } catch (err) {
                logger.error(`Error processing message: ${err}`);
                await this.bus.publishOutbound({
                  channel: msg.channel,
                  chat_id: msg.chat_id,
                  content: `Sorry, I encountered an error: ${err}`,
                });
              }
            });
        })();
        
      } catch (err) {
        logger.error(`Error in agent loop: ${err}`);
      }
    }
  }

  stop() {
    this.running = false;
    logger.info('Agent loop stopping');
  }

  private async processMessage(msg: InboundMessage, sessionKey?: string): Promise<OutboundMessage | null> {
    if (msg.channel === 'system') {
      return await this.processSystemMessage(msg);
    }

    const key = sessionKey || `${msg.channel}:${msg.chat_id}`;
    const session = this.sessions.getOrCreate(key);
    session.clearStop();

    // Ensure user message is saved to session history (if not already saved by channel)
    if (!msg.metadata?.saved) {
      session.addMessage('user', msg.content, { 
        timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString() 
      });
      this.sessions.save(session);
    }

    // Update session title if it's the first user message
    if (session.getHistory().length === 0 || session.getTitle() === 'New Chat') {
      session.setTitle(msg.content.slice(0, 30) + (msg.content.length > 30 ? '...' : ''));
    }

    // Handle commands
    const cmd = msg.content.trim().toLowerCase();
    if (cmd === '/new') {
      await this.consolidateMemory(session, true);
      session.clear();
      this.sessions.save(session);
      return {
        channel: msg.channel,
        chat_id: msg.chat_id,
        content: '🐈 New session started. Memory consolidated.',
      };
    }
    if (cmd === '/help') {
      return {
        channel: msg.channel,
        chat_id: msg.chat_id,
        content: '🐈 Lilium commands:\n/new — Start a new conversation\n/help — Show available commands',
      };
    }

    // Consolidate memory if needed
        if (session.getHistory().length > this.memoryWindow) {
          await this.consolidateMemory(session);
        }

        // Interleaved Reflection: If the message is long or complex, add a reflection step
        // (This mimics Python's potential for pre-processing, though Python does it more implicitly)
        
        // Update tool contexts
    const [originChannel, originChatId] = (() => {
      if (msg.channel === 'cron' && msg.chat_id.includes(':')) {
        const parts = msg.chat_id.split(':');
        return [parts[0], parts.slice(1).join(':')];
      }
      return [msg.channel, msg.chat_id];
    })();
    (this.tools.get('message') as MessageTool)?.setContext(originChannel, originChatId);
    (this.tools.get('spawn') as SpawnTool)?.setContext(originChannel, originChatId);
    (this.tools.get('cron') as CronTool)?.setContext(originChannel, originChatId);
    (this.tools.get('tasks') as TasksTool)?.setContext(originChannel, originChatId);

    const systemPrompt = await this.context.buildSystemPrompt();
    // Exclude the current message from history because buildMessages will add it
    const history = session.getHistory();
    const historyForContext = history.length > 0 ? history.slice(0, -1) : [];
    
    let messages = [
      { role: 'system', content: systemPrompt },
      ...this.context.buildMessages(historyForContext, msg.content, msg.media),
    ];

    if (this.compressContext) {
      const limit = this.provider.getMaxTokens(this.model);
      // 使用配置的阈值比例作为压缩阈值，预留空间给模型生成回复
      const threshold = Math.floor(limit * this.compressionThreshold);
      messages = this.context.compressMessages(messages, threshold);
    }

    let iteration = 0;
    let fullResponseText = '';
    const toolsUsed: string[] = [];
    let lastIterationStreamed = false;

    // Initialize timestamp for log checking (start from now to avoid old logs)
    let lastLogCheck = Date.now();
    // Get current session ID for log filtering
    const currentSessionId = sessionKey || `${msg.channel}:${msg.chat_id}`;

    loop: while (iteration < this.maxIterations) {
      if (session.isStopRequested()) {
        log.info(`Session ${key} stop requested by user.`);
        session.clearStop();
        fullResponseText += '\n[Stopped by user]';
        break loop;
      }

      // Check for console errors/warnings
      // Filter by current session ID to avoid seeing other users' errors
      const recentLogs = logBuffer.getRecentErrorsAndWarnings(lastLogCheck, currentSessionId);
      if (recentLogs.length > 0) {
        log.info(`Injecting ${recentLogs.length} console errors into AI context`);
        const logMsg = recentLogs.map(l => `[${new Date(l.time).toISOString()}] ${l.level >= 50 ? 'ERROR' : 'WARN'}: ${l.msg}`).join('\n');
        messages.push({
          role: 'system',
          content: `[System Observation] The following errors/warnings occurred in the console since your last action. You should analyze them to see if your previous action failed or if there are environment issues:\n${logMsg}`
        });
      }
      lastLogCheck = Date.now();

      // Track if the current iteration response was streamed
      let currentIterationStreamed = false;

      iteration++;
      const response = await this.provider.chat(
        messages,
        this.tools.getDefinitions(),
        this.model,
        undefined,
        undefined,
        async (chunk) => {
          currentIterationStreamed = true;
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: chunk,
            is_stream: true,
          });
        }
      );

      lastIterationStreamed = currentIterationStreamed;

      if (response.content) {
        if (this.showThinkingInConsole) {
          log.info(`Agent iteration ${iteration}: ${response.content}`);
        }
        fullResponseText += response.content + '\n';
      }

      if (session.isStopRequested()) {
        log.info(`Session ${key} stop requested by user (after chat).`);
        session.clearStop();
        fullResponseText += '\n[Stopped by user]';
        break loop;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        // [MODIFIED] Flush current thought process to user BEFORE executing tools
        // This ensures the "Thinking" message appears before the tool output (e.g. video/file)
        if (response.content) {
            const thoughtContent = response.content;
            // Only send if it's substantial (not just empty string)
            if (thoughtContent.trim()) {
                session.addMessage('assistant', thoughtContent, { 
                    tools_used: response.toolCalls.map(tc => tc.name),
                    is_intermediate: true
                });
                this.sessions.save(session);
                
                // Publish to channel immediately so user sees "Thinking..." before result
                // We always send this to ensure the "Thinking" bubble is finalized/closed in UI
                // even if it was streamed. This prevents merging with the next result.
                await this.bus.publishOutbound({
                    channel: msg.channel,
                    chat_id: msg.chat_id,
                    content: thoughtContent,
                    metadata: { saved: true } // Already saved to session
                });
                
                // Reset fullResponseText to avoid duplicating this thought in the final summary
                fullResponseText = ''; 
                
                // Add a small delay to ensure the timestamp of the next message is strictly greater
                await new Promise(resolve => setTimeout(resolve, 10)); 
            }
        }

        messages = this.context.addAssistantMessage(
          messages,
          response.content,
          response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }))
        );

        for (const toolCall of response.toolCalls) {
          if (session.isStopRequested()) {
            log.info(`Session ${key} stop requested by user (before tool).`);
            session.clearStop();
            fullResponseText += '\n[Stopped by user]';
            break loop;
          }
          toolsUsed.push(toolCall.name);
          log.info(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 100)})`);
          const result = await this.tools.execute(toolCall.name, toolCall.arguments);
          messages = this.context.addToolResult(messages, toolCall.id, toolCall.name, result);
        }
        
        // Interleaved CoT with Goal Anchoring
        const originalGoal = msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content;
        let prompt = `Reflect on the results. The user originally asked: "${originalGoal}". \nHave you fully satisfied this specific request? If the result is partial or the core goal (e.g., sending an email, fixing a bug) is not achieved, what is the next step? \n\nIMPORTANT: Enclose your analysis/verification/internal monologue in <thinking>...</thinking> tags. \n\nCRITICAL: Provide the FINAL ANSWER (including all requested information, content, code, etc.) to the user OUTSIDE these tags. Do not just say you did it; show the result.`;
        
        // Soft Stop Warning
        if (iteration >= this.maxIterations - 2) {
            prompt += `\n\nWARNING: You are approaching the iteration limit (${this.maxIterations}). DO NOT SEARCH OR TRY NEW CODE. You MUST stop now. \n\nYOUR TASK:\n1. Provide a final summary to the user explaining that the complexity limit was reached.\n2. Explain exactly what you tried and why it failed.\n3. Ask the user for specific guidance or missing information to proceed.`;
        }
        
        messages.push({ 
          role: 'user', 
          content: prompt
        });
      } else {
        break;
      }
    }

    if (!fullResponseText) {
      fullResponseText = iteration >= this.maxIterations 
        ? `[SYSTEM] ⚠️ Reached iteration limit (${this.maxIterations}). \n\n**Agent Summary:**\nI have tried multiple approaches but could not complete the task within the limit. \n\n**Last Status:**\n${messages[messages.length-1].content || "No status available."}`
        : "I've completed processing but have no response to give.";
    }

    session.addMessage('assistant', fullResponseText, { tools_used: toolsUsed });
    this.sessions.save(session);

    // Sync to Knowledge Base via MemoryStore
    this.context.appendHistory(`User: ${msg.content}\nAssistant: ${fullResponseText}`);

    return {
      channel: msg.channel,
      chat_id: msg.chat_id,
      content: fullResponseText,
      metadata: { ...msg.metadata, saved: true },
    };
  }

  private async processSystemMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    log.info(`Processing system message from ${msg.sender_id}`);
    
    let originChannel = 'cli';
    let originChatId = msg.chat_id;
    if (msg.chat_id.includes(':')) {
      const parts = msg.chat_id.split(':');
      originChannel = parts[0];
      originChatId = parts[1];
    }

    const sessionKey = `${originChannel}:${originChatId}`;
    const session = this.sessions.getOrCreate(sessionKey);

    // Update tool contexts
    (this.tools.get('message') as MessageTool)?.setContext(originChannel, originChatId);
    (this.tools.get('spawn') as SpawnTool)?.setContext(originChannel, originChatId);
    (this.tools.get('cron') as CronTool)?.setContext(originChannel, originChatId);

    const systemPrompt = await this.context.buildSystemPrompt();
    // Exclude the current message from history because buildMessages will add it
    const history = session.getHistory();
    const historyForContext = history.length > 0 ? history.slice(0, -1) : [];

    let messages = [
      { role: 'system', content: systemPrompt },
      ...this.context.buildMessages(historyForContext, msg.content),
    ];

    if (this.compressContext) {
      const limit = this.provider.getMaxTokens(this.model);
      const threshold = Math.floor(limit * this.compressionThreshold);
      messages = this.context.compressMessages(messages, threshold);
    }

    let iteration = 0;
    let finalContent: string | null = null;
    
    // Initialize timestamp for log checking
    let lastLogCheck = Date.now();
    // Use session key as ID
    const currentSessionId = sessionKey;

    let lastIterationStreamed = false;

    loop: while (iteration < this.maxIterations) {
      // Check for console errors/warnings
      // Filter by current session ID to avoid seeing other users' errors
      const recentLogs = logBuffer.getRecentErrorsAndWarnings(lastLogCheck, currentSessionId);
      if (recentLogs.length > 0) {
        log.info(`Injecting ${recentLogs.length} console errors into AI context (System Task)`);
        const logMsg = recentLogs.map(l => `[${new Date(l.time).toISOString()}] ${l.level >= 50 ? 'ERROR' : 'WARN'}: ${l.msg}`).join('\n');
        messages.push({
          role: 'system',
          content: `[System Observation] The following errors/warnings occurred in the console since your last action:\n${logMsg}`
        });
      }
      lastLogCheck = Date.now();

      iteration++;
      const response = await this.provider.chat(messages, this.tools.getDefinitions(), this.model);
        if (response.content) {
          if (this.showThinkingInConsole) {
            log.info(`System Agent iteration ${iteration}: ${response.content}`);
          }
        }
        if (response.toolCalls && response.toolCalls.length > 0) {
        messages = this.context.addAssistantMessage(messages, response.content, response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        })));
        for (const tc of response.toolCalls) {
          const result = await this.tools.execute(tc.name, tc.arguments);
          messages = this.context.addToolResult(messages, tc.id, tc.name, result);
        }
        messages.push({ role: 'user', content: 'Reflect on the results and decide next steps.' });
      } else {
        finalContent = response.content;
        break;
      }
    }

    if (!finalContent) finalContent = 'Background task completed.';

    session.addMessage('user', `[System: ${msg.sender_id}] ${msg.content}`);
    session.addMessage('assistant', finalContent);
    this.sessions.save(session);

    return {
      channel: originChannel,
      chat_id: originChatId,
      content: finalContent
    };
  }

  private async consolidateMemory(session: Session, archiveAll: boolean = false) {
    const history = session.getHistory();
    if (history.length === 0) return;

    const memory = new MemoryStore(this.workspace);
    let keepCount = 0;
    let oldMessages = [];

    if (archiveAll) {
      oldMessages = history;
      keepCount = 0;
    } else {
      keepCount = Math.min(10, Math.max(2, Math.floor(this.memoryWindow / 2)));
      oldMessages = history.slice(0, -keepCount);
    }

    if (oldMessages.length === 0) return;

    log.info(`Memory consolidation started: archiving ${oldMessages.length} messages, keeping ${keepCount}`);

    const conversation = oldMessages.map(m => {
      const tools = m.metadata?.tools_used ? ` [tools: ${m.metadata.tools_used.join(', ')}]` : '';
      return `[${m.timestamp || '?'}] ${m.role.toUpperCase()}${tools}: ${m.content}`;
    }).join('\n');

    const currentMemory = memory.readLongTerm();

    const prompt = `You are a memory consolidation agent. Process this conversation and return a JSON object with exactly two keys:

1. "history_entry": A paragraph (2-5 sentences) summarizing the key events/decisions/topics. Start with a timestamp like [YYYY-MM-DD HH:MM]. Include enough detail to be useful when found by grep search later.

2. "memory_update": The updated long-term memory content. Add any new facts: user location, preferences, personal info, habits, project context, technical decisions, tools/services used. If nothing new, return the existing content unchanged.

## Current Long-term Memory
${currentMemory || '(empty)'}

## Conversation to Process
${conversation}

Respond with ONLY valid JSON, no markdown fences.`;

    try {
      const response = await this.provider.chat([
        { role: 'system', content: 'You are a memory consolidation agent. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ], [], this.model);

      let text = (response.content || '').trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      }

      const result = JSON.parse(text);
      if (result.history_entry) {
        memory.appendHistory(result.history_entry);
      }
      if (result.memory_update && result.memory_update !== currentMemory) {
        memory.writeLongTerm(result.memory_update);
      }

      // Trim session messages
      const allMessages = session.getMessages();
      session.setMessages(allMessages.slice(-keepCount));
      this.sessions.save(session);
      log.info(`Memory consolidation done, session trimmed to ${session.getMessages().length} messages`);
    } catch (err) {
      log.error(`Memory consolidation failed: ${err}`);
    }
  }

  async processDirect(content: string, sessionKey: string = 'cli:direct', channel: string = 'cli', chatId: string = 'direct'): Promise<string> {
    const msg: InboundMessage = {
      channel,
      sender_id: 'user',
      chat_id: chatId,
      content,
      timestamp: new Date()
    };
    const response = await this.processMessage(msg, sessionKey);
    return response?.content || '';
  }
}
