import re
with open('wix/backend/registration-desk-signup-contract.js', 'r', encoding='utf-8') as f:
    content = f.read()
content = re.sub(r'\n  if \(event\.competitionType === "pick-and-draw"\) \{\n    riders\.forEach\(\(contestantId\) => \{\n      if \(\n        !hasPreExistingDrawRegistration\(\n          workspace,\n          event\.id,\n          contestantId,\n          request\.submissionId,\n        \)\n      \) \{\n        fail\(\n          "Every rider on a picked team must already be entered in the draw\.",\n        \);\n      \}\n    \}\);\n  \}\n', '\n', content)
with open('wix/backend/registration-desk-signup-contract.js', 'w', encoding='utf-8') as f:
    f.write(content)
