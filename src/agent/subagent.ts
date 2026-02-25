import { v4 as uuidv4 } from 'uuid';
import { MessageBus } from '../bus/queue';
import { LLMProvider } from '../providers/base';
import { ToolRegistry } from './tools/registry';
import { ReadFileTool, WriteFileTool, ListDirTool, EditFileTool } from './tools/filesystem';
import { ExecTool } from './tools/shell';
import { WebSearchTool, WebFetchTool } from './tools/web';
import { BrowserTool } from './tools/browser';
import { MessageTool } from './tools/message';
import { TasksTool } from './tools/tasks';
import { ContextBuilder } from './context';
import logger from '../utils/logger';
/**
 * Subagent Manager - Orchestrates Autonomous Sub-tasks
 * 
 * OVERVIEW:
 * The SubagentManager is responsible for spawning and managing independent AI 
 * sub-agents that can execute specific tasks asynchronously. It handles the 
 * lifecycle of these sub-agents, provides them with a sandboxed set of tools, 
 * and facilitates communication back to the main agent loop.
 * 
 * KEY FEATURES:
 * 1. Asynchronous Task Execution: Runs tasks in the background without blocking the main agent.
 * 2. Tool Sandbox: Configures a registry of tools (filesystem, shell, web, etc.) for sub-agents.
 * 3. Security Isolation: Enforces write restrictions and shell execution policies.
 * 4. Progress Reporting: Notifies the origin channel (CLI, Telegram, etc.) upon task completion or failure.
 * 
 * @param provider - The LLM provider for the sub-agent's brain.
 * @param workspace - The root directory where the sub-agent can operate.
 * @param bus - The central message bus for inter-component communication.
 * @param model - Optional specific LLM model to use.
 * @param braveApiKey - Optional API key for web search capabilities.
 * @param restrictToWorkspace - Whether to strictly limit file operations to the workspace.
 * @param chromePath - Optional path to a Chrome/Chromium binary for browser tools.
 * @param securityConfig - Advanced security settings for shell and filesystem access.
 */
import { SecurityConfig } from './tools/shell';

export class SubagentManager {
  private runningTasks: Map<string, Promise<void>> = new Map();

  constructor(
    private provider: LLMProvider,
    private workspace: string,
    private bus: MessageBus,
    private model?: string,
    private braveApiKey?: string,
    private restrictToWorkspace: boolean = false,
    private chromePath?: string,
    private securityConfig?: SecurityConfig
  ) {}

  async spawn(
    task: string,
    label?: string,
    originChannel: string = 'cli',
    originChatId: string = 'direct'
  ): Promise<string> {
    const taskId = uuidv4().slice(0, 8);
    const displayLabel = label || (task.length > 30 ? task.slice(0, 30) + '...' : task);

    const origin = { channel: originChannel, chatId: originChatId };

    const bgTask = this.runSubagent(taskId, task, displayLabel, origin);
    this.runningTasks.set(taskId, bgTask);

    bgTask.finally(() => this.runningTasks.delete(taskId));

    logger.info(`Spawned subagent [${taskId}]: ${displayLabel}`);
    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  private async runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: { channel: string; chatId: string }
  ): Promise<void> {
    logger.info(`Subagent [${taskId}] starting task: ${label}`);

    try {
      const tools = new ToolRegistry();
      
      // Security Policy: Read Global, Write Local
      // Determine write restriction based on config or default
      const restrictWrite = this.securityConfig?.restrict_fs_write ?? true;
      const writeDir = restrictWrite ? this.workspace : undefined;

      tools.register(new ReadFileTool(undefined));
      tools.register(new WriteFileTool(writeDir));
      tools.register(new EditFileTool(writeDir));
      tools.register(new ListDirTool(undefined));
      
      // ExecTool gets full security config
      const restrictExec = this.securityConfig?.restrict_shell_execution ?? true;
      tools.register(new ExecTool(this.workspace, 30000, restrictExec, this.securityConfig)); 

      tools.register(new WebSearchTool(this.braveApiKey));
      tools.register(new WebFetchTool());
      tools.register(new BrowserTool(this.chromePath));
      const messageTool = new MessageTool(async (msg) => this.bus.publishOutbound(msg));
      messageTool.setContext(origin.channel, origin.chatId);
      tools.register(messageTool);
      const tasksTool = new TasksTool(this.workspace);
      tools.register(tasksTool);

      let messages: any[] = [
        {
          role: 'system',
          content: `You are a subagent working on a specific task for the main agent.
Task: ${task}
Label: ${label}
Workspace: ${this.workspace}

Complete the task as efficiently as possible using the tools provided.
When finished, provide a concise summary of what was accomplished.`,
        },
        { role: 'user', content: `Please start working on the task: ${task}` },
      ];

      let iteration = 0;
      let finalContent: string | null = null;

      const execRecords: { command: string; result: string; files: string[] }[] = [];
      const filePattern = /([^\s"']+\.(py|js|ts|sh))/gi;
      const taskIdMatch = task.match(/Task ID:\s*([a-f0-9-]+)/i);
      const taskId = taskIdMatch ? taskIdMatch[1] : null;

      while (iteration < 10) {
        iteration++;
        const response = await this.provider.chat(
          messages,
          tools.getDefinitions(),
          this.model
        );

        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });

          for (const toolCall of response.toolCalls) {
            const result = await tools.execute(toolCall.name, toolCall.arguments);
            if (toolCall.name === 'exec_shell') {
              const command = typeof toolCall.arguments?.command === 'string' ? toolCall.arguments.command : '';
              const files = command.match(filePattern) || [];
              const uniqueFiles = Array.from(new Set(files));
              execRecords.push({ command, result, files: uniqueFiles });
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.name,
              content: result,
            });
          }
        } else {
          finalContent = response.content;
          break;
        }
      }

      const summary = finalContent || 'Task completed with no summary.';

      if (taskId && execRecords.length > 0) {
        const files = Array.from(new Set(execRecords.flatMap(r => r.files))).filter(Boolean);
        const resultDigest = execRecords.map(r => {
          const output = r.result ? r.result.slice(0, 300) : '';
          return `Command: ${r.command}\nOutput: ${output}`;
        }).join('\n\n');
        const historyEntry = [
          'Subagent execution summary:',
          files.length > 0 ? `Files: ${files.join(', ')}` : 'Files: (not detected)',
          resultDigest
        ].join('\n');
        await tasksTool.execute({
          action: 'update',
          id: taskId,
          history_entry: historyEntry
        });
      }
      
      // Announce result back to origin
      await this.bus.publishInbound({
        channel: 'system',
        sender_id: `subagent:${taskId}`,
        chat_id: `${origin.channel}:${origin.chatId}`,
        content: `Subagent [${label}] has completed its task.\n\nSummary:\n${summary}`,
        timestamp: new Date(),
      });

    } catch (err) {
      logger.error(`Subagent [${taskId}] failed: ${err}`);
      await this.bus.publishInbound({
        channel: 'system',
        sender_id: `subagent:${taskId}`,
        chat_id: `${origin.channel}:${origin.chatId}`,
        content: `Subagent [${label}] failed with error: ${err}`,
        timestamp: new Date(),
      });
    }
  }
}
