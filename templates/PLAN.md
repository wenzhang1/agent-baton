# batonflow Task Plan (`PLAN.md`)

> **Single source of truth** for Planner & cross-client checkpoint recovery.
> **Rule:** Only the **Planner** updates this file. Executors must never edit `PLAN.md`.

---

## 1. Global Goal & Constraints

- **Objective**: <!-- Describe the end-to-end feature or milestone goal in 1–3 sentences -->
- **Tech Stack**: <!-- e.g. TypeScript, Node.js 20, PostgreSQL, Vitest -->
- **Repo Conventions**: Follow existing `AGENTS.md` / `CLAUDE.md` (if present).
- **Verification Commands**:
  - Test: `npm test`
  - Build / Typecheck: `npm run build`
  - Lint: `npm run lint`
- **Hard Constraints / Do Not Touch**:
  - <!-- e.g. Do not modify production migration files already applied -->
  - <!-- e.g. Keep public REST API backwards compatible -->

---

## 2. Task Board

Status legend: `[ ]` Pending · `[x]` Verified & Committed · `[!]` Interrupted / Blocked (see Recovery Log)

| ID | Status | Tier | Batch | Depends On | Task Description | Acceptance Criteria |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `T1` | `[ ]` | `high` | single | `-` | Design and implement core data model & interfaces | Types compile cleanly; unit tests pass |
| `T2` | `[ ]` | `high` | single | `T1` | Implement core business logic & error handling | Edge-case tests pass; `git diff` clean |
| `T3` | `[ ]` | `low` | B1 | `T2` | Add CLI/API wrapper endpoints & input validation | Endpoint integration tests pass |
| `T4` | `[ ]` | `low` | B1 | `T2` | Add unit tests & fixtures for edge cases | Coverage & full test suite pass |
| `T5` | `[ ]` | `low` | single | `T3, T4` | Update documentation & usage examples | Docs match implementation; build passes |

---

## 3. Relay & Checkpoint Recovery Log

### Latest Handoff Context
*(Updated by Planner whenever work pauses `[!]` or switches to Planner self-takeover)*

- **State**: `ACTIVE` <!-- ACTIVE | PAUSED_SHORT_LIMIT | PAUSED_WEEKLY_LIMIT | PLANNER_TAKEOVER | COMPLETED -->
- **Last Verified Commit**: `<git commit hash & message>`
- **Interrupted Task(s)**: `None`
- **Last Executor / Model**: `None`
- **Interruption Reason**: `None` <!-- e.g. exit=2 short_limit (5-hour window) / exit=3 weekly_limit -->
- **Reset / Resume Hint**: `None` <!-- e.g. "try again in 45 minutes" or "resets Monday" -->
- **Next Action for Resuming Planner**:
  > <!-- Concrete 1–2 line instruction so any new client/session can resume immediately -->

### Event History

| Timestamp (UTC) | Task | Tier | Executor / Model | Outcome | Commit / Notes |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `YYYY-MM-DD HH:MM` | `T1` | `high` | `codex (gpt-6.2-astra / high)` | `example` | Replace with real entries as tasks complete |
