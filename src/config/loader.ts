import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { Config, ConfigSchema } from './schema';
import logger from '../utils/logger';

let globalConfig: Config | null = null;

export function getConfigPaths(): string[] {
  // Use a more stable project root detection
  const projectRoot = process.env.NODE_PATH || process.cwd();
  
  // In pkg environment, process.cwd() is the directory where the executable is run from
  // But __dirname is inside the virtual filesystem (/snapshot/...)
  // We want to support loading config from the same directory as the executable
  const execDir = (process as any).pkg ? path.dirname(process.execPath) : projectRoot;

  // For development, we might be running from dist/ or src/
  // But wait, if whisper-node changed it, process.cwd() is wrong.
  // Let's try to find it relative to this file.
  const relativeProjectRoot = path.join(__dirname, '..', '..');
  
  return [
    path.join(execDir, 'config.json'),
    path.join(projectRoot, 'config.json'),
    path.join(relativeProjectRoot, 'config.json'),
    path.join(os.homedir(), '.liliumai', 'config.json'),
  ];
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const paths = configPath ? [configPath] : getConfigPaths();
  
  for (const p of paths) {
    if (await fs.pathExists(p)) {
      try {
        const data = await fs.readJson(p);
        logger.info(`Loaded config from ${p}`);
        const config = ConfigSchema.parse(data);
        globalConfig = config; // Cache the config
        return config;
      } catch (err) {
        logger.warn(`Failed to load config from ${p}: ${err}`);
      }
    }
  }
  
  logger.info('Using default configuration');
  const defaultConfig = ConfigSchema.parse({});
  globalConfig = defaultConfig;
  return defaultConfig;
}

export function getConfig(): Config {
  if (globalConfig) {
    return globalConfig;
  }
  
  // Fallback: Try to load synchronously if not yet loaded
  const paths = getConfigPaths();
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const data = fs.readJsonSync(p);
        const config = ConfigSchema.parse(data);
        globalConfig = config;
        return config;
      } catch (err) {
        console.warn(`Failed to sync load config from ${p}: ${err}`);
      }
    }
  }

  // Final fallback
  const defaultConfig = ConfigSchema.parse({});
  globalConfig = defaultConfig;
  return defaultConfig;
}

export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const p = configPath || getConfigPaths()[0];
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, config, { spaces: 2 });
}

export async function backupConfig(configPath?: string): Promise<string | null> {
  const p = configPath || getConfigPaths()[0];
  if (await fs.pathExists(p)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${p}.${timestamp}.bak`;
    await fs.copy(p, backupPath);
    logger.info(`Config backed up to ${backupPath}`);
    return backupPath;
  }
  return null;
}

export async function updateConfig(partialConfig: any, configPath?: string): Promise<Config> {
  const p = configPath || getConfigPaths()[0];
  
  // 1. Load current config from disk to ensure we have the latest base
  let currentConfig: any = {};
  if (await fs.pathExists(p)) {
    try {
      currentConfig = await fs.readJson(p);
    } catch (err) {
      logger.warn(`Failed to read current config for update: ${err}`);
    }
  }

  // 2. Backup existing config
  await backupConfig(p);

  // 3. Deep merge logic (simple version)
  // We need a deep merge to avoid overwriting nested objects
  const mergeDeep = (target: any, source: any) => {
    const isObject = (obj: any) => obj && typeof obj === 'object';

    if (!isObject(target) || !isObject(source)) {
      return source;
    }

    Object.keys(source).forEach(key => {
      const targetValue = target[key];
      const sourceValue = source[key];

      if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
        target[key] = sourceValue; // For arrays, we usually replace them
      } else if (isObject(targetValue) && isObject(sourceValue)) {
        target[key] = mergeDeep(Object.assign({}, targetValue), sourceValue);
      } else {
        target[key] = sourceValue;
      }
    });

    return target;
  };

  const newConfigData = mergeDeep(currentConfig, partialConfig);
  
  // 4. Validate with Schema
  try {
    const validatedConfig = ConfigSchema.parse(newConfigData);
    
    // 5. Save to disk
    await saveConfig(validatedConfig, p);
    logger.info(`Config updated and saved to ${p}`);
    
    return validatedConfig;
  } catch (error) {
    logger.error(`Config validation failed: ${error}`);
    throw new Error(`Invalid configuration: ${error}`);
  }
}

