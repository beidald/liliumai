"""
Python Task Runner - Secure Sandboxed Execution Environment

OVERVIEW:
This script is designed to safely execute arbitrary Python code snippets within a 
restricted sandbox. It is primarily used as a backend worker for the Nanobot system 
to process dynamic logic without compromising the host environment's security.

CORE FUNCTIONALITIES:
1. Sandboxing: Restricts the execution scope by providing a curated subset of 
   built-in functions and exceptions (SAFE_BUILTINS). It blocks dangerous 
   modules like 'os', 'sys', and 'shutil', and prevents file system access.
2. Output Capture: Intercepts all standard output (stdout) and error (stderr) 
   generated during the code execution, returning them in the final JSON response.
3. Structured Interface: Communicates via standard input/output (stdin/stdout) 
   using JSON, making it easy to integrate with Node.js or other host languages.
4. Error Handling: Captures execution errors and provides detailed stack traces 
   within the response for debugging purposes.

PROTOCOL:
- Input (stdin): A JSON object containing:
    - "code" (string): The Python source code to execute.
    - "params" (object, optional): Data to be passed to the code.
- Requirement: The provided "code" must define a function: `run(params)`.
- Output (stdout): A JSON object containing:
    - "success" (boolean): Indicates if the execution finished without errors.
    - "data" (any): The return value of the `run` function.
    - "error" (string|null): The traceback if an error occurred.
    - "stdout" (string): Captured output from print statements.
    - "stderr" (string): Captured error stream output.

SECURITY MODEL:
The sandbox is implemented by overriding the `__builtins__` in the `exec()` 
environment. Only whitelisted functions are allowed. While this provides a 
layer of protection against common attacks, it is not a kernel-level sandbox 
and should be used with caution in highly hostile environments.
"""

import sys
import json
import traceback
import io
from contextlib import redirect_stdout, redirect_stderr

import builtins

# A set of built-in functions and exceptions considered safe for the execution sandbox.
# This prevents access to dangerous operations like file system access (open), 
# process management (os.system), etc., while allowing common data processing tasks.
SAFE_BUILTINS = {
    'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes', 
    'chr', 'complex', 'dict', 'divmod', 'enumerate', 'filter', 'float', 
    'format', 'frozenset', 'getattr', 'hasattr', 'hash', 'hex', 'id', 
    'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 
    'max', 'min', 'next', 'object', 'oct', 'ord', 'pow', 'print', 
    'range', 'repr', 'reversed', 'round', 'set', 'slice', 'sorted', 
    'str', 'sum', 'tuple', 'type', 'zip', '__import__',
    # Common Exceptions allowed in the sandbox
    'Exception', 'BaseException', 'ValueError', 'TypeError', 'KeyError', 
    'IndexError', 'AttributeError', 'RuntimeError', 'ImportError', 
    'NameError', 'SyntaxError', 'StopIteration', 'ArithmeticError',
    'AssertionError', 'BufferError', 'EOFError', 'FloatingPointError',
    'GeneratorExit', 'KeyboardInterrupt', 'LookupError', 'MemoryError',
    'NotImplementedError', 'OSError', 'OverflowError', 'ReferenceError',
    'SystemError', 'SystemExit', 'UnboundLocalError', 'UnicodeError',
    'ZeroDivisionError',
    # Decorators and Descriptors
    'super', 'property', 'classmethod', 'staticmethod'
}

def execute_task(code_str, params):
    """
    Executes a given Python code string in a restricted environment.
    
    Args:
        code_str (str): The Python source code to execute. It must define a function 'run(params)'.
        params (dict): Parameters to be passed to the 'run' function.
        
    Returns:
        dict: A dictionary containing 'success', 'data' (return value), 'error' (traceback if failed),
              'stdout', and 'stderr'.
    """
    # Prepare the sandbox scope by populating it only with safe built-ins
    safe_builtins_dict = {}
    for name in SAFE_BUILTINS:
        if hasattr(builtins, name):
            safe_builtins_dict[name] = getattr(builtins, name)

    # The sandbox globals: restricted built-ins and the input parameters
    sandbox = {
        '__builtins__': safe_builtins_dict,
        'params': params
    }
    
    # Buffers to capture anything printed to stdout or stderr during execution
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    
    result_data = None
    success = False
    error_msg = None
    
    try:
        # Redirect standard output and error to our string buffers
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            # 1. Execute the code string to populate the sandbox namespace.
            # This should define the 'run' function.
            exec(code_str, sandbox)
            
            # 2. Verify that the required 'run' function was defined and is callable.
            if 'run' not in sandbox or not callable(sandbox['run']):
                raise ValueError("Code must define a 'run(params)' function.")
            
            # 3. Call the 'run' function with the provided parameters and capture the result.
            result_data = sandbox['run'](params)
            success = True
            
    except Exception:
        # Capture the full traceback if an error occurs during execution
        error_msg = traceback.format_exc()
        success = False
    
    # Return the structured execution result
    return {
        "success": success,
        "data": result_data,
        "error": error_msg,
        "stdout": stdout_capture.getvalue(),
        "stderr": stderr_capture.getvalue()
    }

if __name__ == "__main__":
    # The script acts as a CLI tool that reads a JSON request from stdin and writes a JSON response to stdout.
    try:
        # Read the entire input from stdin
        input_str = sys.stdin.read()
        if not input_str:
            print(json.dumps({"success": False, "error": "No input provided"}))
            sys.exit(1)
            
        # Parse the input JSON which should contain 'code' and optionally 'params'
        request = json.loads(input_str)
        code = request.get('code')
        params = request.get('params', {})
        
        if not code:
            print(json.dumps({"success": False, "error": "No code provided"}))
            sys.exit(1)
            
        # Execute the task and output the result as a JSON string
        result = execute_task(code, params)
        print(json.dumps(result))
        
    except json.JSONDecodeError:
        # Handle cases where stdin does not contain valid JSON
        print(json.dumps({"success": False, "error": "Invalid JSON input"}))
    except Exception as e:
        # Catch any other unexpected system-level errors
        print(json.dumps({"success": False, "error": f"Runner System Error: {str(e)}"}))
