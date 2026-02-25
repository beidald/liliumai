import { Tool } from './base';
import logger from '../../utils/logger';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.values()).map((tool) => tool.toSchema());
  }

  async execute(name: string, params: Record<string, any>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Tool '${name}' not found`;
    }

    try {
      const errors = tool.validateParams(params);
      if (errors.length > 0) {
        return `Error: Invalid parameters for tool '${name}': ${errors.join('; ')}`;
      }
      return await tool.execute(params);
    } catch (err) {
      logger.error(`Error executing tool ${name}: ${err}`);
      return `Error executing ${name}: ${err}`;
    }
  }

  get toolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  get size(): number {
    return this.tools.size;
  }
}
