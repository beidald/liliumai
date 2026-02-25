import { WechatyBuilder, Contact, Message, ScanStatus } from 'wechaty';
import path from 'path';
import fs from 'fs';
import { BaseChannel } from './base';
import { getConfig } from '../config/loader';
import { resolvePath } from '../utils/paths';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { LocalWhisperProvider } from '../providers/transcription';

const log = logger.child({ module: 'Wechat' });

/**
 * 微信渠道实现
 */
export class WechatChannel extends BaseChannel {
  private bot: any;
  private isReady: boolean = false;
  private channelName: string;
  private scanTimeout: NodeJS.Timeout | null = null; // Debounce for scan events

  // 用于存储当前会话的文件名（基于登录后的用户ID）
  private currentSessionFile: string | null = null;
  // 临时文件，用于存储未登录前的 Session 数据
  private tempSessionFile: string = '';

  get name() { return this.channelName; }

  // 查找该渠道下所有已保存的 Session 文件
  private findExistingSessions(): string[] {
      if (!fs.existsSync(this.sessionsDir)) return [];
      
      const files = fs.readdirSync(this.sessionsDir);
      // 匹配格式: wechat_{userId}.memory-card.json
      // 排除 temp 文件
      return files.filter(f => 
          f.startsWith(this.channelName + '_') && 
          f.endsWith('.memory-card.json') &&
          !f.includes('_temp_') && // Exclude new UUID format
          !f.includes('_temp.')    // Exclude old format
      );
  }

  // 清理当前渠道的所有残留临时文件
  private cleanupStaleTempFiles(): void {
      if (!fs.existsSync(this.sessionsDir)) return;
      
      try {
          const files = fs.readdirSync(this.sessionsDir);
          const tempFiles = files.filter(f => 
              (f.startsWith(this.channelName + '_temp_') || f === `${this.channelName}_temp.memory-card.json`) && 
              f.endsWith('.memory-card.json')
          );
          
          if (tempFiles.length > 0) {
              log.info(`Found ${tempFiles.length} stale temporary session files. Cleaning up...`);
              for (const file of tempFiles) {
                  // Don't delete our OWN current temp file if it was just created (though it shouldn't be in the list yet usually, or we can check exact match)
                  const filePath = path.resolve(this.sessionsDir, file);
                  if (filePath !== this.tempSessionFile) {
                       try {
                           fs.unlinkSync(filePath);
                           log.debug(`Deleted stale temp file: ${file}`);
                       } catch (e) {
                           log.warn(`Failed to delete stale temp file ${file}: ${e}`);
                       }
                  }
              }
          }
      } catch (err) {
          log.warn(`Error during stale temp file cleanup: ${err}`);
      }
  }

