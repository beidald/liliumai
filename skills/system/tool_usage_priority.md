# Tool Usage Priority Hierarchy

To ensure efficiency, safety, and reliability, the AI must follow this strict hierarchy when choosing how to execute tasks.

## 1. Internal Tools (Highest Priority)
**ALWAYS** check if a specialized internal tool exists for the task before doing anything else.

-   **Why**: Internal tools are pre-tested, optimized for the environment, safe, and return structured output that is easier for the AI to parse.
-   **Examples**:
    -   **Reading files**: Use `read_file` tool (NOT `cat`, `less`, or writing a script).
    -   **Searching code**: Use `search_codebase` tool (NOT `grep -r` or custom Python scripts).
    -   **Listing files**: Use `ls` tool (NOT `ls -R` command).
    -   **Editing files**: Use `search_replace` tool.

## 2. Operating System Commands (Medium Priority)
If NO internal tool is available for the specific task, use standard Operating System commands via the terminal (`run_command`).

-   **Why**: Standard utilities (`find`, `curl`, `zip`, `tar`, `ps`, `netstat`) are mature, highly optimized binaries that are faster and less error-prone than writing new code.
-   **When to use**:
    -   Tasks that internal tools don't cover (e.g., checking network ports, compressing files, managing processes).
    -   Simple file manipulations that `search_replace` doesn't cover (e.g., moving/renaming files via `mv`).
-   **Examples**:
    -   Check if a port is open: `lsof -i :3000` (Don't write a Node.js script to check ports).
    -   Find files by date: `find . -mtime -1` (Don't write a Python script to crawl directories).

## 3. Programming Code (Lowest Priority)
Only write and execute custom scripts (Python, Node.js, Shell scripts, etc.) if **absolutely necessary** and the task cannot be accomplished by the layers above.

-   **Why**: Writing code is the "most expensive" operation. It introduces risks (syntax errors, missing dependencies, runtime errors), consumes more context (reading the script back), and takes longer to execute.
-   **When to use**:
    -   Complex logic that cannot be expressed with a simple shell pipeline.
    -   Data transformation or processing requiring specific libraries (e.g., pandas for complex CSV analysis).
    -   Tasks explicitly requiring a specific programming language.
    -   Building the actual application features (obviously).

## Summary Decision Flow
1.  **Can I do this with an available Tool?**
    -   YES -> **Use Tool**.
    -   NO -> Go to step 2.
2.  **Can I do this with a standard one-line MacOS Shell Command?**
    -   YES -> **Run Command**.
    -   NO -> Go to step 3.
3.  **Write a Script/Program.**
