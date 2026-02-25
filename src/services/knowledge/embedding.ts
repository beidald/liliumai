
import axios from 'axios';
import { EmbeddingProvider } from './types';
import logger from '../../utils/logger';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimension?: number;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text', dimension?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimension = dimension;
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/embeddings`, {
        model: this.model,
        prompt: text,
      });
      return response.data.embedding;
    } catch (error: any) {
      logger.error('Failed to get embedding from Ollama:', error.message);
      throw error;
    }
  }

  getDimension(): number {
    if (this.dimension) return this.dimension;
    if (this.model.includes('nomic')) return 768;
    if (this.model.includes('mxbai')) return 1024;
    return 4096;
  }
}

export class AliyunEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private dimension?: number;

  constructor(apiKey: string, model: string = 'text-embedding-v1', baseUrl: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1', dimension?: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.dimension = dimension;
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      // Aliyun DashScope OpenAI compatible endpoint
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          model: this.model,
          input: text,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        return response.data.data[0].embedding;
      }
      throw new Error('Invalid response format from Aliyun');
    } catch (error: any) {
      logger.error('Failed to get embedding from Aliyun:', error.message);
      if (error.response) {
          logger.error('Aliyun response:', error.response.data);
      }
      throw error;
    }
  }

  getDimension(): number {
    if (this.dimension) return this.dimension;
    if (this.model.includes('v1')) return 1536;
    if (this.model.includes('v2')) return 1536;
    if (this.model.includes('v3')) return 1024; // Check specific model specs
    return 1536;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private apiKey: string;
    private model: string;
    private baseUrl: string;
    private dimension?: number;
  
    constructor(apiKey: string, model: string = 'text-embedding-3-small', baseUrl: string = 'https://api.openai.com/v1', dimension?: number) {
      this.apiKey = apiKey;
      this.model = model;
      this.baseUrl = baseUrl.replace(/\/$/, '');
      this.dimension = dimension;
    }
  
    async getEmbedding(text: string): Promise<number[]> {
      try {
        const response = await axios.post(
          `${this.baseUrl}/embeddings`,
          {
            model: this.model,
            input: text,
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        if (response.data && response.data.data && response.data.data.length > 0) {
          return response.data.data[0].embedding;
        }
        throw new Error('Invalid response format from OpenAI');
      } catch (error: any) {
        logger.error('Failed to get embedding from OpenAI:', error.message);
        throw error;
      }
    }
  
    getDimension(): number {
      if (this.dimension) return this.dimension;
      if (this.model.includes('small')) return 1536;
      if (this.model.includes('large')) return 3072;
      return 1536;
    }
  }
