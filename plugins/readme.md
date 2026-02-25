# Lilium AI 插件开发指南

本目录 (`plugins/`) 用于存放用户自定义插件。系统会自动扫描、加载并监视此目录下的变更（热重载）。

## 目录

1.  [插件结构](#插件结构)
2.  [调用内部工具](#调用内部工具)
3.  [使用外部 API](#使用外部-api)
4.  [高级功能：事件监听](#高级功能事件监听)
5.  [热重载与安全](#热重载与安全)

---

## 插件结构

一个最简单的插件只需导出一个包含 `initialize` 方法的对象：

```javascript
// plugins/my_plugin.js
module.exports = {
  name: 'my-plugin', // 必填：唯一标识符
  version: '1.0.0',
  description: '我的第一个插件',
  
  // 初始化入口：获得 context 上下文
  initialize: async (context) => {
    context.logger.info('插件已加载！');
  },
  
  // 可选：插件卸载时的清理逻辑
  shutdown: async () => {
    console.log('插件已卸载');
  }
};
```

### `context` 对象

`initialize` 方法接收的 `context` 参数包含以下核心能力：

*   `context.tools`: **工具注册表**。用于注册新工具或调用现有工具。
*   `context.bus`: **消息总线**。用于监听系统事件或发送消息。
*   `context.workspace`: **工作空间路径**。
*   `context.logger`: **日志记录器**。

---

## 调用内部工具

插件不仅可以注册新工具，还可以**调用系统现有的内部工具**（如文件读写、网页搜索、Shell 执行等）。这使得您可以组合现有能力来构建更强大的功能。

### 核心 API

```javascript
// 语法
await context.tools.execute(toolName, parameters);
```

### 常用工具列表

| 工具名称 | 描述 | 参数示例 |
| :--- | :--- | :--- |
| `read_file` | 读取文件内容 | `{ path: 'README.md' }` |
| `write_file` | 写入文件 | `{ path: 'test.txt', content: 'hello' }` |
| `list_dir` | 列出目录 | `{ path: './src' }` |
| `web_search` | 联网搜索 | `{ query: 'Lilium AI' }` |
| `exec_shell` | 执行 Shell 命令 | `{ command: 'echo hello' }` |
| `message` | 发送消息给用户 | `{ content: '你好', channel: 'cli', chat_id: 'default' }` |

### 示例：自动归档插件

这个插件演示了如何组合 `list_dir` 和 `write_file` 工具来实现自动生成文件索引的功能。

```javascript
module.exports = {
  name: 'auto-indexer',
  version: '1.0.0',
  
  initialize: async (context) => {
    // 注册一个供 AI 调用的新工具
    context.tools.register({
      name: 'generate_index',
      description: '为指定目录生成文件索引',
      parameters: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: '要索引的目录路径' }
        },
        required: ['dirPath']
      },
      
      execute: async (params) => {
        // 1. 调用内部工具 list_dir 获取文件列表
        const listResult = await context.tools.execute('list_dir', { 
          path: params.dirPath 
        });
        
        // 2. 处理结果（假设 listResult 是字符串格式的文件列表）
        const indexContent = `Index of ${params.dirPath}:\n\n${listResult}`;
        
        // 3. 调用内部工具 write_file 保存结果
        const indexPath = `${params.dirPath}/INDEX.md`;
        await context.tools.execute('write_file', {
          path: indexPath,
          content: indexContent
        });
        
        return `成功生成索引文件：${indexPath}`;
      }
    });
  }
};
```

---

## 使用外部 API

由于插件运行在标准的 Node.js 环境中，您可以自由使用任何 Node.js 原生模块（如 `http`, `fs`, `crypto`）或项目已安装的第三方库（如 `axios`）。

### 示例：比特币价格查询插件

```javascript
// 直接使用 Node.js 原生 fetch (Node 18+)
module.exports = {
  name: 'crypto-price',
  initialize: async (context) => {
    context.tools.register({
      name: 'get_bitcoin_price',
      description: '获取当前比特币价格',
      parameters: { type: 'object', properties: {} },
      
      execute: async () => {
        try {
          const response = await fetch('https://api.coindesk.com/v1/bpi/currentprice.json');
          const data = await response.json();
          const price = data.bpi.USD.rate;
          return `当前比特币价格: $${price}`;
        } catch (error) {
          context.logger.error('获取价格失败', error);
          return '获取价格失败，请稍后再试。';
        }
      }
    });
  }
};
```

---

## 高级功能：事件监听

插件可以监听系统总线上的消息，从而实现“被动触发”的功能（例如：收到特定消息时自动回复）。

```javascript
module.exports = {
  name: 'keyword-reply',
  initialize: async (context) => {
    // 监听发出的消息（Outbound）
    const unsubscribe = context.bus.subscribeOutbound('cli', async (msg) => {
      // 注意：这里只是示例，通常我们监听 Inbound 消息来处理用户输入
      // 但目前插件系统主要暴露 Outbound 订阅
      console.log('Bot 回复了:', msg.content);
    });
    
    // 注意：系统会自动管理 unsubscribe，您无需手动调用
  }
};
```

---

## 热重载与安全

Lilium AI 的插件系统支持**热重载**。

*   **修改即生效**：直接编辑并保存 `.js` 文件，系统会自动重新加载插件。
*   **安全沙箱**：
    *   如果插件代码报错，不会导致主程序崩溃。
    *   插件重载时，系统会自动**注销**它注册的所有工具和**取消**所有事件监听，防止内存泄漏。
