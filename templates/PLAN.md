# batonflow Task Plan (`PLAN.md`)

> **Single source of truth** for the **currently active milestone** & cross-client checkpoint recovery.
> **Rule:** Only the **Planner** updates this file. Executors must never edit `PLAN.md`.
> **Tip:** Once all tasks are `[x]`, run `batonflow archive <short-name>` before starting the next milestone to keep `PLAN.md` compact (project Tech Stack and Verification Commands are preserved automatically).

---

## 1. Global Goal & Constraints

- **Objective**: <!-- Describe the end-to-end feature or milestone goal in 1–3 sentences -->
- **Tech Stack**: <!-- e.g. TypeScript, Node.js 22, PostgreSQL, Vitest -->
- **Repo Conventions**: Follow existing `AGENTS.md` / `CLAUDE.md` (if present).
- **Verification Commands**:
  - Test: `npm test`
  - Build / Typecheck: `npm run build`
  - Lint: `npm run lint`
- **Hard Constraints / Do Not Touch**:
  - <!-- Add milestone-specific constraints here -->

---

## 2. Task Board

Status legend: `[ ]` Pending · `[x]` Verified & Committed · `[!]` Interrupted / Blocked (see Recovery Log)

| ID | Status | Tier | Batch | Depends On | Task Description | Acceptance Criteria |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
<!-- Planner populates tasks for the active milestone here (e.g. T1, [ ], high, single, -, description, acceptance criteria) -->

---

## 3. Relay & Checkpoint Recovery Log

### Latest Handoff Context
*(Updated by Planner whenever work pauses `[!]` or switches to Planner self-takeover)*

- **State**: `IDLE` <!-- IDLE | ACTIVE | PAUSED_SHORT_LIMIT | PAUSED_WEEKLY_LIMIT | PLANNER_TAKEOVER | COMPLETED -->
- **Last Verified Commit**: `<none>`
- **Interrupted Task(s)**: `None`
- **Last Executor / Model**: `None`
- **Interruption Reason**: `None` <!-- e.g. exit=2 short_limit (5-hour window) / exit=3 weekly_limit -->
- **Reset / Resume Hint**: `None` <!-- e.g. "try again in 45 minutes" or "resets Monday" -->
- **Next Action for Resuming Planner**:
  > <!-- Concrete 1–2 line instruction so any new client/session can resume immediately -->

### Event History

| Timestamp (UTC) | Task | Tier | Executor / Model | Outcome | Commit / Notes |
| :--- | :--- | :---: | :--- | :--- | :--- |
<!-- Planner appends verified task & failover events here -->
