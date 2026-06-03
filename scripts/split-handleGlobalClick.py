#!/usr/bin/env python3
"""Split handleGlobalClick in js/app-events.js into smaller handler functions."""

# Each group: (function_name, start_line, end_line, is_async)
# Lines are 1-indexed in js/app-events.js
GROUPS = [
    ("handleNavClick", 2, 19, False),
    ("handleModalClick", 21, 37, False),
    ("handleProgressClick", 39, 75, False),
    ("handleReviewClick", 77, 212, False),
    ("handleContractNavClick", 214, 239, False),
    ("handleWorkbenchClick", 241, 305, False),
    ("handleContractRiskClick", 307, 356, False),
    ("handleClauseRiskClick", 358, 398, True),
    ("handleClauseActionClick", 400, 487, True),
    ("handleExportClick", 489, 604, True),
    ("handleBackendClick", 606, 690, False),
    ("handleDraftClick", 692, 735, False),
]

def main():
    with open('js/app-events.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # handleGlobalClick starts at line 1, ends at line 736
    hgc_body = lines[0:736]  # lines 1-736 (0-indexed 0-735)
    after = lines[736:]  # line 737 onwards

    # Build new functions
    new_functions = []
    for name, start, end, is_async in GROUPS:
        block_lines = hgc_body[start-1:end]
        block = ''.join(block_lines)

        # Replace all 'return;' with 'return true;'
        # Use regex to match bare 'return;' not preceded by 'true' or 'false'
        import re
        block = re.sub(r'(?<![a-zA-Z0-9_])return\s*;', 'return true;', block)

        # Build function
        sig = f"async function {name}(event)" if is_async else f"function {name}(event)"
        func = f"{sig} {{\n{block}  return false;\n}}\n"
        new_functions.append(func)

    # Build new handleGlobalClick dispatcher
    dispatcher = "async function handleGlobalClick(event) {\n"
    for name, _, _, is_async in GROUPS:
        prefix = "await " if is_async else ""
        dispatcher += f"  if ({prefix}{name}(event)) return;\n"
    dispatcher += "}\n"

    # Combine everything
    output = dispatcher + "\n" + "\n".join(new_functions) + "\n" + "".join(after)

    with open('js/app-events.js', 'w', encoding='utf-8') as f:
        f.write(output)

    print(f"Split handleGlobalClick into {len(GROUPS)} functions.")
    print(f"New handleGlobalClick is {len(dispatcher.split(chr(10)))} lines.")

if __name__ == '__main__':
    main()
