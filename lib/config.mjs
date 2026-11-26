/**
 * Configuration loader, validator, and safe command template resolver.
 */

import fs from 'node:fs';
import path from 'node:path';

export const VALID_POLICIES = new Set(['planner_takeover', 'manual_pause', 'auto_wait']);
export const VALID_TIMEOUT_FALLBACKS = new Set(['manual_pause', 'planner_takeover']);

export const DEFAULT_CONFIG = {
  executor_chain: ['codex', 'claude', 'gemini'],
  tiers: {
    high: {},
    low: {},
  },
  commands: {},
  weekly_limit_patterns: [
    'weekly[\\s_-]*(usage[\\s_-]*)?(limit|quota|cap)',
    '7[\\s-]*day[\\s_-]*(limit|quota)',
    'monthly[\\s_-]*(usage[\\s_-]*)?(limit|quota)',
    'insufficient_quota',
    'credit balance is too low',
    'out of credits',
    'billing[\\s_-]*(limit|hard limit)',
    'exceeded your current quota',
    'resets?\\s+(on\\s+)?(mon|tue|wed|thu|fri|sat|sun)(day)?',
    'try again in\\s+\\d+\\s+days?',
  ],
  rate_limit_patterns: [
    '\\b429\\b',
    'rate[\\s_-]*limit',
    'too many requests',
    'usage[\\s_-]*limit',
    'quota[\\s_-]*exceeded',
    '5[\\s-]*hour[\\s_-]*(limit|window|quota)',
    'five[\\s-]*hour',
    'hit your limit',
    'limit reached',
    'overloaded_error',
    'resource_exhausted',
    'try again in\\s+\\d+\\s*(sec|second|min|minute|hr|hour)s?',
  ],
  exhaustion_policy: {
    short_limit: 'manual_pause',
    weekly_limit: 'planner_takeover',
    auto_wait: {
      poll_interval_seconds: 900,
      max_wait_seconds: 21600,
      buffer_seconds: 30,
      on_timeout: 'manual_pause',
    },
  },
  cooldown_seconds: {
    short_limit: 900,
    weekly_limit: 86400,
  },
  timeout_seconds: 600,
  log_dir: '.codebaton/logs',
  state_file: '.codebaton/state.json',
  executor_prompt_prefix:
    "[CODEBATON_EXECUTOR_MODE] You are acting strictly as a code Executor for this single task. Follow the repository's coding standards (AGENTS.md / CLAUDE.md), implement the task directly, do NOT invoke codebaton, and do NOT modify PLAN.md.\n\n",
};

/**
 * Load and validate codebaton configuration.
 * @param {{ configPath: string | null, allowExampleFallback?: boolean, cwd?: string }} options
 */
