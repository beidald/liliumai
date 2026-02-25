import { chromium, Browser, Page } from 'playwright';
import { Tool } from './base';
import logger from '../../utils/logger';
// 中文功能描述：浏览器工具类
export class BrowserTool extends Tool {
  private browser: Browser | null = null;
  private chromePath: string | undefined;
  // 中文功能描述：浏览器工具构造函数
  constructor(chromePath?: string) {
    super();
    this.chromePath = chromePath || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  // 中文功能描述：浏览器操作工具
  get name() { return 'browser_action'; }
  get description() { 
    return 'Control a headless browser to visit websites or search. ' +
           'Actions: "navigate" (visit URL), "search" (search on DuckDuckGo).'; 
  }
  // 中文功能描述：浏览器操作参数
  get parameters() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['navigate', 'search'], description: 'Action to perform' },
        url: { type: 'string', description: 'URL to visit (for navigate)' },
        query: { type: 'string', description: 'Search query (for search)' },
        waitForSelector: { type: 'string', description: 'Optional CSS selector to wait for' }
      },
      required: ['action']
    };
  }
  // 中文功能描述：确保浏览器实例
  private async ensureBrowser() {
    if (!this.browser) {
      logger.info(`Starting headless browser using: ${this.chromePath}`);
      this.browser = await chromium.launch({
        executablePath: this.chromePath,
        headless: true
      });
    }
    return this.browser;
  }
  // 中文功能描述：执行浏览器操作
  async execute(params: { action: string; url?: string; query?: string; waitForSelector?: string }): Promise<string> {
    try {
      const browser = await this.ensureBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      let result = '';

      if (params.action === 'navigate') {
        if (!params.url) return 'Error: URL is required for navigate action';
        logger.info(`Browsing to ${params.url}...`);
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (params.waitForSelector) {
          await page.waitForSelector(params.waitForSelector, { timeout: 5000 });
        }
        result = await this.extractPageContent(page);
      } else if (params.action === 'search') {
        if (!params.query) return 'Error: Query is required for search action';
        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        logger.info(`Searching DuckDuckGo for: ${params.query}...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        result = await this.extractSearchWebResults(page);
      }

      await context.close();
      return result;
    } catch (err: any) {
      logger.error(`Browser tool error: ${err.message}`);
      return `Error using browser: ${err.message}`;
    }
  }
  // 中文功能描述：提取网页内容
  private async extractPageContent(page: Page): Promise<string> {
    // Extract text and basic structure
    const content = await page.evaluate(() => {
      // Remove scripts and styles
      const scripts = document.querySelectorAll('script, style, nav, footer, header');
      scripts.forEach(s => s.remove());
      return document.body.innerText;
    });

    const cleaned = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();

    return cleaned.length > 15000 ? cleaned.slice(0, 15000) + '... (truncated)' : cleaned;
  }

  private async extractSearchWebResults(page: Page): Promise<string> {
    // Extract search results from DuckDuckGo HTML version
    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.result'));
      return items.slice(0, 8).map(item => {
        const titleEl = item.querySelector('.result__title');
        const snippetEl = item.querySelector('.result__snippet');
        const urlEl = item.querySelector('.result__url');
        return {
          title: titleEl?.textContent?.trim() || '',
          snippet: snippetEl?.textContent?.trim() || '',
          url: urlEl?.textContent?.trim() || ''
        };
      });
    });

    if (results.length === 0) return 'No results found.';

    return results.map((r, i) => 
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`
    ).join('\n\n');
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
