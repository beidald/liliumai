import { z } from 'zod';

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bridge_url: z.string().default('ws://localhost:3001'),
  bridge_token: z.string().default(''),
  allow_from: z.array(z.string()).default([]),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  allow_from: z.array(z.string()).default([]),
  proxy: z.string().optional(),
});

export const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(''),
  allow_from: z.array(z.string()).default([]),
});

export const FeishuConfigSchema = z.object({
  enabled: z.boolean().default(false),
  app_id: z.string().default(''),
  app_secret: z.string().default(''),
  encrypt_key: z.string().optional(),
  verification_token: z.string().optional(),
  allow_from: z.array(z.string()).default([]),
});

export const DingTalkConfigSchema = z.object({
  enabled: z.boolean().default(false),
  client_id: z.string().default(''), // AppKey
  client_secret: z.string().default(''), // AppSecret
  allow_from: z.array(z.string()).default([]),
});

export const MochatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  base_url: z.string().default('https://mochat.io'),
  socket_url: z.string().optional(),
  socket_path: z.string().default('/socket.io'),
  socket_disable_msgpack: z.boolean().default(false),
  socket_reconnect_delay_ms: z.number().default(1000),
  socket_max_reconnect_delay_ms: z.number().default(10000),
  socket_connect_timeout_ms: z.number().default(10000),
  claw_token: z.string().default(''),
  sessions: z.array(z.string()).default([]),
  panels: z.array(z.string()).default([]),
  watch_limit: z.number().default(50),
});

export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  consent_granted: z.boolean().default(false),
  poll_interval_seconds: z.number().default(60),
  smtp_host: z.string().default(''),
  smtp_port: z.number().default(587),
  smtp_user: z.string().default(''),
  smtp_pass: z.string().default(''),
  smtp_secure: z.boolean().default(false),
  imap_host: z.string().default(''),
  imap_port: z.number().default(993),
  imap_user: z.string().default(''),
  imap_pass: z.string().default(''),
  imap_tls: z.boolean().default(true),
  allow_from: z.array(z.string()).default([]),
});

export const WechatAccountSchema = z.object({
  name: z.string().default('liliumai-wechat'),
  puppet: z.string().default('wechaty-puppet-wechat'),
  puppet_token: z.string().optional(),
  allow_from: z.array(z.string()).default([]),
});

export const WechatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  accounts: z.array(WechatAccountSchema).optional(),
  // Keep legacy fields for backward compatibility if needed, 
  // or migrate them to accounts[0]
  puppet: z.string().default('wechaty-puppet-wechat'),
  puppet_token: z.string().optional(),
  allow_from: z.array(z.string()).default([]),
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token: z.string().default(''),
  app_token: z.string().default(''),
  allow_from: z.array(z.string()).default([]),
});

export const QQConfigSchema = z.object({
  enabled: z.boolean().default(false),
  app_id: z.string().default(''),
  token: z.string().default(''),
  secret: z.string().default(''),
  sandbox: z.boolean().default(false),
  allow_from: z.array(z.string()).default([]),
});

export const WebConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().default(3000),
  allow_remote: z.boolean().default(false),
});

export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'ollama', 'mock']).default('openai'),
  enabled: z.boolean().default(true),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  priority: z.number().default(10), // 优先级，值越小优先级越高
  maxTokens: z.number().default(4096), // 模型最大上下文 Token 上限
});

export const TasksConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storage_file: z.string().default('tasks.json'),
});

export const CompressionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  threshold: z.number().min(0.1).max(0.9).default(0.5),
  strategies: z.object({
    removeThinking: z.boolean().default(false),
    removeThinkingKeepLast: z.number().default(2),
    truncateToolOutputs: z.boolean().default(true),
    truncateToolMaxChars: z.number().default(1500)
  }).default({})
});

