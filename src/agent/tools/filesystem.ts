import fs from 'fs-extra';
import path from 'path';
import { Tool } from './base';

export class ReadFileTool extends Tool {
  get name() { return 'read_file'; }
  get description() { return 'Read content from a file'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
      },
      required: ['path'],
    };
  }

  constructor(private allowedDir?: string) {
    super();
  }

  async execute(params: { path: string }): Promise<string> {
    const fullPath = this.allowedDir ? path.resolve(this.allowedDir, params.path) : path.resolve(params.path);
    if (this.allowedDir && !fullPath.startsWith(path.resolve(this.allowedDir))) {
      return 'Error: Access denied (outside of workspace)';
    }

    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch (err) {
      return `Error reading file: ${err}`;
    }
  }
}

export class WriteFileTool extends Tool {
  get name() { return 'write_file'; }
  get description() { return 'Write content to a file. If path is relative, it resolves relative to workspace.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    };
  }

  constructor(private allowedDir?: string, private protectedPaths: string[] = []) {
    super();
  }

  async execute(params: { path: string, content: string }): Promise<string> {
    // If allowedDir is set, resolve relative to it. 
    // If not set, resolve relative to process.cwd() (original behavior), 
    // BUT we want to default to workspace if possible.
    // However, without changing the constructor signature, we assume allowedDir IS the workspace when restriction is on.
    
    // FIX: Always treat relative paths as relative to allowedDir if it exists
    let fullPath: string;
    if (this.allowedDir) {
      fullPath = path.resolve(this.allowedDir, params.path);
      if (!fullPath.startsWith(path.resolve(this.allowedDir))) {
        return 'Error: Access denied (outside of workspace)';
      }
    } else {
      fullPath = path.resolve(params.path);
    }

    // Check protected paths
    if (this.protectedPaths.length > 0) {
      const normalizedPath = path.normalize(fullPath);
      for (const protectedPath of this.protectedPaths) {
        // Resolve protected path relative to allowedDir if allowedDir exists and protectedPath is relative
        const resolvedProtected = (this.allowedDir && !path.isAbsolute(protectedPath))
          ? path.resolve(this.allowedDir, protectedPath)
          : path.resolve(protectedPath);
          
        if (normalizedPath === path.normalize(resolvedProtected)) {
           return `Error: Access denied. The file "${protectedPath}" is a protected system file and cannot be modified.`;
        }
      }
    }

    try {
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, params.content, 'utf-8');
      return `Successfully wrote to ${params.path}`;
    } catch (err) {
      return `Error writing file: ${err}`;
    }
  }
}

export class ListDirTool extends Tool {
  get name() { return 'list_dir'; }
  get description() { return 'List files in a directory'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory' },
      },
      required: ['path'],
    };
  }

  constructor(private allowedDir?: string) {
    super();
  }

  async execute(params: { path: string }): Promise<string> {
    const fullPath = this.allowedDir ? path.resolve(this.allowedDir, params.path) : path.resolve(params.path);
    if (this.allowedDir && !fullPath.startsWith(path.resolve(this.allowedDir))) {
      return 'Error: Access denied (outside of workspace)';
    }

    try {
      const files = await fs.readdir(fullPath);
      return files.join('\n');
    } catch (err) {
      return `Error listing directory: ${err}`;
    }
  }
}

export class EditFileTool extends Tool {
  get name() { return 'edit_file'; }
  get description() { return 'Edit a file by replacing old_text with new_text. The old_text must exist exactly in the file.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        old_text: { type: 'string', description: 'The exact text to find and replace' },
        new_text: { type: 'string', description: 'The text to replace with' },
      },
      required: ['path', 'old_text', 'new_text'],
    };
  }

  constructor(private allowedDir?: string, private protectedPaths: string[] = []) {
    super();
  }

  async execute(params: { path: string, old_text: string, new_text: string }): Promise<string> {
    const fullPath = this.allowedDir ? path.resolve(this.allowedDir, params.path) : path.resolve(params.path);
    if (this.allowedDir && !fullPath.startsWith(path.resolve(this.allowedDir))) {
      return 'Error: Access denied (outside of workspace)';
    }

    // Check protected paths
    if (this.protectedPaths.length > 0) {
      const normalizedPath = path.normalize(fullPath);
      for (const protectedPath of this.protectedPaths) {
        // Resolve protected path relative to allowedDir if allowedDir exists and protectedPath is relative
        const resolvedProtected = (this.allowedDir && !path.isAbsolute(protectedPath))
          ? path.resolve(this.allowedDir, protectedPath)
          : path.resolve(protectedPath);
          
        if (normalizedPath === path.normalize(resolvedProtected)) {
           return `Error: Access denied. The file "${protectedPath}" is a protected system file and cannot be modified.`;
        }
      }
    }

    try {
      if (!(await fs.pathExists(fullPath))) {
        return `Error: File not found: ${params.path}`;
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      if (!content.includes(params.old_text)) {
        return 'Error: old_text not found in file. Make sure it matches exactly.';
      }

      // Check for uniqueness
      const occurrences = content.split(params.old_text).length - 1;
      if (occurrences > 1) {
        return `Warning: old_text appears ${occurrences} times. Please provide more context to make it unique.`;
      }

      const newContent = content.replace(params.old_text, params.new_text);
      await fs.writeFile(fullPath, newContent, 'utf-8');
      return `Successfully edited ${params.path}`;
    } catch (err) {
      return `Error editing file: ${err}`;
    }
  }
}
