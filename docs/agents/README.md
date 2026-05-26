# Agent Documentation

This directory contains documentation written for AI agents (and human contributors) working on this codebase. The goal is to provide enough context to work effectively without reading every source file.

## Documents

| File | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, key decisions, and why things are the way they are |
| [CONVENTIONS.md](CONVENTIONS.md) | Code patterns, standards, and rules to follow when adding or changing code |
| [INTEGRATIONS.md](INTEGRATIONS.md) | WildApricot API, Amazon SES, and Discord — auth flows, quirks, and requirements |
| [GOTCHAS.md](GOTCHAS.md) | Real problems encountered during development and setup, with fixes |
| [ROADMAP.md](ROADMAP.md) | Planned features, known gaps, and deferred decisions |

## Suggested reading order

**For coding tasks:** ARCHITECTURE → CONVENTIONS → relevant section of INTEGRATIONS  
**For debugging:** GOTCHAS first, then INTEGRATIONS  
**For new features:** ROADMAP → ARCHITECTURE → CONVENTIONS
