---
name: web-app-architecture
description: Web app architecture patterns and dynamic constitution generation guide
scope: shared
agents: [tech_lead]
trigger: always
---

## Constitution Generation Guide
Dynamic constitution MUST include:
1. Tech stack declaration (framework + version + key deps)
2. File structure convention (directory meanings, naming rules)
3. Naming conventions (components PascalCase, hooks useCamelCase, API snake_case)
4. Verification commands (tsc, build, test — exact commands)
5. At least 3 NEVER rules (project-level prohibitions)

## Module Split Rules
- Split by feature, not by technical layer
- Each module: max 8 files
- Shared types and utils go in shared/ module (priority 0)
- Page-level modules contain: page + components + hooks + services
