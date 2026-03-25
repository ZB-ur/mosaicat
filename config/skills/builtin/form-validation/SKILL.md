---
name: form-validation
description: Standard form validation pattern (avoid hand-written if/else causing fix loops)
scope: shared
agents: [coder]
trigger: code-plan 包含表单
---

## Rules
- Use zod schema for validation rules, never hand-write if/else chains
- Error messages defined in schema (z.string().min(1, "Required"))
- Use react-hook-form + zodResolver for integration
- Submit triggers full validation, input triggers per-field validation

## Source
Multiple pipeline runs observed: hand-written if/else validation causes 3+ fix rounds
