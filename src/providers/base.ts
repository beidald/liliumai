export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  usage?: Record<string, number>;
  reasoningContent?: string | null;
}

export abstract class LLMProvider {
  constructor(protected apiKey?: string, protected apiBase?: string) {}

  abstract chat(
    messages: any[],
    tools?: any[],
    model?: string,
    maxTokens?: number,
    temperature?: number,
    onStream?: (chunk: string) => void
  ): Promise<LLMResponse>;

  abstract getDefaultModel(): string;

  getMaxTokens(model?: string): number {
    return 4096;
  }

  async getEmbedding(text: string): Promise<number[]> {
    throw new Error('Method not implemented.');
  }

  getDimension(): number {
    return 1536; // Default to OpenAI dimension
  }
}
