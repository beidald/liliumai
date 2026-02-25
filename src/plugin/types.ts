import { ToolRegistry } from '../agent/tools/registry';
import { MessageBus } from '../bus/queue';
import { Logger } from 'pino';

export interface PluginContext {
  tools: ToolRegistry;
  bus: MessageBus;
  workspace: string;
  logger: Logger;
}

export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  initialize(context: PluginContext): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}
