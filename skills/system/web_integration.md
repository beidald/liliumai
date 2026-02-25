# Web Integration Protocol

## Overview
The Web Channel (`src/channels/web.ts`) provides a browser-based interface for the Nanobot system. It combines a REST API for system management with a WebSocket (Socket.IO) connection for real-time chat and event streaming.

## 1. Communication Architecture

### 1.1 Dual-Channel Design
- **WebSocket (Socket.IO)**: Used for real-time, bi-directional communication (User <-> Agent). Handles message streaming and instant updates.
- **REST API**: Used for external system integration, management commands, and message injection from detached processes.

### 1.2 Session Management & Persistence
**CRITICAL**: The Web Channel ensures data consistency between the real-time view and historical storage.
- **Session IDs**: 
  - Frontend format: `sess_<id>:thread_<threadId>` (e.g., `sess_djk7edwti:thread_1771287484647`)
  - Backend storage: `web:sess_<id>:thread_<threadId>`
- **Persistence Logic**: 
  - All outbound messages sent via `WebChannel.send()` (except stream chunks) are **automatically persisted** to the `SessionManager`.
  - This ensures that messages remain visible after page refreshes or session switching.
  - **Note**: Persistence only occurs if the message is successfully delivered to an active client (or at least attempted).

## 2. Tool Usage & Best Practices

### 2.1 Internal "Message" Tool (Agent Native)
**MANDATORY**: You MUST prioritize using the internal `message` tool for sending messages to the Web UI.
- **Usage**: Call `message` tool with `channel: "web"` and the correct `chat_id`.
- **Scenario**: Direct responses, notifications, or proactive alerts from the Agent.
- **Example**:
  ```json
  {
    "tool": "message",
    "args": {
      "channel": "web",
      "chat_id": "sess_djk7edwti:thread_1771287484647",
      "content": "Operation completed successfully."
    }
  }
  ```

### 2.2 External Script (API)
**WARNING**: Only use this method if the internal `message` tool cannot be used (e.g., for detached background processes).
- **Endpoint**: `POST /api/messages`
- **Auth**: Basic Auth (Admin credentials) or Bearer Token.
- **Payload**:
  ```json
  {
    "content": "Message content",
    "chat_id": "sess_..." // Target session ID
  }
  ```

## 3. Testing & Verification

### 3.1 Verifying Internal Functions (Agent -> Web)
To verify that the Agent can send messages to the Web UI using its internal tools:
1. **Inject a Task**: Create a scheduled task that forces the Agent to use the `message` tool.
2. **Task Configuration**:
   - `origin_channel`: "web"
   - `origin_chat_id`: <Target Session ID>
   - `content`: "Send a test message to the user"
3. **Observation**: The Agent will pick up the task, execute the `message` tool, and the text should appear in the Web UI **and persist after refresh**.

### 3.2 Verifying API Delivery
To verify the API channel:
1. Send a POST request to `/api/messages`.
2. Ensure `Authorization` header is set.
3. Check Web UI for immediate appearance.
4. Refresh Web UI to confirm persistence.

## 4. Troubleshooting

### 4.1 "Message undeliverable" Error
- **Cause**: No active WebSocket client is connected to the target session ID.
- **Solution**: Open the Web UI in a browser and ensure the correct session is selected.

### 4.2 Messages disappear after refresh
- **Cause**: `WebChannel.send` failed to call `SessionManager.save()`.
- **Fix**: Ensure the `WebChannel` implementation includes the persistence logic block (fixed in `v1.1`).

### 4.3 API returns 401 Unauthorized
- **Cause**: Missing or incorrect `Authorization` header.
- **Solution**: Use `Basic <base64(email:password)>` matching `config.json`.

## 5. File Serving & Downloads

### 5.1 Workspace File Access
The Web Channel automatically serves files located in the `workspace/` directory via the `/workspace` endpoint. This allows the Agent to generate files (reports, images, code) and provide direct download links to the user in the Web UI.

- **Source Directory**: `workspace/` (relative to project root)
- **Web Endpoint**: `/workspace/`
- **Base URL**: Defaults to `http://localhost:3000` (adjust based on deployment)

### 5.2 MANDATORY Path-to-URL Conversion
**CRITICAL RULE**: The Agent must **NEVER** expose the absolute local file path (e.g., `/Users/mac/.../workspace/file.txt`) to the user in the Web UI. It must **ALWAYS** convert it to a clickable HTTP URL.

**Conversion Logic**:
1.  **Input**: Absolute path from tool output (e.g., `/Users/mac/.../workspace/report.pdf`)
2.  **Process**:
    - Identify the `workspace/` segment.
    - Extract the relative path after `workspace/` (e.g., `report.pdf`).
    - Prepend the Base URL and `/workspace/`.
3.  **Output**: `http://localhost:3000/workspace/report.pdf`

**Incorrect (Do Not Use)**:
> "I have saved the file to `/Users/mac/Documents/project/workspace/image.png`"

**Correct**:
> "I have saved the file. Click here to view: [image.png](http://localhost:3000/workspace/image.png)"

### 5.3 Workflow: Generating & Serving Files
To provide a file to the user:

1.  **Generate Content**: Create the content (text, code, image, etc.).
2.  **Save File**: Use the `write_file` tool to save the file to the `workspace/` directory.
    - **Path**: Must be inside `workspace/`.
    - **Example**: `workspace/analysis_report.md`
3.  **Construct URL**:
    - Determine the base URL (default: `http://localhost:3000`, or from config).
    - Append `/workspace/` and the filename.
4.  **Send Link**: Use the `message` tool to send the URL to the user, ideally with a descriptive text or Markdown link.

### 5.4 Example Interaction
**User**: "Generate a summary of the logs and let me download it."

**Agent Action**:
1.  Reads logs.
2.  Writes summary to `workspace/log_summary.txt`.
3.  Sends message:
    ```
    I have generated the log summary. You can download it here:
    [Download Log Summary](http://localhost:3000/workspace/log_summary.txt)
    ```

### 5.5 Security Note
- **Public Access**: Files in `workspace/` are accessible to anyone with the URL if the Web Channel is exposed.
- **Sensitive Data**: Do not save sensitive credentials or private keys to `workspace/` unless necessary for the user's task.
