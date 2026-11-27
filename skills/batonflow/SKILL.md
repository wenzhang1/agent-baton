---
name: batonflow
description: >-
  Orchestrate multi-CLI AI coding relay workflows using batonflow (Planner +
  Executor). Activate this skill when the user asks to plan, dispatch, execute,
  or resume tasks with batonflow or PLAN.md, or wants automatic failover across
  local AI CLIs (Codex, Claude Code, Gemini). Do NOT activate when running as an
  Executor ([BATONFLOW_EXECUTOR_MODE] or BATONFLOW_ROLE=executor).
---

# batonflow Planner Relay Skill

Use this workflow whenever acting as the **Planner & Verifier** for a repository managed with `batonflow`.

## Role Guard (Safe Coexistence with `AGENTS.md` / `CLAUDE.md`)
- If your prompt starts with `[BATONFLOW_EXECUTOR_MODE]` or `BATONFLOW_ROLE=executor` is set, **stop using this skill immediately**—edit repository files directly per the repo's coding conventions, do NOT invoke `batonflow`, and do NOT modify `PLAN.md`.

## Prerequisites
1. Check that `batonflow.config.json`, `.batonflow/WORKFLOW.md`, and `PLAN.md` exist in the repository root. If missing, run `batonflow init` first (or guide the user to run it).
2. Read `.batonflow/WORKFLOW.md` and `PLAN.md` in full before dispatching any work.
3. Run `git status`, `git log -n 5 --oneline`, and `batonflow --status` to confirm the latest verified checkpoint and active executor cooldowns.

## Execution Loop
1. **Archive Completed Plans & Plan New Milestone**:
   - `PLAN.md` tracks **one active milestone only**—never keep appending new milestones onto an old completed `PLAN.md`.
   - When the user asks to start a **new feature/milestone** and existing tasks in `PLAN.md` are all `[x]` (completed), run `batonflow archive <short-slug>` first to move the old plan to `.batonflow/archive/YYYY-MM-DD-<short-slug>.md` and reset `PLAN.md` (preserving Tech Stack, Verification Commands, and Hard Constraints). If unfinished `[ ]`/`[!]` tasks remain, ask the user before using `--force`.
   - Decompose the user's goal into tasks in `PLAN.md` (with `high`/`low` tiers, dependencies, and acceptance criteria) and confirm with the user before dispatching.
   - Dispatch high-risk / core logic tasks individually (`--tier high`); bundle 2–3 low-risk, tightly-coupled boilerplate tasks (`--tier low`).
2. **Dispatch to Executor**:
   - Run:
     ```bash
     batonflow --tier <high|low> [--effort low|medium|high|xhigh|max] --task "<self-contained task + acceptance criteria>"
     ```
   - Omit `--effort` to use `default_effort[tier]` from `batonflow.config.json` (`high` → `high`, `low` → `medium`); pass `--effort xhigh` or `--effort max` for deep debugging/architecture, or `--effort low` for trivial edits.
   - For long or multi-line prompts, write `.batonflow/current-task.md` and pass `--task-file .batonflow/current-task.md`.
3. **Verify & Commit Checkpoint (Exit `0`)**:
   - Audit `git status` and `git diff` (ensure scope is clean and `PLAN.md` was untouched by the Executor).
   - Run the verification commands (test / build / lint) declared in `PLAN.md`.
   - **Pass**: Mark completed task(s) `[x]` in `PLAN.md` and create an atomic `git commit`.
   - **Fail (or Exit `1`)**: Inspect the log file reported by `batonflow` and feed exact error output back to the Executor (**max 2 retries** per task).
4. **Rate-Limit Recovery & Exhaustion Policy (Exit `2` / `3`)**:
   - Never touch already-committed checkpoints; discard only unverified partial edits left by the interrupted task.
   - Obey the `next_action=` directive printed in `batonflow`'s final `RESULT` line:
     - `next_action=planner_takeover`: Record handover in `PLAN.md` and finish remaining tasks directly using your native file-editing tools.
     - `next_action=manual_pause`: Mark `[!]` in `PLAN.md` with `reset_hint` and latest handoff context, then pause and notify the user.