export function loadConfig({ configPath, allowExampleFallback = false, cwd = process.cwd() }) {
  let resolvedPath = null;

  if (configPath) {
    resolvedPath = path.resolve(cwd, configPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
  } else {
    const primary = path.resolve(cwd, 'codebaton.config.json');
    const example = path.resolve(cwd, 'codebaton.config.example.json');
    if (fs.existsSync(primary)) {
      resolvedPath = primary;
    } else if (allowExampleFallback && fs.existsSync(example)) {
      resolvedPath = example;
    } else {
      throw new Error(
        `No codebaton.config.json found in ${cwd}. Copy codebaton.config.example.json or run scripts/init.sh first.`
      );
    }
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse config JSON (${resolvedPath}): ${err.message}`);
  }

  const merged = mergeConfig(raw);
  validateConfig(merged, resolvedPath);

  return {
    config: merged,
    configPath: resolvedPath,
    baseDir: path.dirname(resolvedPath),
  };
}

function mergeConfig(raw) {
  const exhaustionRaw = raw.exhaustion_policy || {};
  const autoWaitRaw = exhaustionRaw.auto_wait || {};
  const cooldownRaw = raw.cooldown_seconds || {};

  return {
    executor_chain: Array.isArray(raw.executor_chain)
      ? raw.executor_chain
      : DEFAULT_CONFIG.executor_chain,
    tiers: raw.tiers || DEFAULT_CONFIG.tiers,
    commands: raw.commands || DEFAULT_CONFIG.commands,
    weekly_limit_patterns: Array.isArray(raw.weekly_limit_patterns)
      ? raw.weekly_limit_patterns
      : DEFAULT_CONFIG.weekly_limit_patterns,
    rate_limit_patterns: Array.isArray(raw.rate_limit_patterns)
      ? raw.rate_limit_patterns
      : DEFAULT_CONFIG.rate_limit_patterns,
    exhaustion_policy: {
      short_limit: exhaustionRaw.short_limit ?? DEFAULT_CONFIG.exhaustion_policy.short_limit,
      weekly_limit: exhaustionRaw.weekly_limit ?? DEFAULT_CONFIG.exhaustion_policy.weekly_limit,
      auto_wait: {
        poll_interval_seconds:
          autoWaitRaw.poll_interval_seconds ??
          DEFAULT_CONFIG.exhaustion_policy.auto_wait.poll_interval_seconds,
        max_wait_seconds:
          autoWaitRaw.max_wait_seconds ??
          DEFAULT_CONFIG.exhaustion_policy.auto_wait.max_wait_seconds,
        buffer_seconds:
          autoWaitRaw.buffer_seconds ?? DEFAULT_CONFIG.exhaustion_policy.auto_wait.buffer_seconds,
        on_timeout:
          autoWaitRaw.on_timeout ?? DEFAULT_CONFIG.exhaustion_policy.auto_wait.on_timeout,
      },
    },
    cooldown_seconds: {
      short_limit: cooldownRaw.short_limit ?? DEFAULT_CONFIG.cooldown_seconds.short_limit,
      weekly_limit: cooldownRaw.weekly_limit ?? DEFAULT_CONFIG.cooldown_seconds.weekly_limit,
    },
    timeout_seconds: raw.timeout_seconds ?? DEFAULT_CONFIG.timeout_seconds,
    log_dir: raw.log_dir ?? DEFAULT_CONFIG.log_dir,
    state_file: raw.state_file ?? DEFAULT_CONFIG.state_file,
    executor_prompt_prefix:
      raw.executor_prompt_prefix !== undefined
        ? raw.executor_prompt_prefix
        : DEFAULT_CONFIG.executor_prompt_prefix,
  };
}

function validateConfig(config, source) {
  if (!Array.isArray(config.executor_chain) || config.executor_chain.length === 0) {
    throw new Error(`Invalid config (${source}): "executor_chain" must be a non-empty array.`);
  }
  if (!config.tiers || typeof config.tiers !== 'object') {
    throw new Error(`Invalid config (${source}): "tiers" must be an object.`);
  }
  if (!config.commands || typeof config.commands !== 'object') {
    throw new Error(`Invalid config (${source}): "commands" must be an object.`);
  }
  for (const name of config.executor_chain) {
    if (!config.commands[name]) {
      throw new Error(
        `Invalid config (${source}): executor "${name}" in executor_chain has no entry in "commands".`
      );
    }
  }

  const { short_limit: shortPolicy, weekly_limit: weeklyPolicy, auto_wait: autoWait } =
    config.exhaustion_policy;

  if (!VALID_POLICIES.has(shortPolicy)) {
    throw new Error(
      `Invalid config (${source}): exhaustion_policy.short_limit must be one of ${[...VALID_POLICIES].join(', ')}.`
    );
  }
  if (!VALID_POLICIES.has(weeklyPolicy)) {
    throw new Error(
      `Invalid config (${source}): exhaustion_policy.weekly_limit must be one of ${[...VALID_POLICIES].join(', ')}.`
    );
  }
  if (!VALID_TIMEOUT_FALLBACKS.has(autoWait.on_timeout)) {
    throw new Error(
      `Invalid config (${source}): exhaustion_policy.auto_wait.on_timeout must be one of ${[...VALID_TIMEOUT_FALLBACKS].join(', ')}.`
    );
  }
  if (typeof config.timeout_seconds !== 'number' || config.timeout_seconds <= 0) {
    throw new Error(`Invalid config (${source}): "timeout_seconds" must be a positive number.`);
  }

  // Validate regex patterns early so misconfigurations fail fast.
  for (const listName of ['weekly_limit_patterns', 'rate_limit_patterns']) {
    for (const pattern of config[listName]) {
      try {
        new RegExp(pattern, 'i');
      } catch (err) {
        throw new Error(
          `Invalid regex in ${listName} (${source}): "${pattern}" -> ${err.message}`
        );
      }
    }
  }
}

/**
 * Safely POSIX-escape a string for sh -c fallback (single-quote wrapping).
 * @param {string} value
 */
export function posixShellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse a simple command string into argv tokens when no shell operators exist.
 * Handles single and double quotes cleanly.
 * @param {string} template
 * @returns {string[] | null} null if shell metacharacters require sh -c
 */
function tokenizeSimpleCommand(template) {
  // If template uses pipes, redirects, subshells, or logical operators, fall back to sh -c.
  if (/[|&;<>`\n]|\$\(/.test(template)) {
    return null;
  }

  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    return null;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Resolve a configured command template (array or string) into { bin, args, display }.
 *
 * Array templates (recommended) are always executed directly with shell: false,
 * avoiding quoting/injection issues when {{task}} contains multiline code or quotes.
 *
 * String templates are tokenized into shell: false argv whenever possible; if shell
 * operators (|, &&, >) are present, placeholders are safely POSIX-quoted and run via sh -c.
 *
 * @param {string | string[]} template
 * @param {{ model: string, task: string, executor: string, tier: string }} vars
 */
export function resolveCommand(template, vars) {
  const replaceVars = (str) =>
    String(str)
      .replaceAll('{{model}}', vars.model)
      .replaceAll('{{task}}', vars.task)
      .replaceAll('{{executor}}', vars.executor)
      .replaceAll('{{tier}}', vars.tier);

  if (Array.isArray(template)) {
    if (template.length === 0) {
      throw new Error(`Command template for executor "${vars.executor}" is empty.`);
    }
    const resolved = template.map(replaceVars);
    const [bin, ...args] = resolved;
    return {
      bin,
      args,
      display: [bin, ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' '),
    };
  }

  if (typeof template === 'string') {
    const tokens = tokenizeSimpleCommand(template);
    if (tokens && tokens.length > 0) {
      const resolved = tokens.map(replaceVars);
      const [bin, ...args] = resolved;
      return {
        bin,
        args,
        display: [bin, ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' '),
      };
    }

    // Complex shell template fallback: POSIX-quote placeholder values safely.
    const shellCmd = template
      .replaceAll('"{{model}}"', posixShellQuote(vars.model))
      .replaceAll("'{{model}}'", posixShellQuote(vars.model))
      .replaceAll('{{model}}', posixShellQuote(vars.model))
      .replaceAll('"{{task}}"', posixShellQuote(vars.task))
      .replaceAll("'{{task}}'", posixShellQuote(vars.task))
      .replaceAll('{{task}}', posixShellQuote(vars.task))
      .replaceAll('{{executor}}', posixShellQuote(vars.executor))
      .replaceAll('{{tier}}', posixShellQuote(vars.tier));

    return {
      bin: '/bin/sh',
      args: ['-c', shellCmd],
      display: `/bin/sh -c ${JSON.stringify(shellCmd)}`,
    };
  }

  throw new Error(
    `Invalid command template for executor "${vars.executor}": expected string or string[].`
  );
}
