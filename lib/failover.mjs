/**
 * Relay scheduler, layered rate-limit classifier (short/5-hour vs weekly/hard quota),
 * cooldown persistence (.codebaton/state.json), and 3-mode exhaustion policy engine
 * (planner_takeover | manual_pause | auto_wait).
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveCommand } from './config.mjs';
import { runExecutorCommand } from './runner.mjs';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_SHORT_LIMIT_EXHAUSTED = 2;
export const EXIT_WEEKLY_LIMIT_EXHAUSTED = 3;

/**
 * Extract a human-readable reset hint snippet and an estimated wait duration in seconds
 * from CLI error output (when present).
 *
 * Examples matched:
 *   - "try again in 45 minutes"
 *   - "resets in 2 hours 15 minutes"
 *   - "try again in 30 seconds"
 *   - "resets at 14:30" / "resets at 4pm" / "resets on Monday"
 *
 * @param {string} output
 * @returns {{ hint: string | null, delaySeconds: number | null }}
 */
export function parseResetHint(output) {
  if (!output) return { hint: null, delaySeconds: null };

  // 1. Relative compound duration: "2 hours 15 minutes", "1 hr 30 mins", "45 minutes", "10 seconds"
  const relMatch = output.match(
    /(?:resets?|try again|available|retry)\s+in\s+(?:(\d+)\s*(?:days?|d)\b)?[\s,]*(?:(\d+)\s*(?:hours?|hrs?|h)\b)?[\s,]*(?:(\d+)\s*(?:minutes?|mins?|m)\b)?[\s,]*(?:(\d+)\s*(?:seconds?|secs?|s)\b)?/i
  );
  if (relMatch && (relMatch[1] || relMatch[2] || relMatch[3] || relMatch[4])) {
    const days = Number(relMatch[1] || 0);
    const hours = Number(relMatch[2] || 0);
    const mins = Number(relMatch[3] || 0);
    const secs = Number(relMatch[4] || 0);
    const total = days * 86400 + hours * 3600 + mins * 60 + secs;
    if (total > 0) {
      return { hint: relMatch[0].trim(), delaySeconds: total };
    }
  }

  // 2. Clock time: "resets at 14:30" or "resets at 4pm" / "resets at 4:30 PM"
  const clockMatch = output.match(
    /(?:resets?|try again|available)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (clockMatch) {
    let hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2] || 0);
    const meridiem = clockMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const now = new Date();
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      const delaySeconds = Math.max(1, Math.round((target.getTime() - now.getTime()) / 1000));
      return { hint: clockMatch[0].trim(), delaySeconds };
    }
  }

  // 3. Weekday reset hint (no exact short delay computed): "resets on Monday"
  const dayMatch = output.match(
    /resets?\s+(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?[^\n.]*/i
  );
  if (dayMatch) {
    return { hint: dayMatch[0].trim(), delaySeconds: null };
  }

  return { hint: null, delaySeconds: null };
}

/**
 * Classify a non-zero executor failure into:
 *   - "weekly_limit": weekly / monthly / billing / hard quota exhaustion
 *   - "short_limit":  5-hour rolling window / 429 / RPM / TPM / generic rate limit
 *   - "normal_error": regular task/code/CLI error (should NOT failover)
 *
 * Weekly patterns are checked FIRST so explicit weekly messages are not swallowed
 * by generic "usage limit" patterns.
 *
 * @param {string} output
 * @param {{ weekly_limit_patterns: string[], rate_limit_patterns: string[] }} config
 */
export function classifyFailure(output, config) {
  const { hint: resetHint, delaySeconds } = parseResetHint(output);

  for (const pattern of config.weekly_limit_patterns) {
    if (new RegExp(pattern, 'i').test(output)) {
      return {
        kind: 'weekly_limit',
        matchedPattern: pattern,
        resetHint,
        delaySeconds,
      };
    }
  }

  for (const pattern of config.rate_limit_patterns) {
    if (new RegExp(pattern, 'i').test(output)) {
      return {
        kind: 'short_limit',
        matchedPattern: pattern,
        resetHint,
        delaySeconds,
      };
    }
  }

  return {
    kind: 'normal_error',
    matchedPattern: null,
    resetHint: null,
    delaySeconds: null,
  };
}

/**
 * Load persisted cooldown/relay state from .codebaton/state.json.
 * @param {string} stateFilePath
 */
export function loadState(stateFilePath) {
  try {
    if (!fs.existsSync(stateFilePath)) {
      return { executors: {}, last_result: null };
    }
    const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    return {
      executors: data.executors && typeof data.executors === 'object' ? data.executors : {},
      last_result: data.last_result || null,
    };
  } catch {
    return { executors: {}, last_result: null };
  }
}