export const ToolsConfigSchema = z.object({
  restrictToWorkspace: z.boolean().default(false),
  execTimeout: z.number().default(30000),
  memoryWindow: z.number().default(50),
  maxIterations: z.number().default(20), // 循环最大迭代次数
  compressContext: z.boolean().default(true),
  compressionThreshold: z.number().min(0.1).max(0.9).default(0.5), // 触发压缩的 Token 比例 (0.1-0.9)
  compression: CompressionConfigSchema.default({}), // New compression config
  maxSkills: z.number().default(10), // 注入到提示词中的最大技能数量
  showThinkingInConsole: z.boolean().default(true), // 是否在控制台显示思考过程
  braveApiKey: z.string().optional(),
  chromePath: z.string().optional(),
  autoSkillLevel: z.number().min(0).max(10).default(0), // 0: 禁用, 1-10: 自动保存技能的自觉程度
  tasks: TasksConfigSchema.default({}),
});

export const SecurityConfigSchema = z.object({
  restrict_fs_write: z.boolean().default(true),
  restrict_shell_execution: z.boolean().default(true),
  allowed_read_only_commands: z.array(z.string()).default([
    'ls', 'cat', 'grep', 'head', 'tail', 'find', 'wc', 'du', 'stat', 'file', 'more', 'less', 'hexdump', 'strings', 'diff'
  ]),
  dangerous_code_patterns: z.object({
    python: z.array(z.string()).default(['os.system', 'subprocess.call', 'shutil.rmtree']),
    node: z.array(z.string()).default(['child_process', 'fs.unlink', 'fs.rm'])
  }).default({})
});

export const TranscriptionConfigSchema = z.object({
  provider: z.enum(['groq', 'local', 'none']).default('none'),
  apiKey: z.string().optional(),
  model: z.string().default('base'), // For local whisper
});

export const AdminConfigSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  session_secret: z.string().optional(),
});

export const KnowledgeBaseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['lancedb', 'sqlite']).default('sqlite'),
  storage_path: z.string().default('./data/knowledge'),
  default_collection: z.string().default('general'),
  dimension: z.number().default(1536),
  embedding: z.object({
    provider: z.enum(['openai', 'ollama', 'aliyun']).default('ollama'),
    // Deprecated fields, kept for backward compatibility if needed, but new config should use providers object
    model: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    // New structured config
    ollama: z.object({
      enabled: z.boolean().default(true),
      model: z.string().default('nomic-embed-text'),
      baseUrl: z.string().default('http://localhost:11434'),
      dimension: z.number().default(768).optional(),
    }).optional(),
    aliyun: z.object({
      enabled: z.boolean().default(false),
      model: z.string().default('text-embedding-v1'),
      apiKey: z.string().default(''),
      baseUrl: z.string().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      dimension: z.number().default(1536).optional(),
    }).optional(),
    openai: z.object({
      enabled: z.boolean().default(false),
      model: z.string().default('text-embedding-3-small'),
      apiKey: z.string().default(''),
      baseUrl: z.string().default('https://api.openai.com/v1'),
      dimension: z.number().default(1536).optional(),
    }).optional(),
  }).default({}),
});

export const SkillsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auto_save: z.boolean().default(true),
  path: z.string().default('./skills'),
  max_skills: z.number().default(10),
});

export const ConfigSchema = z.object({
  bot_name: z.string().default('Lilium'),
  admin: AdminConfigSchema.optional(),
  workspace: z.string().default('./workspace'),
  llm: z.union([LLMConfigSchema, z.array(LLMConfigSchema)]).default({}),
  transcription: TranscriptionConfigSchema.default({}),
  knowledge_base: KnowledgeBaseConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  channels: z.object({
    whatsapp: WhatsAppConfigSchema.default({}),
    telegram: TelegramConfigSchema.default({}),
    discord: DiscordConfigSchema.default({}),
    feishu: FeishuConfigSchema.default({}),
    dingtalk: DingTalkConfigSchema.default({}),
    mochat: MochatConfigSchema.default({}),
    email: EmailConfigSchema.default({}),
    wechat: WechatConfigSchema.default({}),
    slack: SlackConfigSchema.default({}),
    qq: QQConfigSchema.default({}),
    web: WebConfigSchema.default({}),
  }).default({}),
  tools: ToolsConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
