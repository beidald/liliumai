/**
 * Example Plugin: Hello World
 * 
 * This plugin registers a new tool 'hello_world' that greets the user.
 * It demonstrates how to extend the agent's capabilities without modifying the core code.
 */

class HelloTool {
  get name() {
    return 'hello_world';
  }

  get description() {
    return 'Say hello to someone. Use this tool when the user asks to say hello via plugin.';
  }

  get parameters() {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the person to greet',
        },
      },
      required: ['name'],
    };
  }

  async execute(params) {
    return `Hello, ${params.name}! This message is brought to you by the Example Plugin.`;
  }

  // Implementation of Tool interface methods
  validateParams(params) {
    if (!params.name) {
      return ['Missing required parameter: name'];
    }
    return [];
  }

  toSchema() {
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

module.exports = {
  name: 'example-hello',
  version: '1.0.0',
  description: 'An example plugin that adds a hello_world tool.',
  
  initialize: async (context) => {
    context.logger.info('Initializing Hello Plugin...');
    
    // Register the new tool
    context.tools.register(new HelloTool());
    
    // You can also listen to events
    // context.bus.subscribe('some_event', (msg) => { ... });
    
    context.logger.info('Hello Plugin initialized! "hello_world" tool is now available.');
  },
  
  shutdown: async () => {
    console.log('Hello Plugin shutting down...');
  }
};
