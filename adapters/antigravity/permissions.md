# Antigravity Terminal Permissions & Scheduling Guide

To let Antigravity act as an unattended **agent-baton Planner** without constant terminal approval prompts:

## 1. Recommended Terminal Command Allowlist
When Antigravity prompts to approve terminal commands, choose **"Always Allow"** (prefix-matched) for these safe workflow commands:

- `agent-baton`
- `git status`
- `git diff`
- `git log`
- `git add`
- `git commit`
- Your project's test / build / lint commands (e.g., `npm test`, `npm run build`, `pytest`, `go test`)

> **Tip:** Install globally with `npm install -g agent-baton` so Planner invocations stay short and prefix-matchable (`agent-baton --tier ...`).

## 2. Sandbox / Network Considerations
Executor CLIs (`codex`, `claude`, `gemini`) require outbound network access to their respective LLM APIs and read access to their CLI credentials (`~/.codex`, `~/.claude`, `~/.gemini`, etc.).
- Allow `agent-baton` to run with network/credential access in your Antigravity terminal settings so external Executors can authenticate cleanly.

## 3. Handling 5-Hour Rolling Limits (`short_limit`)
You have three options in `agent-baton.config.json` under `exhaustion_policy.short_limit`:
- **`"manual_pause"` (Recommended default in interactive chat)**: `agent-baton` exits `2` immediately; Antigravity saves `[!]` + `reset_hint` in `PLAN.md` and pauses until you reply "continue" (or schedule a wakeup with `/schedule`).
- **`"auto_wait"`**: `agent-baton` sleeps until the parsed reset time (or `poll_interval_seconds`) and retries automatically. Best used when running `agent-baton` in a background/detached terminal or long-running session.
- **`"planner_takeover"`**: Antigravity takes over remaining `PLAN.md` tasks immediately using its own native tools.
