# Task Management Protocol

## Overview
The Task Management System (via `tasks` tool) is a robust, SQLite-backed engine for managing workflows, scheduling recurring jobs, and executing safe Python code. It supports persistent storage, cron-based scheduling, and sandboxed code execution with strict validation.

## Core Capabilities
1.  **Persistent Storage**: Tasks are stored in SQLite, surviving system restarts.
2.  **Python Execution**: Execute AI-generated Python code in a secure sandbox.
3.  **Scheduling**: Native Cron support for recurring tasks.
4.  **Concurrency**: Event-driven immediate execution + Polling fallback.

## Task Types & Usage
The system supports three distinct task types, each serving a specific purpose:

### 1. `prompt` (AI Instruction)
*   **Purpose**: Instruct the AI to perform a complex action at a scheduled time.
*   **Behavior**: When triggered, the `content` is injected into the Agent's context as a new user message. The Agent will then execute the instruction (e.g., search web, analyze data, write code) just as if you had typed it.
*   **Use Cases**:
    *   "Search for the latest AI news every morning at 9 AM."
    *   "Generate a weekly report summary every Friday."
    *   "Check server logs and alert me if there are errors."
*   **Example**:
    ```javascript
    // Search news daily at 9:00 AM
    tasks.execute({
      action: 'add',
      type: 'prompt',
      content: 'Search for "DeepSeek updates" and summarize the key points.',
      schedule: '0 9 * * *'
    })
    ```

### 2. `reminder` (User Notification)
*   **Purpose**: Send a simple text notification to the user.
*   **Behavior**: When triggered, the system sends the `content` directly to the user as a message. The Agent **does not** process or "think" about this text; it is strictly a passive notification.
*   **Use Cases**:
    *   "Remind me to drink water every 2 hours."
    *   "Send the daily standup meeting link."
    *   "Alert: Submit timesheet."
*   **Example**:
    ```javascript
    // Remind to drink water every 2 hours
    tasks.execute({
      action: 'add',
      type: 'reminder',
      content: '💧 Time to hydrate! Drink a glass of water.',
      schedule: '0 */2 * * *'
    })
    ```

### 3. `code` (Python Script)
*   **Purpose**: Execute sandboxed Python code for calculation, data processing, or logic.
*   **Behavior**: Runs the provided Python script in a secure environment. The script must define a `run(params)` function and return a JSON-serializable dictionary.
*   **Use Cases**:
    *   Mathematical calculations.
    *   Data formatting/transformation.
    *   Complex logic that is hard to describe in natural language.
*   **Example**:
    ```javascript
    // Calculate area
    tasks.execute({
      action: 'add',
      type: 'code',
      content: 'def run(params):\n    return {"area": 3.14 * params.get("r", 1)**2}',
      params: '{"r": 5}'
    })
    ```

## Tool Usage (`tasks`)

### Actions
- `add`: Create a new task.
- `list`: List pending tasks.
- `update`: Update task status or details.
- `delete`: Remove a task.
- `clear_completed`: Remove all completed/cancelled tasks.
- `get_history`: Retrieve the execution history (output, status, duration) for a specific task. Requires `id`.

### Parameters
- `action` (required): One of the actions above.
- `type`: `prompt` (AI executes), `reminder` (Notify only), or `code` (Python script). Default: `prompt`.
- `content` (required for add):
    - For `prompt`: The instruction for the AI.
    - For `reminder`: The notification message.
    - For `code`: The Python source code.
- `params`: JSON string of runtime parameters (for `code` tasks).
- `schedule`: Cron expression (e.g., `* * * * *` for every minute).
- `priority`: `low`, `medium`, `high`. Higher priority tasks are executed first.
- `id`: Target task ID (for update/delete/get_history).
- `status`: `pending`, `in_progress`, `completed`, `cancelled`, `failed`.

## Python Task Guidelines

### Structure
All `code` type tasks MUST follow this strict template:
```python
import json
# ... other allowed imports

def run(params):
    # Your logic here
    # Access params via params['key']
    return {"result": "success"}
```

```
### Validation Rules
1.  **Entry Point**: Must define a `run(params)` function.
2.  **Imports**: Only whitelisted modules are allowed:
    - `json`, `math`, `re`, `datetime`, `random`, `itertools`, `functools`, `collections`
3.  **Prohibited**:
    - System access: `os`, `sys`, `subprocess`
    - File I/O: `open`, `read`, `write` (use `params` for input/output)
    - Dangerous builtins: `exec`, `eval`, `__import__`

### Automatic Parameters
The system automatically injects a `system_info` dictionary into the `params` object, which you can use in your code. It contains:
- `uptime`: System uptime in seconds
- `loadavg`: Load averages [1min, 5min, 15min]
- `totalmem`: Total memory in bytes
- `freemem`: Free memory in bytes
- `platform`: OS platform (e.g., 'linux', 'darwin')
- `release`: OS release version
- `hostname`: Machine hostname

Example usage:
```python
def run(params):
    info = params.get('system_info', {})
    mem_usage = (info.get('totalmem', 0) - info.get('freemem', 0)) / 1024 / 1024
    return {"memory_used_mb": mem_usage}
```
```

### Example: Creating a Python Task
```javascript
tasks.execute({
  action: 'add',
  type: 'code',
  content: `
import math

def run(params):
    radius = params.get('radius', 1)
    area = math.pi * radius ** 2
    return {"area": area}
`,
  params: '{"radius": 5}'
})
```

## Scheduling
Use standard Cron expressions for the `schedule` field.
- `* * * * *`: Every minute
- `0 9 * * *`: Daily at 9 AM
- `0 */2 * * *`: Every 2 hours

Scheduled tasks are automatically picked up by the `TaskPoller`. When a scheduled task executes, it:
1.  Runs the code/prompt.
2.  Updates `next_run` based on the cron schedule.
3.  Resets status to `pending` for the next cycle.

## Best Practices
1.  **Use `params`**: Don't hardcode values in Python code; pass them via `params`.
2.  **Check Output**: Task execution history (including output and errors) is stored in the `task_history` table (internal).
3.  **Handle Retries**: One-off tasks have automatic retry logic for failures (up to `retry_limit`).
4.  **Keep it Simple**: Python scripts should be focused and stateless. Complex state should be managed via `params` or database.
5.  **Output Limits**: Task output is truncated if it exceeds 10KB. Avoid printing massive amounts of data; summarize or return key metrics instead.
