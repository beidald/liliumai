import axios from 'axios';
import { Tool } from './base';
import logger from '../../utils/logger';
// 中文功能描述：WebFetchTool工具类
function stripTags(text: string): string {
  // Simple regex-based tag stripping as in the Python version
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// 中文功能描述：归一化文本
function normalize(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
// 中文功能描述：WebSearchTool工具类
export class WebSearchTool extends Tool {
  get name() { return 'web_search'; }
  get description() { return 'Search the web using Brave Search API. Returns titles, URLs, and snippets.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'integer', description: 'Number of results (1-10)', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    };
  }

  constructor(private apiKey?: string, private maxResults: number = 5) {
    super();
  }

  async execute(params: { query: string, count?: number }): Promise<string> {
    const key = this.apiKey || process.env.BRAVE_API_KEY;
    if (!key) {
      return 'Error: BRAVE_API_KEY not configured';
    }

    try {
      const n = Math.min(Math.max(params.count || this.maxResults, 1), 10);
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: { q: params.query, count: n },
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': key,
        },
        timeout: 10000,
      });

      const results = response.data.web?.results || [];
      if (results.length === 0) {
        return `No results for: ${params.query}`;
      }

      const lines = [`Results for: ${params.query}\n`];
      results.slice(0, n).forEach((item: any, i: number) => {
        lines.push(`${i + 1}. ${item.title}\n   ${item.url}`);
        if (item.description) {
          lines.push(`   ${item.description}`);
        }
      });

      return lines.join('\n');
    } catch (err: any) {
      logger.error(`Web search error: ${err.message}`);
      return `Error performing web search: ${err.message}`;
    }
  }
}
// 中文功能描述：WebFetchTool工具类
export class WebFetchTool extends Tool {
  get name() { return 'web_fetch'; }
  get description() { return 'Fetch a URL and extract readable content (HTML to text).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    };
  }
  // 中文功能描述：执行WebFetchTool工具类
  async execute(params: { url: string }): Promise<string> {
    try {
      const response = await axios.get(params.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const content = normalize(stripTags(response.data));
      return content.length > 10000 ? content.slice(0, 10000) + '... (truncated)' : content;
    } catch (err: any) {
      logger.error(`Web fetch error: ${err.message}`);
      return `Error fetching URL: ${err.message}`;
    }
  }
}
