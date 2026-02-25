/**
 * liliumai - Main Entry Point
 * 
 * OVERVIEW:
 * This is the core entry point of the liliumai application. It orchestrates the 
 * initialization of all major components, including the configuration loader, 
 * message bus, LLM providers, transcription services, database, knowledge base, 
 * agent loop, and multiple communication channels.
 * 
 * SYSTEM ARCHITECTURE:
 * 1. Configuration: Loaded from JSON files and environment variables.
 * 2. Message Bus: Facilitates asynchronous communication between channels and the agent.
 * 3. LLM Stack: Supports multiple providers (OpenAI, Ollama, Mock) with a failover mechanism.
 * 4. Agent Loop: The "brain" of the bot that processes messages and executes tools.
 * 5. Channels: Various interfaces (CLI, Telegram, WhatsApp, Discord, etc.) for user interaction.
 * 6. Services: Supporting services like Knowledge Base and Task Polling.
 */

import { loadConfig } from './config/loader';
import { MessageBus } from './bus/queue';
import { OpenAIProvider } from './providers/openai';
import { OllamaProvider } from './providers/ollama';
import { MockLLMProvider } from './providers/mock';
import { FailoverLLMProvider, ProviderInstance } from './providers/failover';
import { AgentLoop } from './agent/loop';
import { ChannelManager } from './channels/manager';
import { CLIChannel } from './channels/cli';
import { TelegramChannel } from './channels/telegram';
import { WhatsAppChannel } from './channels/whatsapp';
import { DiscordChannel } from './channels/discord';
import { FeishuChannel } from './channels/feishu';
import { DingTalkChannel } from './channels/dingtalk';
import { MochatChannel } from './channels/mochat';
import { EmailChannel } from './channels/email';
import { WechatChannel } from './channels/wechat';
import { SlackChannel } from './channels/slack';
import { QQChannel } from './channels/qq';
import { WebChannel } from './channels/web';
import { GroqTranscriptionProvider, LocalWhisperProvider } from './providers/transcription';
import { SessionManager } from './session/manager';
import { TaskPoller } from './services/TaskPoller';
import { SQLiteDB } from './db/sqlite';
import { KnowledgeBaseService } from './services/knowledge/service';
import { KnowledgeAddTool, KnowledgeSearchTool } from './agent/tools/knowledge';
import logger from './utils/logger';
import path from 'path';
import fs from 'fs';

// Initialize a specialized logger for the System module
const log = logger.child({ module: 'System' });

/**
 * Robust Project Root Resolution Strategy
 * 
 * Traverses upwards from the current file location until a 'package.json' is found.
 * This ensures paths are correctly resolved even if the current working directory (CWD) 
 * is modified by native modules (like whisper-node).
 * 
 * @param startPath - The directory to start the search from.
 * @returns The absolute path to the project root.
 */
function findProjectRoot(startPath: string): string {
  let currentDir = startPath;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  // Fallback to process.cwd() as a last resort
  return process.cwd();
}

// Lock the project root globally for path stability
const PROJECT_ROOT = findProjectRoot(__dirname);

/**
 * Main Application Lifecycle
 */
