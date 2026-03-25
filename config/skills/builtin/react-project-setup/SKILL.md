---
name: react-project-setup
description: React + TypeScript + Vite project standard setup pattern
scope: shared
agents: [coder]
trigger: tech-spec 包含 React
---

## Project Structure
```
src/
  components/    # By feature subdirectory, not by type
  pages/         # Page-level components, 1:1 with routes
  hooks/         # Custom hooks
  services/      # API call layer — components never fetch directly
  types/         # Shared type definitions
  lib/           # Utility functions
```

## Key Rules
- App.tsx declares all routes centrally — components do not self-register
- Each page component exports default, routes use lazy() loading
- services/ has one function per API endpoint with explicit return types
- All component props must have TypeScript interface, defined at top of same file
- Use index.ts barrel exports sparingly — only for public module APIs
