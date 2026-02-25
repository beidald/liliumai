import { OpenAIProvider } from './openai';
import logger from '../utils/logger';

export class OllamaProvider extends OpenAIProvider {
  constructor(apiBase: string = 'http://localhost:11434/v1', apiKey: string = 'ollama') {
    // Ollama typically doesn't need an API key, but the OpenAI client requires one.
    // 'ollama' is a common placeholder used for local servers.
    super(apiKey, apiBase);
    logger.info(`OllamaProvider initialized with base URL: ${apiBase}`);
  }

  getDefaultModel(): string {
    return 'llama3'; // Default to a common Ollama model
  }
}
