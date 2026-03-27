# Phase 7: 优化readme内容 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 07-readme
**Areas discussed:** Content accuracy, Target audience & tone, Structure & sections, Visual assets

---

## Content Accuracy

| Option | Description | Selected |
|--------|-------------|----------|
| Update to match v2 | Describe actual behavior: exponential backoff with circuit breaker, max 20 retries, graceful shutdown | ✓ |
| Keep marketing-friendly | Keep 'resilient retry' messaging but add footnote | |
| You decide | Claude picks best approach | |

**User's choice:** Update to match v2
**Notes:** Full v2 accuracy — update all technical claims including internal class names

| Option | Description | Selected |
|--------|-------------|----------|
| Full v2 accuracy | Update all claims: iterative loop, ArtifactStore, StageExecutor, etc. | ✓ |
| High-level accuracy only | Fix factual errors but keep architecture general | |
| Minimal changes | Only fix outright lies | |

**User's choice:** Full v2 accuracy

| Option | Description | Selected |
|--------|-------------|----------|
| Sync both | Update README.md and README.en.md simultaneously | ✓ |
| Chinese first | Only update README.md this phase | |

**User's choice:** Sync both

| Option | Description | Selected |
|--------|-------------|----------|
| Keep dev-mode | Keep `npx tsx src/index.ts` commands | ✓ |
| Add npm package | Use `npx mosaicat run` | |
| Show both | npm primary, dev-mode as alternative | |

**User's choice:** Keep dev-mode

---

## Target Audience & Tone

| Option | Description | Selected |
|--------|-------------|----------|
| AI-savvy developers | Keep technical depth for LLM-familiar audience | ✓ |
| General developers | Simplify jargon | |
| Mixed audience | Layered approach | |

**User's choice:** AI-savvy developers

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the mix | Marketing + technical combination | |
| More technical | Drop marketing flourishes, proper technical docs | ✓ |
| More engaging | Keep hooks, make technical parts accessible | |

**User's choice:** More technical

---

## Structure & Sections

| Option | Description | Selected |
|--------|-------------|----------|
| Keep structure, update content | Same sections, new content | |
| Reorganize | Lead with demo, move comparison earlier, consolidate | ✓ |
| Simplify | Trim to essentials, move deep content to docs/ | |

**User's choice:** Reorganize

| Option | Description | Selected |
|--------|-------------|----------|
| Demo first | Banner → Demo → Quick Start → How It Works → Comparison → Config → Contributing | |
| Problem first | Banner → Problem → Solution → Quick Start → Usage → Architecture → Config → Contributing | |
| You decide | Claude picks best structure | ✓ |

**User's choice:** You decide

---

## Visual Assets

| Option | Description | Selected |
|--------|-------------|----------|
| Skip visuals | Remove TODO placeholders, text-only | |
| Add terminal screenshot | Real pipeline run output, no custom graphics | ✓ |
| Create assets | Banner + demo GIF | |

**User's choice:** Add terminal screenshot

---

## Claude's Discretion

- Exact section ordering for reorganized README
- Wording of v2 architecture changes
- Level of detail in pipeline diagram/agent table
- Terminal screenshot integration approach

## Deferred Ideas

- Custom banner/logo design — future
- npm package publishing — future milestone
- Documentation site — future milestone
