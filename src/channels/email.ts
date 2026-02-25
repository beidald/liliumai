import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { BaseChannel } from './base';
import { OutboundMessage, InboundMessage } from '../bus/events';
import logger from '../utils/logger';

const log = logger.child({ module: 'Email' });

export class EmailChannel extends BaseChannel {
  private transporter: nodemailer.Transporter;
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  
  // Cache to store last subject/messageId to reply in thread
  private lastSubjectByChat: Map<string, string> = new Map();
  private lastMessageIdByChat: Map<string, string> = new Map();
  private processedUids: Set<number> = new Set();

  get name() { return 'email'; }

  constructor(
    private smtpConfig: {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
    },
    private imapConfig: {
        user: string;
        password: string;
        host: string;
        port: number;
        tls: boolean;
        authTimeout?: number;
    },
    private pollIntervalMs: number = 60000,
    private allowFrom: string[] = []
  ) {
    super();
    this.transporter = nodemailer.createTransport(this.smtpConfig);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    log.info('Channel started (polling mode)');
    
    // Initial poll
    this.poll();
    
    // Schedule polling
    this.pollInterval = setInterval(() => {
        this.poll();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
    }
    log.info('Channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
        const to = msg.chat_id;
        const subject = this.lastSubjectByChat.get(to) || 'Message from Nanobot';
        const inReplyTo = this.lastMessageIdByChat.get(to);

        const mailOptions: any = {
            from: this.smtpConfig.auth.user,
            to: to,
            subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
            text: msg.content,
        };

        if (inReplyTo) {
            mailOptions.inReplyTo = inReplyTo;
            mailOptions.references = inReplyTo;
        }

        await this.transporter.sendMail(mailOptions);
        log.info(`Sent to ${to}`);
    } catch (error: any) {
        log.error(`Send error: ${error}`);
        throw new Error(`Failed to send email: ${error.message || error}`);
    }
  }

  private async poll() {
      if (!this.isRunning) return;

      let connection: imaps.ImapSimple | null = null;
      try {
          const config = {
              imap: {
                  user: this.imapConfig.user,
                  password: this.imapConfig.password,
                  host: this.imapConfig.host,
                  port: this.imapConfig.port,
                  tls: this.imapConfig.tls,
                  authTimeout: this.imapConfig.authTimeout || 10000
              }
          };

          connection = await imaps.connect(config);
          await connection.openBox('INBOX');

          const searchCriteria = ['UNSEEN'];
          const fetchOptions = {
              bodies: ['HEADER', 'TEXT', ''],
              markSeen: true
          };

          const messages = await connection.search(searchCriteria, fetchOptions);

          for (const item of messages) {
              const all = item.parts.find((part: any) => part.which === '');
              const id = item.attributes.uid;
              const idHeader = item.parts.find((part: any) => part.which === 'HEADER');
              const body = all?.body || '';
              
              // Parse full email
              const parsed = await simpleParser(body);
              
              const from = parsed.from?.value[0]?.address;
              const subject = parsed.subject;
              const messageId = parsed.messageId;
              const text = parsed.text;

              if (!from || !text) continue;

              // Filter allowFrom
              if (this.allowFrom.length > 0 && !this.allowFrom.includes(from)) {
                  continue;
              }

              // Update cache for replies
              if (subject) this.lastSubjectByChat.set(from, subject);
              if (messageId) this.lastMessageIdByChat.set(from, messageId);

              if (this.onMessage) {
                  const inbound: InboundMessage = {
                      channel: this.name,
                      sender_id: from,
                      chat_id: from,
                      content: text,
                      timestamp: parsed.date || new Date(),
                      metadata: {
                          subject,
                          messageId
                      }
                  };
                  await this.onMessage(inbound);
              }
          }

      } catch (error) {
          log.error(`Polling error: ${error}`);
      } finally {
          if (connection) {
              try {
                  connection.end();
              } catch (e) {
                  // ignore
              }
          }
      }
  }
}
