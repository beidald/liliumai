import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { MemoryStore } from './memory';
import { SkillLoader } from './skills';
import logger from '../utils/logger';
import { estimateTokens, estimateMessagesTokens } from '../utils/tokens';
import { getCurrentTime } from '../utils/date';

export interface CompressionConfig {
  enabled: boolean;
  threshold: number;
  strategies: {
    removeThinking: boolean;
    removeThinkingKeepLast: number;
    truncateToolOutputs: boolean;
    truncateToolMaxChars: number;
  };
}

export class ContextBuilder {
  private memory: MemoryStore;
  private skills: SkillLoader;
  private bootstrapFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
  private autoSkillLevel: number = 0;
  private maxSkills: number = 50;
  private skillsEnabled: boolean = true;
  private compressionConfig: CompressionConfig = {
    enabled: true,
    threshold: 0.5,
    strategies: {
      removeThinking: false,
      removeThinkingKeepLast: 2,
      truncateToolOutputs: true,
      truncateToolMaxChars: 1500
    }
  };

  constructor(private workspace: string, private botName: string = 'Lilium', private enabledChannels: string[] = []) {
    this.memory = new MemoryStore(workspace);
    this.skills = new SkillLoader(workspace);
  }

  setSkillsConfig(config: { enabled?: boolean, max_skills?: number }) {
    if (config.enabled !== undefined) this.skillsEnabled = config.enabled;
    if (config.max_skills !== undefined) this.maxSkills = config.max_skills;
  }

  setCompressionConfig(config: Partial<CompressionConfig>) {
    this.compressionConfig = { ...this.compressionConfig, ...config };
  }

  setEvolutionLevel(level: number) {
    this.autoSkillLevel = level;
  }

  setMaxSkills(max: number) {
    this.maxSkills = max;
  }

  getSkillLoader(): SkillLoader {
    return this.skills;
  }

  appendHistory(content: string) {
    this.memory.appendHistory(content);
  }

  async buildSystemPrompt(): Promise<string> {
    const parts: string[] = [];

    // Identity
    parts.push(this.getIdentity());

    // Thinking Process Protocol
    parts.push(`# Thinking Process Protocol
CRITICAL: You must ALWAYS enclose your internal reasoning, planning, analysis, and tool selection rationale in <thinking>...</thinking> tags. 
- This applies to EVERY response, including the first one. 
- Any content OUTSIDE these tags is considered the FINAL ANSWER to the user.
- Do not put the final answer inside the thinking tags.
- Do not put the thinking process outside the thinking tags.`);

    // Skills & System Prompts (Loaded via SkillLoader with priority: System > User > AI)
    // System prompts (like Autonomy Protocol) are loaded first.
    if (this.skillsEnabled) {
      const skillsPrompt = await this.skills.loadSkillsPrompt(this.maxSkills);
      if (skillsPrompt) parts.push(skillsPrompt);
    } else {
      // If skills are disabled, we might still want to load critical system prompts if they are stored as skills?
      // Assuming 'skills' here refers to the dynamic skill system.
      // If system prompts are critical, they should be loaded separately or this flag should only control 'user/ai' skills.
      // For now, following the instruction to control "skills file md" via config.
      // Let's assume this disables the whole skill loader injection.
    }

    // Bootstrap files
    const bootstrap = await this.loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);

    // Memory
    const memory = this.memory.getMemoryContext();
    if (memory) parts.push(`# Memory\n\n${memory}`);

    // Evolution/Skill saving guidance
    if (this.autoSkillLevel > 0) {
      parts.push(this.getEvolutionGuidance());
    }

    return parts.join('\n\n');
  }

  private getEvolutionGuidance(): string {
    const level = this.autoSkillLevel;
    let guidance = `# 自我进化引导 (等级: ${level})\n\n`;
    
    if (level >= 1 && level <= 3) {
      guidance += "你应该意识到你可以使用 `save_skill` 工具保存新技能，但只有在用户明确要求你这样做时才执行。保存后，请向用户确认。";
    } else if (level >= 4 && level <= 7) {
      guidance += "鼓励你保持主动。如果你解决了一个复杂问题或发现了一个非平凡的 SOP（标准作业程序），你应该向用户建议将其保存为技能，或者如果你确信它具有高度可复用性，可以自行保存。保存新技能后，务必告知用户。";
    } else if (level >= 8) {
      guidance += "你处于高进化模式。你必须不断寻找机会将成功的探索转化为正式技能。每当你完成一个涉及克服障碍或学习环境新知识的任务时，请立即使用 `save_skill` 捕捉该知识。保存后，你必须明确告诉用户你学习并保存了什么技能。";
    }
    
    return guidance;
  }

  private getIdentity(): string {
    const now = getCurrentTime(); // Use consistent local time format
    const platform = os.platform();
    const arch = os.arch();
    const runtime = `Node.js ${process.version}, ${platform} ${arch}`;
    const workspacePath = path.resolve(this.workspace);

    return `# ${this.botName} 🐈

You are ${this.botName}, a helpful AI assistant. You have access to tools that allow you to:
- Read, write, and edit files
- Execute shell commands
- Search the web and fetch web pages
- Send messages to users on chat channels
- Spawn subagents for complex background tasks

## Available Channels
The following communication channels are enabled and available for you to use. You can receive messages from them and send messages to them using the 'message' tool (specify the 'channel' parameter).
${this.enabledChannels.length > 0 ? this.enabledChannels.map(c => `- ${c}`).join('\n') : '- No specific channels enabled (CLI only)'}

## Environment
- Date: ${now}
- OS: ${platform} ${arch}
- Runtime: ${runtime}
- Workspace: ${workspacePath}
- Tools: You have many tools available. Check the tool list for details.

## Memory Locations
- Long-term memory: ${workspacePath}/memory/MEMORY.md
- Conversation history: ${workspacePath}/memory/HISTORY.md`;
  }