/**
 * Save cooldown/relay state atomically to .codebaton/state.json.
 * @param {string} stateFilePath
 * @param {object} state
 */
export function saveState(stateFilePath, state) {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  const tmpPath = `${stateFilePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, stateFilePath);
}

/**
 * Delete persisted cooldown state file.
 * @param {string} stateFilePath
 */
export function resetState(stateFilePath) {
  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
    return true;
  }
  return false;
}

/**
 * Cancellable sleep that resolves early with { aborted: true } on SIGINT/SIGTERM.
 * @param {number} seconds
 */
function cancellableSleep(seconds) {
  return new Promise((resolve) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const onSig = (sig) => {
      clearTimeout(timer);
      cleanup();
      resolve({ aborted: true, signal: sig });
    };
    const cleanup = () => {
      process.off('SIGINT', onSig);
      process.off('SIGTERM', onSig);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ aborted: false, signal: null });
    }, ms);

    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);
  });
}

/**
 * Build the candidate executor list and verify tier/model mapping.
 */
export function buildExecutionPlan({ config, tier, forcedExecutor, taskText, noPrefix }) {
  const tierMap = config.tiers[tier];
  if (!tierMap || typeof tierMap !== 'object') {
    const known = Object.keys(config.tiers).join(', ');
    throw new Error(`Unknown tier "${tier}". Configured tiers: ${known || '(none)'}`);
  }

  const chain = forcedExecutor ? [forcedExecutor] : [...config.executor_chain];
  const fullTask = noPrefix || !config.executor_prompt_prefix
    ? taskText
    : `${config.executor_prompt_prefix}${taskText}`;

  const steps = chain.map((executor) => {
    const template = config.commands[executor];
    if (!template) {
      throw new Error(`Executor "${executor}" is not defined in config "commands".`);
    }
    const model = tierMap[executor];
    if (!model) {
      throw new Error(`Executor "${executor}" has no model configured under tiers.${tier}.`);
    }
    const resolved = resolveCommand(template, {
      model,
      task: fullTask,
      executor,
      tier,
    });
    return {
      executor,
      tier,
      model,
      ...resolved,
    };
  });

  return { steps, fullTask };
}

/**
 * Execute a single pass across all candidate executors.
 */
async function executeRelayPass({
  steps,
  config,
  state,
  stateFilePath,
  logDir,
  cwd,
  ignoreCooldown,
  forcedExecutor,
  extraEnv,
}) {
  const now = Date.now();
  const attempts = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const nextStep = steps[i + 1];
    const saved = state.executors[step.executor];

    // Respect active cooldown unless forced or --ignore-cooldown was passed.
    if (
      !ignoreCooldown &&
      !forcedExecutor &&
      saved?.cooldown_until &&
      Date.parse(saved.cooldown_until) > now
    ) {
      const remainingSec = Math.ceil((Date.parse(saved.cooldown_until) - now) / 1000);
      process.stderr.write(
        `[codebaton] SKIP ${step.executor}: active ${saved.limit_type} cooldown (${remainingSec}s remaining${saved.reset_hint ? `, ${saved.reset_hint}` : ''})\n`
      );
      attempts.push({
        executor: step.executor,
        model: step.model,
        status: saved.limit_type,
        fromCooldown: true,
        resetHint: saved.reset_hint || null,
        delaySeconds: remainingSec,
      });
      continue;
    }

    process.stderr.write(
      `[codebaton] DISPATCH executor=${step.executor} tier=${step.tier} model=${step.model}\n`
    );

    const runResult = await runExecutorCommand({
      bin: step.bin,
      args: step.args,
      display: step.display,
      executor: step.executor,
      tier: step.tier,
      model: step.model,
      timeoutSeconds: config.timeout_seconds,
      logDir,
      cwd,
      extraEnv,
    });

    if (runResult.ok) {
      // Clear any previous cooldown for this executor upon success.
      if (state.executors[step.executor]) {
        delete state.executors[step.executor];
      }
      state.last_result = {
        timestamp: new Date().toISOString(),
        exit_code: EXIT_OK,
        executor: step.executor,
        model: step.model,
        tier: step.tier,
        duration_ms: runResult.durationMs,
        log_path: runResult.logPath,
      };
      saveState(stateFilePath, state);

      process.stderr.write(
        `[codebaton] SUCCESS executor=${step.executor} model=${step.model} duration=${(runResult.durationMs / 1000).toFixed(1)}s log=${runResult.logPath}\n`
      );
      return { exitCode: EXIT_OK, attempts };
    }

    if (runResult.timedOut) {
      state.last_result = {
        timestamp: new Date().toISOString(),
        exit_code: EXIT_ERROR,
        reason: 'timeout',
        executor: step.executor,
        log_path: runResult.logPath,
      };
      saveState(stateFilePath, state);
      process.stderr.write(
        `[codebaton] RESULT exit=1 reason=timeout executor=${step.executor} log=${runResult.logPath}\n`
      );
      return { exitCode: EXIT_ERROR, attempts };
    }

    if (runResult.notFound) {
      attempts.push({
        executor: step.executor,
        model: step.model,
        status: 'unavailable',
        resetHint: 'CLI binary not found',
        delaySeconds: null,
      });
      if (nextStep) {
        process.stderr.write(
          `[codebaton] HANDOFF ${step.executor} (cli_not_found) -> ${nextStep.executor}\n`
        );
      }
      continue;
    }

    const classification = classifyFailure(runResult.output, config);

    if (classification.kind === 'normal_error') {
      state.last_result = {
        timestamp: new Date().toISOString(),
        exit_code: EXIT_ERROR,
        reason: 'normal_error',
        executor: step.executor,
        executor_exit_code: runResult.exitCode,
        log_path: runResult.logPath,
      };
      saveState(stateFilePath, state);
      process.stderr.write(
        `[codebaton] RESULT exit=1 reason=normal_error executor=${step.executor} executor_exit=${runResult.exitCode} log=${runResult.logPath}\n`
      );
      return { exitCode: EXIT_ERROR, attempts };
    }

    // Rate-limited (short_limit or weekly_limit): record cooldown and hand off baton.
    const defaultCooldown =
      classification.kind === 'weekly_limit'
        ? config.cooldown_seconds.weekly_limit
        : config.cooldown_seconds.short_limit;
    const bufferSec = config.exhaustion_policy.auto_wait.buffer_seconds || 0;
    const effectiveCooldown =
      classification.delaySeconds !== null
        ? classification.delaySeconds + bufferSec
        : defaultCooldown;
    const cooldownUntil = new Date(Date.now() + effectiveCooldown * 1000).toISOString();

    state.executors[step.executor] = {
      limit_type: classification.kind,
      hit_at: new Date().toISOString(),
      cooldown_until: cooldownUntil,
      reset_hint: classification.resetHint,
      matched_pattern: classification.matchedPattern,
      log_path: runResult.logPath,
    };
    saveState(stateFilePath, state);

    attempts.push({
      executor: step.executor,
      model: step.model,
      status: classification.kind,
      fromCooldown: false,
      resetHint: classification.resetHint,
      delaySeconds: classification.delaySeconds,
      logPath: runResult.logPath,
    });

    if (nextStep) {
      process.stderr.write(
        `[codebaton] HANDOFF ${step.executor} (${classification.kind}${classification.resetHint ? `: ${classification.resetHint}` : ''}) -> ${nextStep.executor}\n`
      );
    }
  }

  return { exitCode: null, attempts };
}

/**
 * Determine overall exhaustion category from all executor attempt outcomes:
 *   - If ANY executor is short_limit -> "short_limit" (exit 2)
 *   - Else if ANY executor is weekly_limit -> "weekly_limit" (exit 3)
 *   - Else -> "unavailable" (exit 2)
 */
function summarizeExhaustion(attempts) {
  const hasShort = attempts.some((a) => a.status === 'short_limit');
  const hasWeekly = attempts.some((a) => a.status === 'weekly_limit');

  let limitType = 'unavailable';
  let exitCode = EXIT_SHORT_LIMIT_EXHAUSTED;

  if (hasShort) {
    limitType = 'short_limit';
    exitCode = EXIT_SHORT_LIMIT_EXHAUSTED;
  } else if (hasWeekly) {
    limitType = 'weekly_limit';
    exitCode = EXIT_WEEKLY_LIMIT_EXHAUSTED;
  }

  const hints = attempts.map((a) => a.resetHint).filter(Boolean);
  const delays = attempts
    .filter((a) => a.status === limitType && typeof a.delaySeconds === 'number' && a.delaySeconds > 0)
    .map((a) => a.delaySeconds);

  return {
    limitType,
    exitCode,
    resetHint: hints[0] || null,
    minDelaySeconds: delays.length > 0 ? Math.min(...delays) : null,
    summaryPairs: attempts.map((a) => `${a.executor}:${a.status}`).join(','),
  };
}

/**
 * Run the full relay orchestration, including configured exhaustion policies
 * (planner_takeover / manual_pause / auto_wait).
 */
export async function runRelay({
  config,
  tier,
  forcedExecutor,
  taskText,
  noPrefix = false,
  ignoreCooldown = false,
  cwd = process.cwd(),
  extraEnv = {},
}) {
  const { steps } = buildExecutionPlan({ config, tier, forcedExecutor, taskText, noPrefix });
  const logDir = path.resolve(cwd, config.log_dir);
  const stateFilePath = path.resolve(cwd, config.state_file);

  let totalWaitedSeconds = 0;
  let retryCount = 0;
  let forceIgnoreCooldown = ignoreCooldown;

  while (true) {
    const state = loadState(stateFilePath);
    const pass = await executeRelayPass({
      steps,
      config,
      state,
      stateFilePath,
      logDir,
      cwd,
      ignoreCooldown: forceIgnoreCooldown,
      forcedExecutor,
      extraEnv,
    });

    if (pass.exitCode !== null) {
      return pass.exitCode;
    }

    const summary = summarizeExhaustion(pass.attempts);
    const policy =
      summary.limitType === 'weekly_limit'
        ? config.exhaustion_policy.weekly_limit
        : summary.limitType === 'short_limit'
          ? config.exhaustion_policy.short_limit
          : 'manual_pause';

    if (policy === 'auto_wait' && summary.limitType !== 'unavailable') {
      const autoWait = config.exhaustion_policy.auto_wait;
      const remainingBudget = autoWait.max_wait_seconds - totalWaitedSeconds;

      if (remainingBudget > 0) {
        const bufferSec = autoWait.buffer_seconds || 0;
        const proposedWait =
          summary.minDelaySeconds !== null
            ? summary.minDelaySeconds + bufferSec
            : autoWait.poll_interval_seconds;
        const waitSec = Math.min(Math.max(1, proposedWait), remainingBudget);
        retryCount += 1;

        const nextAttemptAt = new Date(Date.now() + waitSec * 1000).toISOString();
        state.last_result = {
          timestamp: new Date().toISOString(),
          status: 'waiting',
          limit_type: summary.limitType,
          policy: 'auto_wait',
          retry_count: retryCount,
          wait_seconds: waitSec,
          next_attempt_at: nextAttemptAt,
          executors: summary.summaryPairs,
        };
        saveState(stateFilePath, state);

        process.stderr.write(
          `[codebaton] AUTO_WAIT limit_type=${summary.limitType} retry=${retryCount} wait=${waitSec}s next_attempt=${nextAttemptAt} (total_waited=${totalWaitedSeconds}s/${autoWait.max_wait_seconds}s)\n`
        );

        const sleepResult = await cancellableSleep(waitSec);
        if (sleepResult.aborted) {
          process.stderr.write(
            `[codebaton] RESULT exit=${summary.exitCode} limit_type=${summary.limitType} next_action=manual_pause reason=wait_interrupted executors=${summary.summaryPairs}\n`
          );
          return summary.exitCode;
        }

        totalWaitedSeconds += waitSec;
        // After waiting for quota recovery, ignore stale cooldown timestamps on the next attempt.
        forceIgnoreCooldown = true;
        continue;
      }

      // Auto-wait budget exhausted -> emit configured on_timeout fallback action.
      const fallbackAction = autoWait.on_timeout;
      state.last_result = {
        timestamp: new Date().toISOString(),
        exit_code: summary.exitCode,
        limit_type: summary.limitType,
        next_action: fallbackAction,
        reason: 'auto_wait_timeout',
        total_waited_seconds: totalWaitedSeconds,
        reset_hint: summary.resetHint,
        executors: summary.summaryPairs,
      };
      saveState(stateFilePath, state);

      process.stderr.write(
        `[codebaton] RESULT exit=${summary.exitCode} limit_type=${summary.limitType} next_action=${fallbackAction} reason=auto_wait_timeout total_waited=${totalWaitedSeconds}s reset_hint=${JSON.stringify(summary.resetHint || '')} executors=${summary.summaryPairs}\n`
      );
      return summary.exitCode;
    }

    // Policy is planner_takeover or manual_pause -> emit structured directive for Planner.
    state.last_result = {
      timestamp: new Date().toISOString(),
      exit_code: summary.exitCode,
      limit_type: summary.limitType,
      next_action: policy,
      reset_hint: summary.resetHint,
      executors: summary.summaryPairs,
    };
    saveState(stateFilePath, state);

    process.stderr.write(
      `[codebaton] RESULT exit=${summary.exitCode} limit_type=${summary.limitType} next_action=${policy} reset_hint=${JSON.stringify(summary.resetHint || '')} executors=${summary.summaryPairs}\n`
    );
    return summary.exitCode;
  }
}