  constructor(
    private sessionName: string = 'liliumai-wechat',
    private puppet: string = 'wechaty-puppet-wechat',
    private puppetToken: string = '',
    private allowFrom: string[] = [],
    private sessionsDir: string = process.cwd()
  ) {
    super();
    this.channelName = sessionName === 'liliumai-wechat' ? 'wechat' : `wechat:${sessionName}`;
    
    // 初始化时，先扫描目录下是否已经存在该渠道的已登录 Session 文件
    // 命名规则：wechat_{userId}.memory-card.json
    // 如果找到多个，默认使用第一个（单账号模式下），或者需要额外的逻辑来选择
    const existingSessions = this.findExistingSessions();
    
        if (existingSessions.length > 0) {
        // 找到了之前的登录文件，使用它
        this.currentSessionFile = existingSessions[0];
        log.info(`Found existing session file: ${this.currentSessionFile}`);
    } else {
        // 没有找到，使用临时文件
        log.info(`No existing session file found. Will use temporary file until login.`);
    }

    if (this.currentSessionFile) {
        log.info(`Using session file: ${this.currentSessionFile}`);
    } else {
        this.currentSessionFile = `${this.sessionName}_temp_${Date.now()}.memory-card.json`;
        log.info(`Creating new session file: ${this.currentSessionFile}`);
    }

    const memoryCardPath = path.resolve(this.sessionsDir, this.currentSessionFile);
    log.info(`Using memory card: ${memoryCardPath}`);

    const options: any = {
        name: this.sessionName,
        // memory: new MemoryCard({ name: this.sessionName }), // Use consistent name for memory card
    };

    // Use wechaty-puppet-wechat (UOS protocol)
    const activePuppet: string = 'wechaty-puppet-wechat';
    log.info(`Initializing Wechaty with puppet: ${activePuppet}`);
    options.puppet = activePuppet;
    
    // Explicitly set puppet options for UOS protocol
    // This helps avoid some login issues and improves stability
    const puppetOptions: any = {
        uos: true, // Force UOS protocol
    };

    // Check for cached chromium executable to speed up launch
    // The install-browser.js script should have installed it to .cache/puppeteer
    const projectRoot = path.resolve(__dirname, '../../..');
    const cacheDir = path.join(projectRoot, '.cache', 'puppeteer');
    
    if (fs.existsSync(cacheDir)) {
        // Try to find the executable path
        try {
            // Common paths for different platforms in the cache
            // Note: This is a best-effort check. If not found, Puppeteer will try its default.
            const platform = process.platform;
            let executablePath = '';
            
            // Recursive search for chrome/chromium executable in cacheDir
            const findExecutable = (dir: string): string | null => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        const result = findExecutable(fullPath);
                        if (result) return result;
                    } else {
                        if ((platform === 'darwin' && file === 'Chromium') || 
                            (platform === 'linux' && file === 'chrome') ||
                            (platform === 'win32' && file === 'chrome.exe')) {
                            // Verify it's executable
                            try {
                                fs.accessSync(fullPath, fs.constants.X_OK);
                                return fullPath;
                            } catch (e) {
                                // Not executable, ignore
                            }
                        }
                    }
                }
                return null;
            };

