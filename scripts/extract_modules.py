#!/usr/bin/env python3
import re

def main():
    with open('app.js', 'r', encoding='utf-8-sig') as f:
        lines = f.readlines()

    # Remove BOM if present
    if lines and lines[0].startswith('\ufeff'):
        lines[0] = lines[0][1:]

    def get_lines(start_1idx, end_1idx):
        return ''.join(lines[start_1idx-1:end_1idx])

    # === js/app-router.js ===
    router = get_lines(5, 71) + '\n' + get_lines(1437, 1465)
    with open('js/app-router.js', 'w', encoding='utf-8') as f:
        f.write(router)

    # === js/app-contract-actions.js ===
    contract = get_lines(73, 78) + '\n' + get_lines(80, 105) + '\n' + get_lines(901, 999) + '\n' + get_lines(1001, 1161)
    with open('js/app-contract-actions.js', 'w', encoding='utf-8') as f:
        f.write(contract)

    # === js/app-events.js ===
    # handleGlobalClick is already named (lines 110-845)
    events = get_lines(110, 845)

    def convert_listener(block, event_name, handler_name, query_selector=None):
        # Replace first line: document.addEventListener("xxx", (event) => {
        # or document.querySelector("#yyy").addEventListener("xxx", (event) => {
        if query_selector:
            old_first = f'document.querySelector("{query_selector}").addEventListener("{event_name}", (event) => {{'
            new_first = f'function {handler_name}(event) {{'
        else:
            old_first = f'document.addEventListener("{event_name}", (event) => {{'
            new_first = f'function {handler_name}(event) {{'

        block = block.replace(old_first, new_first, 1)
        # Remove trailing }); and add registration
        block = block.rstrip()
        if block.endswith('});'):
            block = block[:-3] + '}'
        if query_selector:
            block += f'\ndocument.querySelector("{query_selector}").addEventListener("{event_name}", {handler_name});'
        else:
            block += f'\ndocument.addEventListener("{event_name}", {handler_name});'
        return block

    # dragstart: lines 847-858
    events += '\n' + convert_listener(get_lines(847, 858), 'dragstart', 'handleDragStart')
    # dragover: lines 860-871
    events += '\n' + convert_listener(get_lines(860, 871), 'dragover', 'handleDragOver')
    # dragleave: lines 873-878
    events += '\n' + convert_listener(get_lines(873, 878), 'dragleave', 'handleDragLeave')
    # drop: lines 880-899
    events += '\n' + convert_listener(get_lines(880, 899), 'drop', 'handleDrop')

    # upload-form submit: lines 1163-1229
    events += '\n' + convert_listener(get_lines(1163, 1229), 'submit', 'handleUploadFormSubmit', '#upload-form')
    # progress-form submit: lines 1231-1319
    events += '\n' + convert_listener(get_lines(1231, 1319), 'submit', 'handleProgressFormSubmit', '#progress-form')
    # add-clause-form submit: lines 1321-1358
    events += '\n' + convert_listener(get_lines(1321, 1358), 'submit', 'handleAddClauseFormSubmit', '#add-clause-form')

    # draft-form submit via document: lines 1360-1372
    draft_block = get_lines(1360, 1372)
    draft_block = draft_block.replace('document.addEventListener("submit", (event) => {', 'function handleDocumentSubmit(event) {', 1)
    draft_block = draft_block.rstrip()
    if draft_block.endswith('});'):
        draft_block = draft_block[:-3] + '}'
    draft_block += '\ndocument.addEventListener("submit", handleDocumentSubmit);'
    events += '\n' + draft_block

    # input filters: lines 1374-1435
    events += '\n' + convert_listener(get_lines(1374, 1435), 'input', 'handleDocumentInput')

    # dblclick: lines 1467-1503
    events += '\n' + convert_listener(get_lines(1467, 1503), 'dblclick', 'handleDocumentDblclick')

    # focusout: lines 1505-1513
    events += '\n' + convert_listener(get_lines(1505, 1513), 'focusout', 'handleDocumentFocusout')

    # change: lines 1515-1566
    events += '\n' + convert_listener(get_lines(1515, 1566), 'change', 'handleDocumentChange')

    # clause edit input: lines 1568-1621
    events += '\n' + convert_listener(get_lines(1568, 1621), 'input', 'handleClauseEditInput')

    # filterPlaybooks: lines 1623-1638 (already named)
    events += '\n' + get_lines(1623, 1638)

    with open('js/app-events.js', 'w', encoding='utf-8') as f:
        f.write(events)

    # === Rewrite app.js ===
    new_app = []
    # Lines 1-4 (variable declarations)
    new_app.extend(lines[0:4])
    new_app.append('const STALE_JOB_TIMEOUT_MS = 3 * 60 * 1000;\n')
    new_app.append('\n')
    # Event registrations
    new_app.append('document.addEventListener("click", handleGlobalClick);\n')
    new_app.append('document.addEventListener("dragstart", handleDragStart);\n')
    new_app.append('document.addEventListener("dragover", handleDragOver);\n')
    new_app.append('document.addEventListener("dragleave", handleDragLeave);\n')
    new_app.append('document.addEventListener("drop", handleDrop);\n')
    new_app.append('document.addEventListener("dblclick", handleDocumentDblclick);\n')
    new_app.append('document.addEventListener("focusout", handleDocumentFocusout);\n')
    new_app.append('document.addEventListener("change", handleDocumentChange);\n')
    new_app.append('document.addEventListener("input", handleDocumentInput);\n')
    new_app.append('document.addEventListener("submit", handleDocumentSubmit);\n')
    new_app.append('\n')
    new_app.append('document.querySelector("#upload-form").addEventListener("submit", handleUploadFormSubmit);\n')
    new_app.append('document.querySelector("#progress-form").addEventListener("submit", handleProgressFormSubmit);\n')
    new_app.append('document.querySelector("#add-clause-form").addEventListener("submit", handleAddClauseFormSubmit);\n')
    new_app.append('\n')
    # buildFocusedClauseAnalysisRequirements (lines 1640-1666)
    new_app.extend(lines[1639:1666])
    new_app.append('\n')
    # Initialization (lines 1668-1676)
    new_app.extend(lines[1667:1676])

    with open('app.js', 'w', encoding='utf-8') as f:
        f.writelines(new_app)

    print('Extraction complete!')
    print(f'app.js lines: {len(new_app)}')

if __name__ == '__main__':
    main()
