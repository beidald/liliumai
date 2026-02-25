import OpenAI from 'openai';
import { LLMProvider, LLMResponse, ToolCallRequest } from './base';
import logger from '../utils/logger';

export class OpenAIProvider extends LLMProvider {
  private client: OpenAI;

  constructor(apiKey?: string, apiBase?: string) {
    super(apiKey, apiBase);
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      baseURL: apiBase || process.env.OPENAI_API_BASE,
    });
  }

  async chat(
    messages: any[],
    tools?: any[],
    model?: string,
    maxTokens: number = 4096,
    temperature: number = 0.7,
    onStream?: (chunk: string) => void
  ): Promise<LLMResponse> {
    const targetModel = model || this.getDefaultModel();
    
    try {
      logger.info(`Calling LLM model (stream: ${!!onStream}): ${targetModel}`);
      const response = await this.client.chat.completions.create({
        model: targetModel,
        messages,
        tools: tools as any,
        max_tokens: maxTokens,
        temperature,
        stream: !!onStream,
      });

      if (onStream) {
        let fullContent = '';
        let toolCalls: any[] = [];
        let finishReason = 'stop';

        for await (const chunk of response as any) {
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;
          
          if (delta?.content) {
            fullContent += delta.content;
            await onStream(delta.content);
          }
          
          if (delta?.tool_calls) {
            // Merge tool calls from stream chunks
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;
              if (!toolCalls[index]) {
                toolCalls[index] = { id: toolCall.id || '', name: '', arguments: '' };
              }
              if (toolCall.id) toolCalls[index].id = toolCall.id;
              if (toolCall.function?.name) toolCalls[index].name += toolCall.function.name;
              if (toolCall.function?.arguments) toolCalls[index].arguments += toolCall.function.arguments;
            }
          }
          
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }

        return {
          content: fullContent,
          toolCalls: toolCalls.map(tc => {
            try {
              return {
                id: tc.id,
                name: tc.name,
                arguments: JSON.parse(tc.arguments || '{}'),
              };
            } catch (e) {
              logger.warn(`Failed to parse tool arguments for ${tc.name}: ${e}`);
              return {
                id: tc.id,
                name: tc.name,
                arguments: {}, 
              };
            }
          }),
          finishReason,
        };
      }

      // Non-streaming fallback
      const result = response as OpenAI.Chat.Completions.ChatCompletion;
      logger.info('LLM response received');
  
      const choice = result.choices[0];
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })) || [],
        finishReason: choice.finish_reason,
      };
    } catch (err) {
      logger.error(`OpenAI API error: ${err}`);
      throw err;
    }
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      logger.error('Failed to get embedding from OpenAI:', error);
      throw error;
    }
  }

  getDimension(): number {
    return 1536;
  }
}
