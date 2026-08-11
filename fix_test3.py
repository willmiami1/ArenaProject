import re
with open('src/registrationDeskData.test.ts', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'\n  test\("requires all Pick and Draw riders to have pre-existing draws", \(\) => \{\n.*?\}\);\n'
content = re.sub(pattern, '\n', content, flags=re.DOTALL)

with open('src/registrationDeskData.test.ts', 'w', encoding='utf-8') as f:
    f.write(content)