            const foundPath = findExecutable(cacheDir);
            if (foundPath) {
                log.info(`Using chromium executable at: ${foundPath}`);
                puppetOptions.endpoint = undefined; // Ensure no conflicting options
                puppetOptions.launchOptions = {
                    executablePath: foundPath,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                };
                log.info(`Wechaty initialized with chromium executable from cache: ${foundPath}`);
            }
        } catch (e) {
            log.warn(`Failed to resolve chromium path from cache: ${e}`);
        }
    }

    options.puppetOptions = puppetOptions;

    // Additional configuration for stability
    if (activePuppet === 'wechaty-puppet-wechat4u') {
            // Wechat4u specific options if we switch back
    } else if (activePuppet === 'wechaty-puppet-wechat') {
            // Puppeteer specific options (for UOS)
            const userDataDir = path.join(this.sessionsDir, `${this.channelName}_puppeteer_${Date.now()}`);
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            
            options.puppetOptions = {
                ...options.puppetOptions,
                uos: true,
                launchOptions: {
                    ...(options.puppetOptions?.launchOptions || {}),
                    timeout: 120000, // 2 minutes timeout for browser launch
                    headless: true, // Headless mode for server environment
                    userDataDir: userDataDir,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-gpu', // Keep this for stability on some systems
                        '--window-size=1280,960' // Keep window size for UI visibility
                        // Removed aggressive args: --disable-web-security, --ignore-certificate-errors, etc.
                    ]
                }
            };
            
            log.info(`Puppet options configured. Timeout: 120s, Minimal Args`);
    }

    this.bot = WechatyBuilder.build(options);

    this.bot.on('scan', (qrcode: string, status: ScanStatus) => {
        log.info(`Scan: Event received (Status: ${status})`);
        
        // If already logged in, ignore scan events to prevent UI glitches
        // Use bot.isLoggedIn property if available for double check
        if (this.isReady || this.bot.isLoggedIn) {
            log.info(`Scan: Event ignored because bot is already logged in.`);
            return;
        }

        // Debounce scan events if we have a memory card (potential session restore)
        const memoryCardPath = this.currentSessionFile 
            ? path.resolve(this.sessionsDir, this.currentSessionFile)
            : path.resolve(this.sessionsDir, `${this.sessionName}.memory-card.json`);
            
        const hasSessionFile = fs.existsSync(memoryCardPath);

        if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
            const qrcodeImageUrl = [
                'https://wechaty.js.org/qrcode/',
                encodeURIComponent(qrcode),
            ].join('');

            log.info(`Scan: QR Code URL: ${qrcodeImageUrl}`);
            
            log.info(`Scan: Waiting for user to scan. Status: ${status}`);
            
            // Emit event for web UI with debounce if session exists
            // 只有当 session 文件存在时才延迟 5s 发射 QR 码，避免 UI 抖动
            const emitScan = () => {
                if (this.isReady || this.bot.isLoggedIn) {
                    log.info(`Scan: Debounced scan emission canceled: Bot logged in during wait.`);
                    return;
                }
                
                log.info(`Scan: Emitting QR code to frontend now.`);
                if (this.emitEvent) {
                    this.emitEvent({ 
                        type: 'scan', 
                        data: { 
                            qrcode, 
                            url: qrcodeImageUrl, 
                            status 
                        } 
                    });
                }
            };
            // 只有当 session 文件存在时才延迟 5s 发射 QR 码，避免 UI 抖动
            if (hasSessionFile) {
                // 如果发现 session 文件太小（比如只有 2 字节，那是空 JSON "{}"），说明无效
                const stats = fs.statSync(memoryCardPath);
                if (stats.size < 10) {
                    log.warn(`Scan: Session file too small (${stats.size} bytes), considering invalid. Emitting QR code immediately.`);
                    emitScan();
                } else {
                    if (this.scanTimeout) clearTimeout(this.scanTimeout);
                    log.info(`Scan: Session file exists (${stats.size} bytes). Delaying QR code emission by 5s to see if auto-login succeeds...`);
                    this.scanTimeout = setTimeout(emitScan, 5000);
                }
            } else {
                log.info(`Scan: No session file. Emitting QR code immediately.`);
                emitScan();
            }

        } else {
            log.info(`Scan: Other status received: ${status}`);
        }
    });
    // 登录成功后，立即保存 session 文件
    this.bot.on('login', async (user: Contact) => {
        log.info(`Login: SUCCESS! User ${user} logged in (ID: ${user.id})`);
        
        // Clear any pending scan timeout
        if (this.scanTimeout) {
            log.info(`Login: Clearing pending scan timeout.`);
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }

        this.isReady = true;
        // 
        // Emit login success event to frontend (critical for UI state sync)
        if (this.emitEvent) {
            this.emitEvent({
                type: 'login_success',
                data: {
                    user: user.name(),
                    userId: user.id
                }
            });
            log.info(`Login: Emitted login_success event to WebChannel.`);
        }
        
        // Explicitly save memory card to ensure persistence immediately after login
        try {
            if (this.bot.memory) {
                log.info(`Login: Waiting for session data (cookies) to populate...`);
                
                const memory = this.bot.memory;
                
                // Helper to check for ANY valid session data (relaxed validation)
                const hasValidSessionData = (obj: any): boolean => {
                    if (!obj || typeof obj !== 'object') return false;
                    
                    // Check for standard cookies
                    if (Array.isArray(obj.cookies) && obj.cookies.length > 0) {
                        return true;
                    }
                    
                    // Check for UIN (common in wechaty)
                    if (obj.Uin || obj.uin || (obj.user && obj.user.Uin)) {
                        return true;
                    }
                    
                    // Check for any non-empty object keys that look like puppet data
                    // e.g. "wechaty-puppet-wechat": { ... }
                    if (Object.keys(obj).length > 0) {
                        // Recursive check
                        for (const key in obj) {
                             if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                 const val = obj[key];
                                 if (typeof val === 'object' && val !== null && Object.keys(val).length > 0) {
                                     // Found some nested data, assume it's valid enough
                                     return true;
                                 }
                             }
                        }
                    }
                    
                    return false;
                };

                // Polling for valid payload
                // We check every 500ms, up to 10 seconds
                let attempts = 0;
                const maxAttempts = 20;
                let payload = await memory.payload;
                let dataFound = false;
                
                while (attempts < maxAttempts) {
                    if (hasValidSessionData(payload)) {
                        dataFound = true;
                        log.info(`Login: Valid session data detected after ${attempts * 500}ms.`);
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, 500));
                    // Force reload payload
                    await memory.save(); // Trigger sync
                    payload = await memory.payload;
                    attempts++;
                }

                if (!dataFound) {
                     log.warn(`Login: Timeout waiting for specific session fields. Saving whatever we have.`);
                }
                
                log.info(`Login: Saving session to disk...`);
                // 先进行保存操作
                await memory.save();
                
                // 再次获取 payload 以确保一致性
                payload = await memory.payload;
                
                // 如果 payload 为空，尝试重新加载一下（有时候内存状态还没同步）
                if (!payload || Object.keys(payload).length === 0) {
                     log.warn(`Login: Memory payload is empty, attempting to sync...`);
                     await memory.save(); 
                     payload = await memory.payload;
                }

                // 登录成功后，从 Payload 中提取稳定的 Uin 或 NickName 作为文件名
                // 格式：{channelName}_{Uin|NickName}.memory-card.json
                // 优先使用 Uin (数字ID，稳定)，其次 NickName (可能含特殊字符需处理)，最后 fallback 到 user.id
                let stableId = '';
                
                // Helper to extract Uin/NickName from payload
                const extractStableId = (p: any): string | null => {
                    if (!p) return null;
                    // Payload structure is usually { "puppetName": { "user": { "Uin": ... } } }
                    for (const key in p) {
                        const val = p[key];
                        if (val && val.user) {
                            if (val.user.Uin) return String(val.user.Uin);
                            if (val.user.NickName) return val.user.NickName;
                        }
                        // Fallback: check PROP
                        if (val && val.PROP && val.PROP.uin) return String(val.PROP.uin);
                    }
                    return null;
                };
                // 优先使用 Uin (数字ID，稳定)，其次 NickName (可能含特殊字符需处理)，最后 fallback 到 user.id
                const extractedId = extractStableId(payload);
                if (extractedId) {
                    // Sanitize ID for filename (remove special chars)
                    stableId = extractedId.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
                    log.info(`Login: Extracted stable ID from payload: ${extractedId} -> ${stableId}`);
                } else {
                    log.warn(`Login: Could not extract Uin/NickName from payload. Fallback to user.id`);
                    // Fallback to user.id but sanitize just in case
                    stableId = user.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
                }

                const finalFileName = `${this.channelName}_${stableId}.memory-card.json`;
                const finalPath = path.resolve(this.sessionsDir, finalFileName);
                
                // 此时 Wechaty 的 memory card 还在内存里（如果是新登录）或者在旧文件里

                if (payload && Object.keys(payload).length > 0) {
                    // 直接写入最终文件
                    const fs = require('fs');
                    const jsonContent = JSON.stringify(payload); // 不格式化，保持紧凑，或者加 null, 2 方便调试
                    fs.writeFileSync(finalPath, jsonContent);
                    
                    log.info(`Login: Session saved directly to ${finalFileName}`);
                } else {
                    log.error(`Login: CRITICAL: Memory payload is still empty after sync! Session might not be saved.`);
                }
                
                // 清理所有旧的 Session 文件（包括临时文件和旧用户的 Session），只保留当前最新的
                try {
                    const allFiles = fs.readdirSync(this.sessionsDir);
                    const channelPrefix = this.channelName + '_';
                    
                    for (const file of allFiles) {
                        // 匹配当前渠道的文件: wechat_*.memory-card.json
                        if (file.startsWith(channelPrefix) && 
                            file.endsWith('.memory-card.json') && 
                            file !== finalFileName) {
                            
                            const filePath = path.resolve(this.sessionsDir, file);
                            try {
                                if (fs.existsSync(filePath)) {
                                    log.info(`Login: Cleaning up stale session file: ${file}`);
                                    fs.unlinkSync(filePath);
                                }
                            } catch (e) {
                                log.warn(`Login: Failed to delete stale file ${file}: ${e}`);
                            }
                        }
                    }
                } catch (e) {
                    log.warn(`Login: Error during session cleanup: ${e}`);
                }

                this.currentSessionFile = finalFileName;

                // Double check file size after save (check the FINAL path)
                if (fs.existsSync(finalPath)) {
                    const stats = fs.statSync(finalPath);
                    if (stats.size < 10) {
                        log.error(`Login: CRITICAL: Saved session file is suspiciously small (${stats.size} bytes)! Login might not persist.`);
                        // 如果文件太小，尝试删除它，以免下次启动误判
                        fs.unlinkSync(finalPath);
                        log.warn(`Login: Deleted invalid session file to prevent future load errors.`);
                    } else {
                        log.info(`Login: Session saved successfully to ${finalFileName} (${stats.size} bytes).`);
                    }
                }
            }
        } catch (err) {
            log.warn(`Login: Failed to manually save memory card: ${err}`);
        }
        
        try {
            // Ensure we handle both sync and async name retrieval
            
            const userName = (await user.name()) || 'Unknown';
            // Notify web UI that login is successful with user ID for session mapping
            if (this.emitEvent) {
                this.emitEvent({ 
                    type: 'login_success', 
                    data: { 
                        user: userName,
                        userId: user.id 
                    } 
                });
            }
        } catch (err) {
            log.error(`Error in login handler: ${err}`);
            // Fallback: emit success even if name retrieval fails
            if (this.emitEvent) {
                this.emitEvent({ 
                    type: 'login_success', 
                    data: { 
                        user: 'WeChat User',
                        userId: user.id 
                    } 
                });
            }
        }
    });
    // 登出时，清理 Session 文件
    this.bot.on('logout', (user: Contact, reason?: string) => {
        log.info(`Logout: User ${user} logged out. Reason: ${reason}`);
        this.isReady = false;
        
        // Notify web channel
        if (this.emitEvent) {
            this.emitEvent({
                type: 'logout',
                data: { user: user.name(), reason }
            });
        }

        // 登出时，只删除该用户对应的 Session 文件
        /*
        if (this.currentSessionFile) {
            const memoryCardPath = path.resolve(this.sessionsDir, this.currentSessionFile);
            if (fs.existsSync(memoryCardPath)) {
                try {
                    log.info(`Logout: Deleting session file for ${user.name()}: ${memoryCardPath}`);
                    fs.unlinkSync(memoryCardPath);
                    // 清空当前 Session 引用，下次启动或重连时会重新扫描或创建临时文件
                    this.currentSessionFile = null;
                } catch (err) {
                    log.warn(`Logout: Failed to delete session file: ${err}`);
                }
            }
        }
        */
    });

    this.bot.on('message', async (message: Message) => {
        await this.handleMessage(message);
    });
    // 监听 Wechaty 错误事件
    this.bot.on('error', (error: any) => {
        log.error(`Wechaty error: ${error}`);
    });
  }
  // 启动 Wechaty 实例
  async start(): Promise<void> {
    try {
        await this.bot.start();
        log.info('Channel started');
    } catch (error) {
        log.error(`Failed to start Wechat channel: ${error}`);
    }
  }

  async stop(): Promise<void> {
    try {
        // Critical: Prevent Wechaty from overwriting the session file with empty data during stop.
        // We explicitly detach the memory card from the file system by clearing its name.
        if (this.bot && this.bot.memory) {
             log.info(`Stop: Disabling memory card file sync before stop to protect session file.`);
             // @ts-ignore: Force update name to prevent file write
             this.bot.memory.name = undefined;
        }

        await this.bot.stop();
        log.info('Channel stopped');
    } catch (error) {
        log.error(`Error stopping Wechat channel: ${error}`);
    }
  }

  /**
   * 发送消息
   * @param msg 待发送的消息对象
   */
  async send(msg: OutboundMessage): Promise<void> {
    // 微信不支持流式更新单条消息，忽略流式消息块，只处理最终完整消息
    if (msg.is_stream) {
        return;
    }

    if (!this.isReady) {
        const errorMsg = 'Wechat channel not ready (not logged in)';
        log.warn(errorMsg);
        throw new Error(errorMsg);
    }

    try {
        // 尝试按联系人 ID 查找
        // 优先查找 Room，因为群聊 ID 格式可能与 Contact 相似，但 Context 通常明确
        // 这里保持原有逻辑：先 Contact 后 Room
        const contact = await this.bot.Contact.find({ id: msg.chat_id });
        if (contact) {
            await contact.say(msg.content);
            return;
        } 
        
        // 如果找不到联系人，尝试查找群组
        const room = await this.bot.Room.find({ id: msg.chat_id });
        if (room) {
            await room.say(msg.content);
            return;
        }

        // 既不是联系人也不是群组
        const errorMsg = `Wechat target not found: ${msg.chat_id}`;
        log.warn(errorMsg);
        throw new Error(errorMsg);

    } catch (error: any) {
        log.error(`Wechat send error: ${error}`);
        // Rethrow to ensure caller knows about the failure
        throw new Error(`Failed to send WeChat message: ${error.message || error}`);
    }
  }

  /**
   * 处理接收到的消息
   * @param message Wechaty 消息对象
   */
  private async handleMessage(message: Message) {
      try {
          // 忽略自己发送的消息
          if (message.self()) return;
          
          // 忽略过期的消息 (防止重启后处理历史消息)
          // 2分钟之前的消息视为历史消息，不予处理
          const age = message.age();
          if (age > 120) {
              log.info(`Ignored old message: ${age}s old, content: ${message.text().slice(0, 20)}...`);
              return;
          }

          const room = message.room();
          const sender = message.talker();
          let content = message.text();
          const type = message.type();
          
          // -------------------------------------------------------------------------
          // 语音消息处理
          // -------------------------------------------------------------------------
          if (type === this.bot.Message.Type.Audio) {
              log.info(`Received voice message from ${await sender.name()}`);
              try {
                  const fileBox = await message.toFileBox();
                  const tempDir = path.resolve(process.cwd(), 'temp', 'voice');
                  if (!fs.existsSync(tempDir)) {
                      fs.mkdirSync(tempDir, { recursive: true });
                  }
                  
                  const fileName = `${Date.now()}_${fileBox.name}`;
                  const filePath = path.join(tempDir, fileName);
                  await fileBox.toFile(filePath);
                  log.info(`Saved voice message to ${filePath}`);

                  // Get model from config
                  const config = getConfig();
                  const modelName = config.transcription?.model || 'base';
                  
                  const transcriber = new LocalWhisperProvider(modelName);
                  // Wechat voice files are usually mp3 or silk, need conversion to 16k wav for whisper.cpp
                  const text = await transcriber.transcribe(filePath, { convertAudio: true });
                  
                  if (text) {
                      content = text; // Replace content with transcribed text
                      log.info(`Voice transcription result: ${content}`);
                      // Optional: append a marker
                      content = `[语音] ${content}`;
                  } else {
                      log.info('Voice transcription result: <EMPTY> (low confidence or silence)');
                      content = '[语音消息 (识别为空)]';
                  }
                  
                  // Clean up file (optional, maybe keep for debugging for now)
                  // fs.unlinkSync(filePath); 
              } catch (e) {
                  log.error(`Failed to transcribe voice message: ${e}`);
                  content = '[语音消息 (处理错误)]';
              }
          } else if (type !== this.bot.Message.Type.Text) {
              // 暂时只处理文本和语音消息
              return;
          }

          const senderId = sender.id;
          const senderName = await sender.name();
          const senderAlias = await sender.alias(); // 获取备注名
          
          // -------------------------------------------------------------------------
          // 白名单检查逻辑 (提前执行以用于日志状态标记)
          // -------------------------------------------------------------------------
          let isWhitelisted = true;

          if (this.allowFrom.length > 0) {
             // 增强的白名单检查：支持 ID、昵称或备注
             // 1. 检查 ID (精确匹配)
             const isIdAllowed = this.allowFrom.includes(senderId);
             
             // 2. 检查 昵称 或 备注 (方便配置)
             const isNameAllowed = this.allowFrom.includes(senderName);
             const isAliasAllowed = senderAlias && this.allowFrom.includes(senderAlias);
             
             // 3. 检查 群组
             let isRoomAllowed = false;
             if (room) {
                 isRoomAllowed = this.allowFrom.includes(room.id);
             }

             // 最终判定：
             if (room) {
                 // 群消息：要么群在白名单，要么发送者在白名单
                 if (!isRoomAllowed && !isIdAllowed && !isNameAllowed && !isAliasAllowed) {
                     isWhitelisted = false;
                 }
             } else {
                 // 私聊：发送者必须在白名单
                 if (!isIdAllowed && !isNameAllowed && !isAliasAllowed) {
                     isWhitelisted = false;
                 }
             }
          }

          // -------------------------------------------------------------------------
          // 打印消息日志 (Discovery Mode)
          // -------------------------------------------------------------------------
          // 我们始终打印日志，以便用户获取 ID 配置白名单。
          // 使用 ✅/🚫 标记当前消息是否会被处理。
          const statusTag = isWhitelisted ? '✅' : '🚫';
          const typeName = this.bot.Message.Type[type];
          
          if (room) {
              const roomTopic = await room.topic();
              log.info(`${statusTag} Room Message [${typeName}] | Room: ${roomTopic} (${room.id}) | Sender: ${senderName} (${senderId})`);
          } else {
              log.info(`${statusTag} Direct Message [${typeName}] | Sender: ${senderName} (${senderId}) | Alias: ${senderAlias || 'None'}`);
          }

          // -------------------------------------------------------------------------
          // 特殊命令处理 (/id) - 允许绕过白名单以便调试
          // -------------------------------------------------------------------------
          if (content.trim() === '/id' || content.trim() === '#id') {
              const idInfo = room 
                  ? `当前群ID: ${room.id}\n您的ID: ${senderId}`
                  : `您的ID: ${senderId}\n您的微信号/备注: ${senderAlias || senderName}`;
              
              if (room) {
                  await room.say(idInfo);
              } else {
                  await sender.say(idInfo);
              }
              return;
          }

          // -------------------------------------------------------------------------
          // 执行拦截
          // -------------------------------------------------------------------------
          if (!isWhitelisted) {
              return; // ⛔️ 在此拦截，不执行后续逻辑
          }

          // 确定聊天 ID：群消息用群 ID，私聊用发送者 ID
          const chatId = room ? room.id : sender.id;
          
          // 触发 onMessage 回调，将消息传递给总线
          if (this.onMessage) {
              const inbound: InboundMessage = {
                  channel: this.name,
                  sender_id: senderId,
                  chat_id: chatId,
                  content: content,
                  timestamp: new Date(message.date().getTime()),
                  metadata: {
                      senderName,
                      roomTopic: room ? await room.topic() : undefined,
                      isRoom: !!room
                  }
              };
              await this.onMessage(inbound);
          }

      } catch (error) {
          log.error(`Error handling Wechat message: ${error}`);
      }
  }
}