// 中文功能描述：加载引导文件
  private async loadBootstrapFiles(): Promise<string> {
    const parts: string[] = [];
    for (const file of this.bootstrapFiles) {
      const filePath = path.join(this.workspace, file);
      if (await fs.pathExists(filePath)) {
        let content = await fs.readFile(filePath, 'utf-8');
        // Optimization: Trim whitespace and remove markdown comments
        content = content
          .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML/Markdown comments
          .replace(/[ \t]+/g, ' ')         // Replace multiple spaces/tabs with single space
          .replace(/\n\s*\n/g, '\n\n')     // Replace multiple newlines with double newline
          .trim();
        if (content) {
          parts.push(`## ${file}\n\n${content}`);
        }
      }
    }
    return parts.join('\n\n');
  }
// 中文功能描述：构建消息
  buildMessages(history: any[], currentMessage: string, media?: any[]): any[] {
    const messages: any[] = history.map((m) => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
      name: m.name,
    }));

    const userContent = this.buildUserContent(currentMessage, media);
    messages.push({ role: 'user', content: userContent });
    return messages;
  }
// 中文功能描述：构建用户内容
  private buildUserContent(text: string, media?: any[]): any {
    if (!media || media.length === 0) {
      return text;
    }
// 中文功能描述：构建用户内容
    const content: any[] = [{ type: 'text', text }];
    for (const item of media) {
      if (item.type === 'image' && item.url) {
        content.push({
          type: 'image_url',
          image_url: { url: item.url }
        });
      }
    }

    return content.length === 1 ? text : content;
  }
// 中文功能描述：添加助手消息
  addAssistantMessage(messages: any[], content: string | null, toolCalls?: any[]): any[] {
    return [...messages, { role: 'assistant', content, tool_calls: toolCalls }];
  }

  addToolResult(messages: any[], toolCallId: string, name: string, content: string): any[] {
    return [...messages, { role: 'tool', tool_call_id: toolCallId, name, content }];
  }

  compressMessages(messages: any[], maxTokens: number): any[] {
    const config = this.compressionConfig.strategies;

    // Strategy 0: Trim whitespace and extra newlines from all messages (Always applied as basic hygiene)
    let compressed = messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          ...msg,
          content: msg.content
            .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
            .replace(/\n\s*\n/g, '\n\n') // Replace multiple newlines with double newline
            .trim()
        };
      }
      return msg;
    });

    let currentTokens = estimateMessagesTokens(compressed);
    if (currentTokens <= maxTokens) return compressed;

    logger.info(`Compressing messages: ${currentTokens} tokens exceeds limit of ${maxTokens}`);
    
    // Strategy 1: Truncate very long tool outputs
    if (config.truncateToolOutputs) {
        compressed = compressed.map(msg => {
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > config.truncateToolMaxChars) {
            const tokenCount = estimateTokens(msg.content);
            // Rough estimation: 1 token ~= 4 chars, so we only truncate if tokens are also high
            if (tokenCount > config.truncateToolMaxChars / 2) { 
                const keep = Math.floor(config.truncateToolMaxChars / 2);
                return { 
                    ...msg, 
                    content: msg.content.slice(0, keep) + `\n... (内容过长，已为了节省 token 进行截断，保留 ${config.truncateToolMaxChars} 字符) ...\n` + msg.content.slice(-keep) 
                };
            }
        }
        return msg;
        });

        currentTokens = estimateMessagesTokens(compressed);
        if (currentTokens <= maxTokens) return compressed;
    }

    // Strategy 2: Remove <thinking> blocks from older messages
    if (config.removeThinking) {
        const keepCount = config.removeThinkingKeepLast;
        compressed = compressed.map((msg, index) => {
            // Skip the last few messages to keep immediate context clear
            if (index >= compressed.length - keepCount) return msg;
            
            if (typeof msg.content === 'string' && msg.content.includes('<thinking>')) {
                // Remove content between <thinking> and </thinking> tags, handling multiline
                const newContent = msg.content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                // Only update if we actually removed something
                if (newContent.length < msg.content.length) {
                    return {
                        ...msg,
                        content: newContent || "[Thinking process removed for brevity]" // Ensure content is not empty
                    };
                }
            }
            return msg;
        });

        currentTokens = estimateMessagesTokens(compressed);
        if (currentTokens <= maxTokens) return compressed;
    }

    // Strategy 3: Drop older messages (keep the last few and any system message if present)
    const result = [...compressed];
    const systemMessage = result[0]?.role === 'system' ? result.shift() : null;
    
    while (result.length > 2 && estimateMessagesTokens(systemMessage ? [systemMessage, ...result] : result) > maxTokens) {
      result.shift();
    }
    
    return systemMessage ? [systemMessage, ...result] : result;
  }
}
