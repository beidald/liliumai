# Error Handling & Debugging Protocol

## Overview
This protocol defines the standard operating procedure for handling errors, debugging issues, and ensuring system stability. It transforms "error encounters" from roadblocks into structured problem-solving opportunities.

## Core Principles
1.  **Analyze Before Fixing**: Never blindly apply a fix. First, read the error message, identify the root cause (e.g., syntax, logic, permission, network), and formulate a hypothesis.
2.  **Isolate the Variable**: When debugging, change one thing at a time. If you change multiple factors, you won't know which one solved (or caused) the problem.
3.  **Log for Context**: Use `logger.error` or `logger.warn` to record significant failures. This helps the AI (you) in future turns to see what went wrong via the Log Injection mechanism.
4.  **Fail Gracefully**: If a critical component fails, ensure the system doesn't crash entirely. Use `try-catch` blocks around risky operations (file I/O, network requests, external command execution).

## Debugging Strategy
1.  **Read the Logs**: Check the console output or log files first.
    *   *Action*: Use `grep` or `read_file` to inspect logs around the timestamp of the error.
2.  **Reproduce**: Create a minimal reproduction script or test case to confirm the issue exists in isolation.
    *   *Action*: Create a `reproduce_issue.ts` file and run it.
3.  **Trace**: Add temporary logging (`console.log` or `logger.info`) to trace the execution flow and variable states leading up to the error.
4.  **Verify Fix**: After applying a fix, run the reproduction script again to confirm the error is gone.

## Common Error Patterns & Solutions
1.  **Module Not Found (`Cannot find module...`)**
    *   *Cause*: Missing dependency or incorrect path.
    *   *Fix*: Run `npm install <package>` or fix the import path (use relative paths `./` for local files).
2.  **Syntax Error (`Unexpected token...`)**
    *   *Cause*: Typo or version mismatch (e.g., using new JS features in old Node environment).
    *   *Fix*: Check line number, validate syntax, or update build config.
3.  **Timeout / Network Error**
    *   *Cause*: External service down or slow.
    *   *Fix*: Implement retry logic (exponential backoff) or increase timeout limits.
4.  **Permission Denied (`EACCES`)**
    *   *Cause*: File system restrictions.
32→    *   *Fix*: Check file permissions (`ls -l`) or change target directory.
33→5.  **Communication/Channel Errors**
34→    *   *Context*: Sending messages via `message` tool (Web, WeChat, etc.).
35→    *   *Cause*: `No client connected` (Web) or `Channel not ready` (WeChat).
36→    *   *Fix*: Catch the error and update the task status (`tasks.update(status='failed', error_log=...)`). Do not assume success.
37→
38→## Self-Correction Loop
If your attempted fix fails:
1.  **Stop**: Do not try the same fix again.
2.  **Re-evaluate**: Did you misinterpret the error message?
3.  **Search**: Use `SearchCodebase` to see how similar features are implemented elsewhere in the project.
4.  **External Knowledge**: Use `WebSearch` to find community solutions for the specific error message.

## Reporting
When reporting an error to the user (if unfixable):
1.  State the **Action** you were trying to perform.
2.  Quote the specific **Error Message**.
3.  Explain the **Impact** (what can't be done).
4.  Propose **Next Steps** or ask for specific intervention (e.g., "Please provide a valid API key").
