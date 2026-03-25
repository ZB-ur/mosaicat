---
name: ux-interaction-patterns
description: Standard UX interaction patterns for common UI elements
scope: shared
agents: [ux_designer]
trigger: always
---

## Standard Interaction Patterns
- Lists: swipe-to-delete / long-press multi-select / pull-to-refresh
- Forms: real-time validation + submit validation, error below field
- Navigation: mobile bottom tabs / desktop sidebar
- Loading: skeleton (lists) / spinner (buttons) / progress bar (uploads)
- Empty state: illustration + guide text + primary action button
- Error: toast (light) / inline (forms) / full-screen (fatal)

## Every Flow Must Cover
- Happy path (normal flow)
- Error state (what user sees on error)
- Empty state (no data)
- Loading state (data loading)
