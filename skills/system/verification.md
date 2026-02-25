# Code Verification & Testing Protocol

## Overview
This protocol mandates that no code change is considered "complete" until it has been verified. "It should work" is not acceptable; "I proved it works" is the standard.

## Verification Levels
Select the appropriate level based on the complexity of the change.

### Level 1: Static Analysis (Simple Config/Text Changes)
*   **Scope**: Typos, documentation, simple config values.
*   **Method**: Read the file back (`read_file`) to ensure the content matches expectation.
*   **Check**: JSON validity (for `.json` files), syntax correctness.

### Level 2: Runtime Verification (Logic Changes)
*   **Scope**: Bug fixes, new function logic, refactoring.
*   **Method**:
    1.  Create a temporary test script (e.g., `test_fix.ts`).
    2.  Import the modified module.
    3.  Call the function with test inputs.
    4.  Assert the output.
    5.  Run it: `npx ts-node test_fix.ts`.
    6.  **Cleanup**: Delete the test script after success.

### Level 3: Integration Verification (System Features)
*   **Scope**: New tools, API integrations, complex workflows (e.g., multi-step tasks).
*   **Method**:
    1.  Trigger the actual feature via the CLI or UI (if possible).
    2.  Or create an integration test that mocks external dependencies but exercises the full internal flow.
    3.  Check side effects: Were files created? Database updated? Logs written?

## Testing Standards
1.  **Isolation**: Test scripts should not depend on the global environment state if possible.
2.  **Clean Up**: Always clean up artifacts (files, processes) created during testing.
3.  **Edge Cases**: Don't just test the "happy path". Test:
    *   Null/Undefined inputs.
    *   Empty strings/arrays.
    *   Network failures (mocked if needed).

## Verification Failure Protocol
If verification fails:
1.  **Do NOT Revert Immediately**: Analyze the test failure output.
2.  **Debug**: Is the code wrong, or is the test wrong?
3.  **Iterate**: Fix the code and re-run the *same* test.
4.  **Success Criteria**: The task is only done when the verification passes.

## Example: Verifying a New Tool
If you added a `WeatherTool`:
1.  Create `verify_weather.ts`:
    ```typescript
    import { WeatherTool } from './src/agent/tools/weather';
    const tool = new WeatherTool();
    const result = await tool.execute({ city: 'Beijing' });
    console.log(result);
    if (!result.includes('Temperature')) throw new Error('Verification Failed');
    ```
2.  Run it.
3.  If output shows temperature, success.
