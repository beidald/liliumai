
import { Tool } from './base';
import { KnowledgeBaseService } from '../../services/knowledge/service';
import logger from '../../utils/logger';
import { SkillLoader } from '../skills';
import fs from 'fs-extra';
import path from 'path';

export class KnowledgeAddTool extends Tool {
  get name(): string {
    return 'knowledge_add';
  }

  get description(): string {
    return 'Add a new document to the knowledge base. Use this to store important information that should be remembered for future reference.';
  }

  get parameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content to be stored in the knowledge base.',
        },
        collection: {
          type: 'string',
          description: 'Optional collection name to store the document in. Defaults to "general".',
        },
        metadata: {
          type: 'object',
          description: 'Optional JSON metadata associated with the document (e.g., source, author, tags).',
        },
      },
      required: ['text'],
    };
  }

  async execute(params: Record<string, any>): Promise<string> {
    const service = KnowledgeBaseService.getInstance();
    if (!service || !service.isInitialized()) {
      return 'Knowledge Base Service is not enabled or initialized.';
    }

    try {
      const { text, collection, metadata } = params;
      const id = await service.addDocument(text, metadata || {}, collection);
      return `Successfully added document to knowledge base (ID: ${id}).`;
    } catch (error: any) {
      logger.error('Failed to add document to knowledge base:', error);
      return `Error adding document: ${error.message}`;
    }
  }
}

export class KnowledgeSearchTool extends Tool {
  private skillLoader?: SkillLoader;

  constructor(skillLoader?: SkillLoader) {
    super();
    this.skillLoader = skillLoader;
  }

  get name(): string {
    return 'knowledge_search';
  }

  get description(): string {
    return 'Search the knowledge base for relevant information. Use this to retrieve past conversation history, find specific skills, or access stored knowledge. You should use this tool when you need context that is not immediately available.';
  }

  get parameters(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query string. Describe what you are looking for.',
        },
        collection: {
          type: 'string',
          description: 'The collection to search in. Common collections: "history" (past chats), "skills_user" (user skills), "skills_ai" (AI skills), "general" (general knowledge). Defaults to "general".',
          enum: ['history', 'skills_user', 'skills_ai', 'general', 'skills_system']
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Defaults to 5.',
        },
      },
      required: ['query'],
    };
  }

  async execute(params: Record<string, any>): Promise<string> {
    const service = KnowledgeBaseService.getInstance();
    if (!service || !service.isInitialized()) {
      return 'Knowledge Base Service is not enabled or initialized.';
    }

    const { query, collection, limit } = params;
    const targetCollection = collection || 'general';

    try {
      const results = await service.search(query, limit || 5, targetCollection);
      
      if (results.length === 0) {
        // Fallback for skills collections if vector search returns nothing
        if (this.skillLoader && targetCollection.startsWith('skills_')) {
            logger.warn(`Knowledge Base search empty for "${query}" in "${targetCollection}". Attempting file fallback...`);
            return await this.fallbackFileSearch(query, targetCollection, limit || 5);
        }
        return `No relevant documents found in collection "${targetCollection}" for query: "${query}".`;
      }

      return results.map(r => `[Score: ${r.score.toFixed(2)}] (ID: ${r.document.id})\n${r.document.text}\n(Metadata: ${JSON.stringify(r.document.metadata)})`).join('\n\n---\n\n');
    } catch (error: any) {
      logger.error('Failed to search knowledge base:', error);
      
      // Fallback for skills collections on error (e.g. embedding service failure)
      if (this.skillLoader && targetCollection.startsWith('skills_')) {
         logger.warn(`Knowledge Base error for "${query}" in "${targetCollection}". Attempting file fallback...`);
         const fallbackResult = await this.fallbackFileSearch(query, targetCollection, limit || 5);
         return `[WARNING: Knowledge Base Search Failed. Showing fallback file search results]\nError: ${error.message}\n\n${fallbackResult}`;
      }

      return `Error searching knowledge base: ${error.message}`;
    }
  }

  private async fallbackFileSearch(query: string, collection: string, limit: number): Promise<string> {
    if (!this.skillLoader) return 'SkillLoader not available for fallback.';

    const allSkills = await this.skillLoader.listSkills();
    let targetSkills: any[] = [];

    if (collection === 'skills_user') {
        targetSkills = allSkills.filter(s => s.source === 'user');
    } else if (collection === 'skills_ai') {
        targetSkills = allSkills.filter(s => s.source === 'ai');
    } else if (collection === 'skills_system') {
        targetSkills = allSkills.filter(s => s.source === 'system');
    } else {
        // Generic fallback search across all skills
        targetSkills = allSkills;
    }

    const matches = [];
    const lowerQuery = query.toLowerCase();

    for (const skill of targetSkills) {
        // Simple relevance check: name or content match
        try {
            const content = await fs.readFile(skill.path, 'utf-8');
            if (skill.name.toLowerCase().includes(lowerQuery) || content.toLowerCase().includes(lowerQuery)) {
                matches.push({
                    name: skill.name,
                    path: skill.path,
                    content: content
                });
            }
        } catch (e) {
            // Ignore read errors
        }
    }

    if (matches.length === 0) {
        return `No skills found matching "${query}" in file system fallback.`;
    }

    // Limit results
    const limitedMatches = matches.slice(0, limit);

    return `## Fallback Search Results (File System)\n\n` + 
           limitedMatches.map(m => {
               const preview = m.content.substring(0, 300).replace(/\n/g, ' ');
               return `- **${m.name}**\n  Path: ${m.path}\n  Preview: ${preview}...`;
           }).join('\n\n');
  }
}
