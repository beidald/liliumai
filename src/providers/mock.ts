import { LLMProvider, LLMResponse } from './base';

export class MockLLMProvider extends LLMProvider {
  config: any;
  async chat(
    messages: any[],
    tools?: any[],
    model?: string,
    maxTokens?: number,
    temperature?: number,
    onStream?: (chunk: string) => void
  ): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1].content;
    const lowerMsg = lastMessage.toLowerCase();
    
    let content = '';
    if (lowerMsg.includes('hello') || lowerMsg.includes('你好')) {
      content = `你好！我是智能助手 ${this.config.bot_name}。有什么我可以帮您的吗？`;
    } else if (lowerMsg.includes('who are you') || lowerMsg.includes('你是谁')) {
      content = `我是一个智能助手 ${this.config.bot_name}，目前运行在 Mock 模式。`;
    } else {
      content = `收到消息: "${lastMessage}"。当前处于 Mock 测试模式，请在 config.json 中配置 API Key 以启用真实 AI。`;
    }

    if (onStream) {
      // Simulate streaming for mock with delay
      for (const char of content) {
        onStream(char);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    
    return {
      content,
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  getDefaultModel(): string {
    return 'mock-model';
  }
}
