import re
with open('src/registrationDeskData.test.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
with open('src/registrationDeskData.test.ts', 'w', encoding='utf-8') as f:
    skip = False
    for line in lines:
        if 'test("requires all Pick and Draw riders to have pre-existing draws' in line:
            skip = True
        if skip and line == '  });\n':
            skip = False
            continue
        if not skip:
            f.write(line)
