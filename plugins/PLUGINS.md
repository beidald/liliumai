# Lilium AI Plugin System

Lilium AI supports a flexible and non-intrusive plugin system that allows you to extend the agent's capabilities without modifying the core codebase.

## Quick Start

1.  Create a `.js` file in the `plugins/` directory (e.g., `plugins/my_plugin.js`).
2.  Export an object with `name`, `version`, and `initialize` method.
3.  Restart the agent. Your plugin will be loaded automatically!

## Plugin Structure

A plugin is a simple JavaScript module that exports a specific interface.

### Minimal Example

```javascript
module.exports = {
  name: 'my-first-plugin',
  version: '1.0.0',
  initialize: async (context) => {
    context.logger.info('My plugin is running!');
  }
};
```

## Plugin API

### The `Plugin` Interface

Your plugin must export an object with the following properties:

*   `name` (string, required): Unique name of your plugin.
*   `version` (string, optional): Version of your plugin (e.g., '1.0.0').
*   `description` (string, optional): Brief description of what your plugin does.
*   `initialize(context)` (function, required): The entry point called when the plugin is loaded. Can be async.
*   `shutdown()` (function, optional): Called when the agent shuts down.

### The `PluginContext`

The `initialize` method receives a `context` object with access to core agent services:

```typescript
interface PluginContext {
  tools: ToolRegistry; // Register new tools
  bus: MessageBus;     // Subscribe/Publish events
  workspace: string;   // Path to the current workspace
  logger: Logger;      // Logging utility
}
```

## 🔥 Hot Reloading & Safety

The system monitors the `plugins/` directory for changes. 

*   **Modify**: Saving a plugin file automatically reloads it.
*   **Delete**: Deleting a file automatically unloads the plugin.
*   **Safety**: When a plugin is reloaded or unloaded, the system automatically:
    1.  **Unregisters** all tools created by that plugin.
    2.  **Unsubscribes** from all event listeners.
    3.  Calls the plugin's `shutdown()` method (if defined).

This ensures that your development process is smooth and that plugins don't leave "zombie" tools or listeners behind.

## Developing Custom Tools

You can register new tools that the AI agent can use. A tool must implement the following structure:

```javascript
class MyCustomTool {
  get name() { return 'my_tool_name'; }
  get description() { return 'Description of what this tool does.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        arg1: { type: 'string', description: 'Argument description' }
      },
      required: ['arg1']
    };
  }

  async execute(params) {
    // Your logic here
    return `Result: ${params.arg1}`;
  }
  
  // Optional: Validate parameters before execution
  validateParams(params) {
      if (!params.arg1) return ['Missing arg1'];
      return [];
  }
  
  // Optional: Generate schema for LLM (usually boilerplate)
  toSchema() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
}
```

Register the tool in your plugin's `initialize` function:

```javascript
initialize: async (context) => {
  context.tools.register(new MyCustomTool());
}
```

## Advanced Usage

### Event Listening

You can listen to system events using the `bus`:

```javascript
initialize: async (context) => {
  context.bus.subscribe('some_event', (message) => {
    context.logger.info('Received event:', message);
  });
}
```

### Directory-based Plugins

For complex plugins, you can create a subdirectory in `plugins/` (e.g., `plugins/my-complex-plugin/`).
The system will look for `package.json` (using the `main` field) or `index.js` as the entry point.

## Example

Check `plugins/example_hello.js` for a complete working example.
