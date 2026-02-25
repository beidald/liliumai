import fs from 'fs';
import path from 'path';
import { Plugin, PluginContext } from './types';
import logger from '../utils/logger';

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private pluginCleanups: Map<string, () => void> = new Map();
  private fileToPluginName: Map<string, string> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private context: PluginContext;
  private pluginDir: string;

  constructor(pluginDir: string, context: PluginContext) {
    this.pluginDir = pluginDir;
    this.context = context;
  }

  async loadPlugins(): Promise<void> {
    if (!fs.existsSync(this.pluginDir)) {
      logger.info(`Plugin directory ${this.pluginDir} does not exist. Creating it.`);
      fs.mkdirSync(this.pluginDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(this.pluginDir);

    for (const entry of entries) {
      // Skip hidden files
      if (entry.startsWith('.')) continue;

      const fullPath = path.join(this.pluginDir, entry);
      const stat = fs.statSync(fullPath);

      // Only load .js files directly in the plugins directory
      // The user requested to ignore other files (including directories and .ts files)
      if (stat.isFile() && entry.endsWith('.js')) {
        await this.loadPluginFromFile(fullPath);
      }
    }
    
    // Start watching for changes
    this.watchPlugins();
  }

  private watchPlugins() {
    if (this.watcher) return;
    
    logger.info(`Watching plugin directory for changes: ${this.pluginDir}`);
    let fsWait: NodeJS.Timeout | null = null;
    
    try {
      this.watcher = fs.watch(this.pluginDir, { recursive: true }, (eventType, filename) => {
        if (!filename || filename.startsWith('.')) return;
        
        // Debounce
        if (fsWait) return;
        fsWait = setTimeout(async () => {
          fsWait = null;
          const fullPath = path.join(this.pluginDir, filename);
          
          logger.info(`File changed: ${filename} (${eventType})`);
          
          // Check if it's a new file or modification
          if (fs.existsSync(fullPath)) {
             const stat = fs.statSync(fullPath);
             // Only process .js files (ignore .ts and directories)
             if (stat.isFile() && filename.endsWith('.js')) {
                 // Check if it's in the root of plugins dir (optional, but consistent with loadPlugins)
                 // For now, we allow recursive watching but only load .js files
                 await this.loadPluginFromFile(fullPath);
             }
          } else {
              // File removed
              if (this.fileToPluginName.has(fullPath)) {
                  const name = this.fileToPluginName.get(fullPath)!;
                  logger.info(`Plugin file removed: ${filename}. Unloading plugin ${name}...`);
                  this.unloadPlugin(name);
              }
          }
        }, 100);
      });
    } catch (err) {
      logger.warn(`Failed to watch plugin directory: ${err}`);
    }
  }

  private async loadPluginFromDir(dir: string): Promise<void> {
    // Check for package.json
    const packageJsonPath = path.join(dir, 'package.json');
    let entryPoint = path.join(dir, 'index.js'); // Default

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.main) {
          entryPoint = path.join(dir, pkg.main);
        }
      } catch (e) {
        logger.error(`Failed to read package.json in ${dir}: ${e}`);
      }
    }
    
    // Check if entry point exists
    if (!fs.existsSync(entryPoint)) {
        // Try index.ts if index.js doesn't exist
        const tsEntryPoint = entryPoint.replace(/\.js$/, '.ts');
        if (fs.existsSync(tsEntryPoint)) {
            entryPoint = tsEntryPoint;
        } else {
             logger.warn(`Plugin entry point not found in ${dir}: ${entryPoint}`);
             return;
        }
    }

    await this.loadPluginFromFile(entryPoint);
  }

  private async loadPluginFromFile(filePath: string): Promise<void> {
    try {
      // Clean up previous instance if exists (Hot Reload)
      // We check if this file was already loaded as a plugin
      if (this.fileToPluginName.has(filePath)) {
          const oldName = this.fileToPluginName.get(filePath)!;
          if (this.plugins.has(oldName)) {
              logger.info(`Reloading plugin: ${oldName}`);
              this.unloadPlugin(oldName);
          }
      }

      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve(filePath)];

      // Dynamic require
      const pluginModule = require(filePath);
      
      // Handle default export or named export
      const plugin: Plugin = pluginModule.default || pluginModule;

      if (!this.validatePlugin(plugin)) {
        logger.warn(`Invalid plugin at ${filePath}: Missing name or initialize method.`);
        return;
      }

      if (this.plugins.has(plugin.name)) {
        logger.warn(`Plugin ${plugin.name} is already loaded. Skipping ${filePath}.`);
        return;
      }

      logger.info(`Loading plugin: ${plugin.name} v${plugin.version || '0.0.0'}`);
      
      // Create a wrapped context to track resources for cleanup
      const registeredTools: string[] = [];
      const busUnsubscribes: (() => void)[] = [];
      
      const toolsProxy = new Proxy(this.context.tools, {
        get: (target, prop, receiver) => {
            if (prop === 'register') {
                return (tool: any) => {
                    target.register(tool);
                    registeredTools.push(tool.name);
                };
            }
            const value = Reflect.get(target, prop, target);
            if (typeof value === 'function') return value.bind(target);
            return value;
        }
      });

      const busProxy = new Proxy(this.context.bus, {
          get: (target, prop, receiver) => {
              if (prop === 'subscribeOutbound') {
                  return (channel: string, cb: any) => {
                      const unsub = (target as any).subscribeOutbound(channel, cb);
                      if (unsub && typeof unsub === 'function') {
                          busUnsubscribes.push(unsub);
                      }
                      return unsub;
                  };
              }
              const value = Reflect.get(target, prop, target);
              if (typeof value === 'function') return value.bind(target);
              return value;
          }
      });

      const wrappedContext: PluginContext = {
          ...this.context,
          tools: toolsProxy as any,
          bus: busProxy as any
      };

      await plugin.initialize(wrappedContext);
      
      this.plugins.set(plugin.name, plugin);
      this.fileToPluginName.set(filePath, plugin.name);
      
      // Store cleanup function
      this.pluginCleanups.set(plugin.name, () => {
          logger.info(`Cleaning up resources for plugin ${plugin.name}`);
          
          // 1. Call plugin shutdown hook
          if (plugin.shutdown) {
              try { plugin.shutdown(); } catch(e) { logger.error(`Error during shutdown of ${plugin.name}: ${e}`); }
          }
          
          // 2. Unregister tools
          registeredTools.forEach(name => {
              logger.debug(`Unregistering tool: ${name}`);
              this.context.tools.unregister(name);
          });
          
          // 3. Unsubscribe from bus
          busUnsubscribes.forEach(unsub => unsub());
      });
      
      logger.info(`Plugin ${plugin.name} loaded successfully.`);
    } catch (e) {
      logger.error(`Failed to load plugin from ${filePath}: ${e}`);
    }
  }

  private unloadPlugin(name: string) {
      const cleanup = this.pluginCleanups.get(name);
      if (cleanup) {
          cleanup();
          this.pluginCleanups.delete(name);
      }
      this.plugins.delete(name);
      // Remove from file mapping
      for (const [f, n] of this.fileToPluginName.entries()) {
          if (n === name) {
              this.fileToPluginName.delete(f);
              break;
          }
      }
  }

  private validatePlugin(plugin: any): plugin is Plugin {
    return (
      plugin &&
      typeof plugin.name === 'string' &&
      typeof plugin.initialize === 'function'
    );
  }

  getLoadedPlugins(): string[] {
    return Array.from(this.plugins.keys());
  }
}
