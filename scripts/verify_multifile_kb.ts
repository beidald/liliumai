
import { KnowledgeBaseService } from '../src/services/knowledge/service';
import * as fs from 'fs';
import * as path from 'path';

// Mock config or load real one? Let's load real one to test integration
const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

async function main() {
  console.log('🚀 Starting Multi-File Knowledge Base Verification...');

  // Ensure knowledge base is enabled in config for test
  config.knowledge_base.enabled = true;
  
  // Initialize Service
  console.log('Initializing Knowledge Base Service...');
  const service = KnowledgeBaseService.initialize(config.knowledge_base);
  await service.start();

  if (!service.isInitialized()) {
    console.error('❌ Service failed to initialize');
    process.exit(1);
  }

  // 1. Add document to default collection (general)
  console.log('\n📝 Adding document to "general" collection...');
  const docId1 = await service.addDocument(
    "This is a general knowledge document about AI agents.",
    { source: "test", category: "general" },
    "general"
  );
  console.log(`✅ Added doc ${docId1} to general`);

  // 2. Add document to "skills_user" collection
  console.log('\n📝 Adding document to "skills_user" collection...');
  const docId2 = await service.addDocument(
    "This is a user skill for coding in Python.",
    { source: "test", category: "skill" },
    "skills_user"
  );
  console.log(`✅ Added doc ${docId2} to skills_user`);

  // 3. Verify files exist
  const dbDir = config.knowledge_base.storage_path;
  const generalDbPath = path.join(dbDir, 'general.sqlite');
  const skillsDbPath = path.join(dbDir, 'skills_user.sqlite');

  console.log('\n📂 Verifying database files...');
  if (fs.existsSync(generalDbPath)) {
      console.log(`✅ Found general.sqlite at ${generalDbPath}`);
  } else {
      console.error(`❌ Missing general.sqlite at ${generalDbPath}`);
  }

  if (fs.existsSync(skillsDbPath)) {
      console.log(`✅ Found skills_user.sqlite at ${skillsDbPath}`);
  } else {
      console.error(`❌ Missing skills_user.sqlite at ${skillsDbPath}`);
  }

  // 4. Search in skills_user
  console.log('\n🔍 Searching in "skills_user" collection...');
  const results = await service.search("Python coding skill", 3, "skills_user");
  console.log(`Found ${results.length} results`);
  
  if (results.length > 0 && results[0].document.text.includes("Python")) {
      console.log('✅ Search successful and relevant');
      console.log(`Top result: ${results[0].document.text} (Score: ${results[0].score})`);
  } else {
      console.error('❌ Search failed or irrelevant');
      console.log(results);
  }

  // 5. Cleanup (optional, maybe keep for manual inspection)
  // await service.deleteDocument(docId1, "general");
  // await service.deleteDocument(docId2, "skills_user");
}

main().catch(console.error);