async function main() {
  try {
    console.log('DEBUG: main started');
    
    // 1. Load System Configuration
    const config = await loadConfig();
    console.log('DEBUG: config loaded');
    
    // 2. Initialize Internal Communication Bus
    const bus = new MessageBus();
    console.log('DEBUG: bus created');

    // 3. Resolve Workspace Path
    // The workspace is where session data, tasks, and logs are stored.
    console.log('DEBUG: resolving workspace', config.workspace);
    const absoluteWorkspace = path.isAbsolute(config.workspace) 
      ? config.workspace 
      : path.resolve(PROJECT_ROOT, config.workspace);
    console.log('DEBUG: workspace resolved', absoluteWorkspace);

    log.info(`Project Root locked at: ${PROJECT_ROOT}`);
    log.info(`Workspace resolved to: ${absoluteWorkspace}`);

    // 4. Initialize Audio Transcription Service (Optional)
    let transcriptionProvider;
    if (config.transcription.provider === 'groq' && config.transcription.apiKey) {
      transcriptionProvider = new GroqTranscriptionProvider(config.transcription.apiKey);
    } else if (config.transcription.provider === 'local') {
      transcriptionProvider = new LocalWhisperProvider(config.transcription.model);
      // Verify or download the local model on startup
      try {
        log.info('Verifying local Whisper model...');
        await transcriptionProvider.ensureModel();
      } catch (err) {
        log.error(`Failed to verify/download Whisper model: ${err}`);
      }
    }

    // 5. Initialize LLM Stack
    // We support a failover list of providers. If one fails, the next in priority is used.
    const llmConfigs = (Array.isArray(config.llm) ? config.llm : [config.llm])
      .filter(lc => lc.enabled !== false); // Only include active configurations

    if (llmConfigs.length === 0) {
      logger.warn('No enabled LLM configurations found. Bot may not respond to messages requiring AI.');
    }

    const providerInstances: ProviderInstance[] = llmConfigs.map((lc, index) => {
      let p;
      const name = `${lc.provider}_${lc.model || index}`;
      
      // Select provider implementation based on configuration
      if (lc.provider === 'ollama') {
        p = new OllamaProvider(lc.baseUrl || 'http://localhost:11434/v1', lc.apiKey || 'ollama');
      } else if (lc.apiKey === 'sk-placeholder' || !lc.apiKey) {
        p = new MockLLMProvider();
      } else {
        p = new OpenAIProvider(lc.apiKey, lc.baseUrl);
      }
      
      return {
        provider: p,
        model: lc.model,
        priority: lc.priority ?? 10,
        name,
        maxTokens: lc.maxTokens
      };
    });

    // Wrapper that handles model selection and failover logic
    const provider = new FailoverLLMProvider(providerInstances);

    // 6. Initialize Core Services
    
    // Initialize SQLite Database (Shared instance)
    SQLiteDB.getInstance(PROJECT_ROOT);

    // Initialize Session Management (Context retention)
    const sessionManager = new SessionManager(absoluteWorkspace);
    
    // Initialize Knowledge Base Service (RAG)
    if (config.knowledge_base && config.knowledge_base.enabled) {
      // Resolve storage path relative to project root to maintain path integrity
      if (config.knowledge_base.storage_path && !path.isAbsolute(config.knowledge_base.storage_path)) {
        const originalPath = config.knowledge_base.storage_path;
        config.knowledge_base.storage_path = path.resolve(PROJECT_ROOT, originalPath);
        log.info(`Resolved Knowledge Base storage path: ${originalPath} -> ${config.knowledge_base.storage_path}`);
      }

      try {
        const kbService = KnowledgeBaseService.initialize(config.knowledge_base);
        await kbService.start();
      } catch (e) {
        log.error(`Failed to initialize KnowledgeBaseService: ${e}`);
      }
    }

    // Start background Task Poller (For scheduled tasks/crons)
    try {
        await TaskPoller.getInstance().start();
    } catch (e) {
        log.error(`Failed to start TaskPoller: ${e}`);
    }

    // Identify which channels are active for the Agent's context
    const enabledChannels: string[] = ['cli']; // CLI is enabled by default
    if (config.channels) {
      for (const [key, value] of Object.entries(config.channels)) {
        if (value && typeof value === 'object' && 'enabled' in value && (value as any).enabled) {
          enabledChannels.push(key);
        }
      }
    }

    // 7. Initialize the Agent Loop (The system's "Brain")
    const agent = new AgentLoop(
      bus,
      provider,
      absoluteWorkspace,
      sessionManager,
      provider.getDefaultModel(),
      config.tools.maxIterations,
      config.tools.memoryWindow,
      config.tools.braveApiKey,
      config.tools.restrictToWorkspace,
      config.tools.chromePath,
      config.tools.compressContext,
      config.tools.compressionThreshold,
      config.bot_name,
      enabledChannels,
      config.tools.showThinkingInConsole,
      config.security,
      config.tools.compression
    );

    // Configure Agent Evolution and Skill parameters
    if (config.tools.autoSkillLevel !== undefined) {
      (agent as any).context.setEvolutionLevel(config.tools.autoSkillLevel);
    }
    if (config.tools.maxSkills !== undefined) {
      (agent as any).context.setMaxSkills(config.tools.maxSkills);
    }
    if (config.skills) {
      (agent as any).context.setSkillsConfig(config.skills);
    }

    // 8. Register and Initialize Communication Channels
    const channels = new ChannelManager(bus);
    
    // Always register CLI for local control
    channels.register('cli', new CLIChannel());

    // Telegram Integration
    if (config.channels.telegram.enabled && config.channels.telegram.token) {
      channels.register('telegram', new TelegramChannel(
        config.channels.telegram.token,
        config.channels.telegram.allow_from,
        config.channels.telegram.proxy,
        transcriptionProvider
      ));
    }

    // WhatsApp Integration
    if (config.channels.whatsapp.enabled && config.channels.whatsapp.bridge_url) {
      channels.register('whatsapp', new WhatsAppChannel(
        config.channels.whatsapp.bridge_url,
        config.channels.whatsapp.bridge_token,
        config.channels.whatsapp.allow_from
      ));
    }

    // Discord Integration
    if (config.channels.discord.enabled && config.channels.discord.token) {
      channels.register('discord', new DiscordChannel(
        config.channels.discord.token,
        config.channels.discord.allow_from
      ));
    }
    
    // Feishu Integration
    if (config.channels.feishu.enabled && config.channels.feishu.app_id) {
      channels.register('feishu', new FeishuChannel(
        config.channels.feishu.app_id,
        config.channels.feishu.app_secret,
        config.channels.feishu.encrypt_key,
        config.channels.feishu.verification_token,
        config.channels.feishu.allow_from
      ));
    }

    // DingTalk Integration
    if (config.channels.dingtalk.enabled && config.channels.dingtalk.client_id) {
      channels.register('dingtalk', new DingTalkChannel(
        config.channels.dingtalk.client_id,
        config.channels.dingtalk.client_secret,
        config.channels.dingtalk.allow_from
      ));
    }

    // Mochat Integration
    if (config.channels.mochat.enabled) {
      channels.register('mochat', new MochatChannel(
        config.channels.mochat.socket_url || config.channels.mochat.base_url,
        config.channels.mochat.base_url,
        config.channels.mochat.claw_token,
        config.channels.mochat.sessions,
        config.channels.mochat.panels
      ));
    }
    
    // Email (SMTP/IMAP) Integration
    if (config.channels.email.enabled) {
      if (!config.channels.email.consent_granted) {
          log.warn('Email channel is enabled but consent_granted is false. Skipping.');
      } else {
          channels.register('email', new EmailChannel(
              {
                  host: config.channels.email.smtp_host,
                  port: config.channels.email.smtp_port,
                  secure: config.channels.email.smtp_secure,
                  auth: {
                      user: config.channels.email.smtp_user,
                      pass: config.channels.email.smtp_pass
                  }
              },
              {
                  user: config.channels.email.imap_user || config.channels.email.smtp_user,
                  password: config.channels.email.imap_pass || config.channels.email.smtp_pass,
                  host: config.channels.email.imap_host,
                  port: config.channels.email.imap_port,
                  tls: config.channels.email.imap_tls
              },
              config.channels.email.poll_interval_seconds * 1000,
              config.channels.email.allow_from
          ));
      }
    }

    // WeChat Integration (via Wechaty)
    if (config.channels.wechat.enabled) {
      const wechatConfig = config.channels.wechat;
      const accounts = wechatConfig.accounts && wechatConfig.accounts.length > 0 
        ? wechatConfig.accounts 
        : [{
            name: 'liliumai-wechat',
            puppet: wechatConfig.puppet,
            puppet_token: wechatConfig.puppet_token,
            allow_from: wechatConfig.allow_from
          }];

      const wechatSessionsDir = path.resolve(absoluteWorkspace, 'logined');
      if (!fs.existsSync(wechatSessionsDir)) {
        fs.mkdirSync(wechatSessionsDir, { recursive: true });
        log.info(`Created WeChat sessions directory: ${wechatSessionsDir}`);
      }

      for (const account of accounts) {
        channels.register(account.name === 'liliumai-wechat' ? 'wechat' : `wechat:${account.name}`, new WechatChannel(
          account.name,
          account.puppet,
          account.puppet_token,
          account.allow_from,
          wechatSessionsDir
        ));
      }
    }

    // Slack Integration
    if (config.channels.slack.enabled) {
      channels.register('slack', new SlackChannel(
        config.channels.slack.bot_token,
        config.channels.slack.app_token,
        config.channels.slack.allow_from
      ));
    }

    // QQ Integration
    if (config.channels.qq.enabled) {
      channels.register('qq', new QQChannel(
        config.channels.qq.app_id,
        config.channels.qq.token,
        config.channels.qq.secret,
        config.channels.qq.sandbox,
        config.channels.qq.allow_from
      ));
    }

    // Web-based UI Channel
    if (config.channels.web?.enabled) {
      channels.register('web', new WebChannel(config, sessionManager));
    }

    // 9. Global Event Handling
    // Subscribe to cron job outputs to log results and update task history in workspace
    bus.subscribeOutbound('cron', async (msg) => {
      log.info(`[Cron Job Output] ${msg.chat_id}: ${msg.content}`);
      
      if (msg.metadata && msg.metadata.taskId) {
        try {
          const tasksFile = path.join(absoluteWorkspace, 'tasks.json');
          if (fs.existsSync(tasksFile)) {
            const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
            const taskIndex = tasks.findIndex((t: any) => t.id === msg.metadata!.taskId);
            
            if (taskIndex !== -1) {
              const task = tasks[taskIndex];
              if (!task.history) task.history = [];
              
              task.history.push({
                timestamp: Date.now(),
                status: task.status,
                message: `Execution Output: ${msg.content}`
              });
              
              task.updated_at = Date.now();
              fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');
              log.info(`[Cron Job] Updated history for task ${msg.metadata.taskId}`);
            }
          }
        } catch (error: any) {
          log.error(`[Cron Job] Failed to update task history: ${error.message}`);
        }
      }
    });

    // 10. Start Services
    log.info('Starting liliumai...');
    
    // Start message dispatcher
    const busPromise = bus.startDispatching();
    
    // Start all registered channels in parallel
    const channelPromise = channels.start();
    
    // Start the agent loop
    const agentPromise = agent.run();

    // 11. Graceful Shutdown Handling
    process.on('SIGINT', async () => {
      log.info('Received SIGINT. Saving session data and shutting down...');
      try {
        await agent.stop();
        bus.stop();
        await channels.stop();
        log.info('Shutdown complete.');
        process.exit(0);
      } catch (err) {
        log.error(`Error during shutdown: ${err}`);
        process.exit(1);
      }
    });

    // Wait for all core processes to run
    await Promise.all([busPromise, channelPromise, agentPromise]);
  } catch (err) {
    log.error(`Fatal error: ${err}`);
    process.exit(1);
  }
}

// Execute the main function
main();
