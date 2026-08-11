import re
with open('src/registrationDeskData.ts', 'r', encoding='utf-8') as f:
    content = f.read()
content = re.sub(r'\n    if \(event\.competitionType === "pick-and-draw"\) \{\n      for \(const contestantId of riders\) \{\n        const hasDraw = activeRegistrations\.some\(\n          \(registration\) =>\n            registration\.contestantId === contestantId &&\n            registration\.status === "entered" &&\n            Number\(registration\.entries\) > 0,\n        \);\n        if \(!hasDraw\) \{\n          fail\("Every rider on a picked team must already be entered in the draw\."\);\n        \}\n      \}\n    \}\n', '\n', content)
with open('src/registrationDeskData.ts', 'w', encoding='utf-8') as f:
    f.write(content)
