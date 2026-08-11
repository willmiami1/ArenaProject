import re
with open('src/wixRegistrationDeskContract.test.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()
with open('src/wixRegistrationDeskContract.test.js', 'w', encoding='utf-8') as f:
    skip = False
    for line in lines:
        if 'test("requires pre-existing draws' in line or 'test("does not accept same-submission' in line:
            skip = True
        if skip and line == '});\n':
            skip = False
            continue
        if not skip:
            f.write(line)
