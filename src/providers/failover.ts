import { LLMProvider, LLMResponse } from './base';
import logger from '../utils/logger';

export interface ProviderInstance {
  provider: LLMProvider;
  model?: string;
  priority: number;
  name: string;
  maxTokens?: number;
}

export class FailoverLLMProvider extends LLMProvider {
  private providers: ProviderInstance[] = [];

  constructor(providers: ProviderInstance[]) {
    super();
    // 按优先级排序，值越小越靠前
    this.providers = providers.sort((a, b) => a.priority - b.priority);
    logger.info(`FailoverLLMProvider initialized with ${this.providers.length} providers`);
  }

  async chat(
    messages: any[],
    tools?: any[],
    model?: string,
    maxTokens: number = 4096,
    temperature: number = 0.7,
    onStream?: (chunk: string) => void
  ): Promise<LLMResponse> {
    let lastError: any = null;

    for (const instance of this.providers) {
      try {
        const targetModel = model || instance.model || instance.provider.getDefaultModel();
        logger.info(`Attempting chat with provider: ${instance.name} (Priority: ${instance.priority}, Model: ${targetModel})`);
        
        return await instance.provider.chat(
          messages,
          tools,
          targetModel,
          maxTokens,
          temperature,
          onStream
        );
      } catch (err) {
        lastError = err;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn(`Provider ${instance.name} failed: ${errorMessage}. Trying next...`);
        // 如果是流式输出失败，可能已经输出了一部分，这里需要注意
        // 但由于 chat 返回的是 Promise，如果报错通常是在开始阶段或网络层
      }
    }

    logger.error('All LLM providers failed.');
    throw lastError || new Error('All LLM providers failed');
  }

  getDefaultModel(): string {
    return this.providers[0]?.model || this.providers[0]?.provider.getDefaultModel() || 'unknown';
  }

  getMaxTokens(model?: string): number {
    if (model) {
      const instance = this.providers.find(p => p.model === model);
      if (instance?.maxTokens) return instance.maxTokens;
    }
    return this.providers[0]?.maxTokens || 4096;
  }

  async getEmbedding(text: string): Promise<number[]> {
    let lastError: any = null;
    for (const instance of this.providers) {
      try {
        return await instance.provider.getEmbedding(text);
      } catch (err) {
        lastError = err;
        // Continue to next provider
      }
    }
    throw lastError || new Error('All providers failed to get embedding');
  }

  getDimension(): number {
    // Try to find a provider that implements getDimension
    for (const instance of this.providers) {
      try {
        return instance.provider.getDimension();
      } catch {
        // Ignore
      }
    }
    return 1536; // Default
  }
}
