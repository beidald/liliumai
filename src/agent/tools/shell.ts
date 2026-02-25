import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool } from './base';
import path from 'path';
import fs from 'fs-extra';
// 中文功能描述：shell工具类
const execAsync = promisify(exec);

export interface SecurityConfig {
  restrict_fs_write: boolean;
  restrict_shell_execution: boolean;
  allowed_read_only_commands: string[];
  dangerous_code_patterns: {
    python: string[];
    node: string[];
  };
  protected_paths?: string[];
}

// 中文功能描述：执行shell命令工具类
export class ExecTool extends Tool {
  get name() { return 'exec_shell'; }
  get description() { return 'Execute a shell command'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
      },
      required: ['command'],
    };
  }

  private securityConfig?: SecurityConfig;

  constructor(
    private workingDir?: string, 
    private timeout: number = 30000, 
    private restrictToWorkspace: boolean = true,
    securityConfig?: SecurityConfig
  ) {
    super();
    this.securityConfig = securityConfig;
  }

  async execute(params: { command: string }): Promise<string> {
    if (this.restrictToWorkspace) {
      // 1. Prevent directory traversal
      if (params.command.includes('..')) {
         return 'Error: Access denied (Directory traversal ".." not allowed in restricted mode)';
      }
      
      // 2. Check for absolute paths
      // Regex to find strings starting with / (e.g. /etc/passwd, but not inside command flags like -/ or https://)
      // We look for whitespace followed by / or start of string followed by /
      const absolutePaths = params.command.match(/(?:\s|^)(\/[^\s"']*)/g) || [];
      const workspacePath = this.workingDir ? path.resolve(this.workingDir) : '';
      
      const dangerousPaths = absolutePaths.map(p => p.trim()).filter(p => {
         // It's dangerous if it's NOT inside workspace
         // We use path.resolve to handle normalization
         return workspacePath && !path.resolve(p).startsWith(workspacePath);
      });

      if (dangerousPaths.length > 0) {
        // We have outside paths. Check if the command is a whitelist read-only command.
        // Commands that are safe to run on external files (Read-Only)
        const cmd = params.command.trim().split(' ')[0];
        
        // Use config whitelist if available, otherwise default
        const readOnlyCmds = this.securityConfig?.allowed_read_only_commands || 
          ['ls', 'cat', 'grep', 'head', 'tail', 'find', 'wc', 'du', 'stat', 'file', 'more', 'less', 'hexdump', 'strings', 'diff'];
        
        if (!readOnlyCmds.includes(cmd)) {
           return `Error: Access denied. Command '${cmd}' is not allowed to access external paths: ${dangerousPaths.join(', ')}. Only read-only commands (${readOnlyCmds.join(', ')}) can access external files.`;
        }
      }
      
      // 3. Block redirection to absolute paths
      if (/>\s*\/[^\s"']*/.test(params.command)) {
         // Check if that absolute path is in workspace
         const match = params.command.match(/>\s*(\/[^\s"']*)/);
         if (match && workspacePath && !path.resolve(match[1]).startsWith(workspacePath)) {
            return 'Error: Access denied. Redirection to external file is not allowed.';
         }
      }
      
      // 4. Code Content Security Scan (New Feature)
      if (this.securityConfig && this.securityConfig.dangerous_code_patterns) {
        // ... (existing code) ...
        // Check if command is running a script file (e.g., python script.py, node script.js)
        const scriptMatch = params.command.match(/(?:python3?|node|bash|sh)\s+([^\s"']+\.(py|js|ts|sh))/);
        
        if (scriptMatch) {
          const scriptFile = scriptMatch[1];
          const fullScriptPath = this.workingDir ? path.resolve(this.workingDir, scriptFile) : path.resolve(scriptFile);
          
          // Only scan if file exists and is within workspace (or accessible)
          if (await fs.pathExists(fullScriptPath)) {
             try {
               const content = await fs.readFile(fullScriptPath, 'utf-8');
               const patterns = this.securityConfig.dangerous_code_patterns;
               
               // Use 'any' to bypass strict type check for dynamic key access if needed, or cast
               const dangerousPatterns = (scriptFile.endsWith('.py') ? patterns.python : 
                                         (scriptFile.endsWith('.js') || scriptFile.endsWith('.ts') ? patterns.node : []));
                 
               if (dangerousPatterns && dangerousPatterns.length > 0) {
                 const found = dangerousPatterns.find(p => content.includes(p));
                 if (found) {
                   return `Error: Security Check Failed. The script '${scriptFile}' contains restricted code pattern: '${found}'. Execution blocked.`;
                 }
               }
             } catch (err) {
               // Ignore read errors, proceed with caution or log
             }
          }
        }
      }

      // 5. Protected Files Check
      if (this.securityConfig && this.securityConfig.protected_paths && this.securityConfig.protected_paths.length > 0) {
        const protectedFiles = this.securityConfig.protected_paths.map(p => path.basename(p));
        // Check if command mentions any protected file (exact word match)
        // We iterate to find if any protected file is mentioned in the command
        for (const file of protectedFiles) {
            // Escape dots for regex
            const escapedFile = file.replace(/\./g, '\\.');
            const regex = new RegExp(`\\b${escapedFile}\\b`);
            
            if (regex.test(params.command)) {
                const cmd = params.command.trim().split(' ')[0];
                const readOnlyCmds = this.securityConfig.allowed_read_only_commands || 
                  ['ls', 'cat', 'grep', 'head', 'tail', 'find', 'wc', 'du', 'stat', 'file', 'more', 'less', 'hexdump', 'strings', 'diff'];
                
                // Allow if command is read-only AND no output redirection to the file
                const isRedirecting = params.command.includes('>') && params.command.includes(file);
                
                if (!readOnlyCmds.includes(cmd) || isRedirecting) {
                     return `Error: Access denied. Command '${cmd}' may modify protected file '${file}'. Only read-only commands are allowed on protected files.`;
                }
            }
        }
      }

      // Basic check for dangerous commands that might escape workspace (legacy check)
      const dangerous = ['rm -rf /', 'mv /*', 'dd ', '> /dev/'];
      if (dangerous.some(d => params.command.includes(d))) {
        return 'Error: Dangerous command detected';
      }
    }

    return new Promise((resolve) => {
      // @ts-ignore
      if (typeof logger !== 'undefined') logger.info(`Executing shell: ${params.command}`);
      const childProcess = exec(params.command, {
        cwd: this.workingDir,
        timeout: this.timeout,
        env: { ...process.env, TERM: 'xterm-256color' },
      }, (error, stdout, stderr) => {
        let result = '';
        if (stdout) result += stdout;
        if (stderr) result += `\nStderr: ${stderr}`;
        if (error) {
          if (error.killed) {
            result += `\nError: Command timed out after ${this.timeout}ms`;
          } else {
            result += `\nError: ${error.message}`;
          }
        }
        resolve(result.trim() || 'Command executed with no output');
      });

      // Handle interactive input if needed (future improvement)
      // For now, we just close stdin to avoid hanging
      childProcess.stdin?.end();
    });
  }
}
