// 中文功能描述：工具基类
export abstract class Tool {
  abstract get name(): string;
  abstract get description(): string;
  abstract get parameters(): Record<string, any>;

  abstract execute(params: Record<string, any>): Promise<string>;
  // 中文功能描述：验证参数
  validateParams(params: Record<string, any>): string[] {
    const schema = this.parameters;
    const errors: string[] = [];

    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in params)) {
          errors.push(`Missing required parameter: ${req}`);
        }
      }
    }

    // Simple type checking can be added here if needed, 
    // but for now we'll rely on LLM to provide correct types 
    // and basic runtime errors.
    
    return errors;
  }

  toSchema(): Record<string, any> {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
