"""
Python Task Validator - Static Analysis for Secure Code Execution

OVERVIEW:
This script performs static analysis on Python source code using the Abstract Syntax 
Tree (AST) module. It ensures that the provided code adheres to strict structural 
and security constraints before it is allowed to run in the execution sandbox.

SECURITY CHECKS:
1. Import Whitelisting: Only a specific set of standard library modules are allowed 
   (e.g., 'math', 'json', 'datetime'). Any attempt to import modules like 'os', 
   'sys', or 'subprocess' is blocked.
2. Structural Enforcement: The script must define a single top-level entry point 
   function: `run(params)`. No other top-level code or function definitions are 
   permitted.
3. Forbidden Calls: Blocks dangerous built-in functions like `exec`, `eval`, 
   `open`, and `__import__`.
4. Forbidden Attributes: Scans for dangerous attribute access (e.g., `system`, 
   `popen`) to prevent indirect execution of system commands.

PROTOCOL:
- Input (stdin): Raw Python source code as a string.
- Output (stdout): A JSON object containing:
    - "valid" (boolean): True if the code passes all security and structural checks.
    - "errors" (list): A list of strings describing the validation failures.
"""

import ast
import sys
import json

# Whitelist of standard library modules that are safe to import within the sandbox.
ALLOWED_IMPORTS = {'math', 'json', 'datetime', 're', 'random', 'collections', 'itertools', 'functools'}

# List of dangerous built-in functions that could be used to bypass security or access the host system.
FORBIDDEN_CALLS = {'eval', 'exec', 'compile', 'open', 'input', '__import__', 'globals', 'locals', 'super', 'help', 'exit', 'quit'}

# List of dangerous attributes often associated with process execution or system manipulation.
FORBIDDEN_ATTRS = {'system', 'popen', 'spawn', 'fork', 'kill'}

def validate_code(code_str):
    """
    Analyzes the provided Python code string for security risks and structural compliance.
    
    Args:
        code_str (str): The Python source code to validate.
        
    Returns:
        dict: A dictionary with 'valid' (bool) and 'errors' (list of strings).
    """
    errors = []
    
    try:
        # Parse the source code into an Abstract Syntax Tree (AST)
        tree = ast.parse(code_str)
    except SyntaxError as e:
        # Handle cases where the code is not syntactically valid Python
        return {"valid": False, "errors": [f"Syntax Error: {str(e)}"]}
    except Exception as e:
        # Catch any other unexpected parsing errors
        return {"valid": False, "errors": [f"Parse Error: {str(e)}"]}

    # 1. Structure Check: 
    # The top level of the script must strictly contain only imports and the 'run(params)' function.
    has_run_func = False
    
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            # Check if the imported module is in the whitelist
            for alias in node.names:
                module_name = alias.name.split('.')[0]
                if module_name not in ALLOWED_IMPORTS:
                    errors.append(f"Forbidden import: '{module_name}'. Allowed: {list(ALLOWED_IMPORTS)}")
        elif isinstance(node, ast.FunctionDef):
            # Ensure only the 'run' function is defined at the top level
            if node.name == 'run':
                has_run_func = True
                # Validate that 'run' accepts exactly one argument named 'params'
                args = [a.arg for a in node.args.args]
                if len(args) != 1 or args[0] != 'params':
                    errors.append("Function 'run' must accept exactly one argument named 'params'")
            else:
                errors.append(f"Forbidden top-level function: '{node.name}'. Only 'run(params)' is allowed.")
        else:
            # Block any other top-level statements (e.g., logic, variables, other declarations)
            # This ensures the code is purely a definition file.
            errors.append(f"Forbidden top-level statement type: {type(node).__name__}. Only imports and 'def run(params):' allowed.")

    # Check if the mandatory entry point is present
    if not has_run_func:
        errors.append("Missing required function: 'def run(params):'")

    # 2. Deep Scan for Dangerous Operations:
    # Recursively walk through every node in the AST to find forbidden calls or attribute access.
    for node in ast.walk(tree):
        # Check Function Calls (e.g., eval())
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in FORBIDDEN_CALLS:
                    errors.append(f"Forbidden function call: '{node.func.id}'")
            # Check Attribute Access within calls (e.g., os.system())
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr in FORBIDDEN_ATTRS:
                     errors.append(f"Forbidden attribute access: '{node.func.attr}'")

    # Return the validation result
    return {
        "valid": len(errors) == 0,
        "errors": errors
    }

if __name__ == "__main__":
    # The script acts as a CLI tool that reads raw Python code from stdin and outputs JSON to stdout.
    try:
        # Read the entire input code from stdin
        code_input = sys.stdin.read()
        if not code_input.strip():
             print(json.dumps({"valid": False, "errors": ["Empty code input"]}))
             sys.exit(0)
             
        # Perform validation
        result = validate_code(code_input)
        # Output the result as a JSON string
        print(json.dumps(result))
    except Exception as e:
        # Catch and report any system-level errors during the validation process
        print(json.dumps({"valid": False, "errors": [f"Validator System Error: {str(e)}"]}))
