
import { KnowledgeBaseService } from '../src/services/knowledge/service';
import { loadConfig } from '../src/config/loader';
import fs from 'fs-extra';
import path from 'path';
import logger from '../src/utils/logger';

async function main() {
  console.log('🚀 Starting Chat History Import...');

  // 1. Load Config & Initialize KB
  const config = await loadConfig();
  if (!config.knowledge_base || !config.knowledge_base.enabled) {
    console.error('❌ Knowledge Base is disabled in config.');
    process.exit(1);
  }

  try {
    const kb = KnowledgeBaseService.initialize(config.knowledge_base);
    await kb.start();
    console.log('✅ Knowledge Base Service initialized.');

    // 2. Locate Sessions Directory
    // Resolve workspace relative to project root if needed
    let workspace = config.workspace;
    if (!path.isAbsolute(workspace)) {
        workspace = path.resolve(process.cwd(), workspace);
    }
    const sessionsDir = path.join(workspace, 'sessions');
    
    if (!fs.existsSync(sessionsDir)) {
        console.error(`❌ Sessions directory not found at ${sessionsDir}`);
        process.exit(1);
    }

    console.log(`📂 Scanning sessions in ${sessionsDir}...`);
    const files = await fs.readdir(sessionsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`Found ${jsonFiles.length} session files.`);

    let totalImported = 0;
    let totalSkipped = 0;

    for (const file of jsonFiles) {
        try {
            const filePath = path.join(sessionsDir, file);
            const sessionData = await fs.readJson(filePath);
            
            // Handle legacy array format or new object format
            const messages = Array.isArray(sessionData) ? sessionData : (sessionData.messages || []);
            
            if (messages.length === 0) continue;

            // Group messages into turns (User -> Assistant)
            // Simple heuristic: specific user message followed by assistant message
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (msg.role === 'user' && msg.content) {
                    // Find next assistant message
                    let assistantMsg = null;
                    for (let j = i + 1; j < messages.length; j++) {
                        if (messages[j].role === 'assistant' && messages[j].content) {
                            assistantMsg = messages[j];
                            break;
                        }
                        // Stop if another user message appears (unlikely in normal flow but possible)
                        if (messages[j].role === 'user') break;
                    }

                    if (assistantMsg) {
                        const content = `User: ${msg.content}\nAssistant: ${assistantMsg.content}`;
                        const timestamp = new Date(msg.timestamp || Date.now()).getTime();
                        
                        // Generate a deterministic ID to avoid duplicates
                        // Use session ID (filename) + message timestamp/index
                        const sessionId = file.replace('.json', '');
                        const docId = `history_${sessionId}_${timestamp}_${i}`;
                        
                        // Add to KB with retry
                        let retries = 3;
                        while (retries > 0) {
                            try {
                                await kb.addDocument(content, {
                                    source: 'history',
                                    sessionId: sessionId,
                                    created_at: timestamp,
                                    channel: 'imported' 
                                }, 'history', docId);
                                break; // Success
                            } catch (e: any) {
                                retries--;
                                if (retries === 0) throw e;
                                console.warn(`⚠️ Embedding failed, retrying (${retries} left)...`);
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                        
                        totalImported++;
                        if (totalImported % 10 === 0) process.stdout.write('.');
                    }
                }
            }
        } catch (err) {
            console.error(`\n❌ Failed to process ${file}: ${err}`);
            totalSkipped++;
        }
    }

    console.log(`\n\n🎉 Import Complete!`);
    console.log(`- Imported ${totalImported} conversation turns.`);
    console.log(`- Skipped ${totalSkipped} files (errors).`);
    
    process.exit(0);

  } catch (err) {
    console.error('❌ Fatal Error:', err);
    process.exit(1);
  }
}

main();
