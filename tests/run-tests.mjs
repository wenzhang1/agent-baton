#!/usr/bin/env node
/**
 * Zero-dependency automated test suite for batonflow.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BIN_PATH = path.join(PROJECT_ROOT, 'bin', 'batonflow');
const MOCK_EXECUTOR = path.join(__dirname, 'mock-executor.mjs');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'batonflow-tests-'));

function createTestWorkspace(name, configOverrides = {}) {
  const dir = path.join(tmpBase, name);
  fs.mkdirSync(dir, { recursive: true });

  const baseConfig = {
    executor_chain: ['codex', 'claude', 'gemini'],
    tiers: {
      high: {
        codex: 'codex-high-model',
        claude: 'claude-high-model',
        gemini: 'gemini-high-model',
      },
      low: {
        codex: 'codex-low-model',
        claude: 'claude-low-model',
        gemini: 'gemini-low-model',
      },
    },
    commands: {
      codex: [process.execPath, MOCK_EXECUTOR, '--executor', 'codex', '--model', '{{model}}', '--effort', '{{effort}}', '--task', '{{task}}'],
      claude: [process.execPath, MOCK_EXECUTOR, '--executor', 'claude', '--model', '{{model}}', '--effort', '{{effort}}', '--task', '{{task}}'],
      gemini: [process.execPath, MOCK_EXECUTOR, '--executor', 'gemini', '--model', '{{model}}', '--effort', '{{effort}}', '--task', '{{task}}'],
    },
    exhaustion_policy: {
      short_limit: 'manual_pause',
      weekly_limit: 'planner_takeover',
      auto_wait: {
        poll_interval_seconds: 1,
        max_wait_seconds: 3,
        buffer_seconds: 0,
        on_timeout: 'manual_pause',
      },
    },
    cooldown_seconds: {
      short_limit: 60,
      weekly_limit: 3600,
    },
    timeout_seconds: 15,
    log_dir: '.batonflow/logs',
    state_file: '.batonflow/state.json',
    ...configOverrides,
  };

  const configPath = path.join(dir, 'batonflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), 'utf8');
  return { dir, configPath };
}

function runBatonflow(args, { cwd, env = {} }) {
  return spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      BATONFLOW_ROLE: '',
      BATONFLOW_DEPTH: '0',
      BATONFLOW_MOCK_STATE_FILE: path.join(cwd, '.batonflow', 'mock-counter.json'),
      ...env,
    },
  });
}

function parseMockJson(stdout) {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('{') && l.endsWith('}'));
  assert.ok(line, `Expected JSON line in stdout, got:\n${stdout}`);
  return JSON.parse(line);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Tier mapping routes high and low tiers to exact models', () => {
  const { dir } = createTestWorkspace('tier-mapping');

  const highRes = runBatonflow(['--tier', 'high', '--task', 'Build auth'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(highRes.status, 0, highRes.stderr);
  const highPayload = parseMockJson(highRes.stdout);
  assert.equal(highPayload.executor, 'codex');
  assert.equal(highPayload.model, 'codex-high-model');
  assert.equal(highPayload.role, 'executor');
  assert.equal(highPayload.depth, '1');

  const lowRes = runBatonflow(['--tier', 'low', '--task', 'Add tests'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(lowRes.status, 0, lowRes.stderr);
  const lowPayload = parseMockJson(lowRes.stdout);
  assert.equal(lowPayload.executor, 'codex');
  assert.equal(lowPayload.model, 'codex-low-model');
});

test('2. Automatic failover on 429 / 5-hour rate limit hands off to next executor', () => {
  const { dir } = createTestWorkspace('failover-short');
  const res = runBatonflow(['--tier', 'high', '--task', 'Implement caching'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:short_limit,claude:ok,gemini:ok' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /HANDOFF codex \(short_limit/);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.executor, 'claude');
  assert.equal(payload.model, 'claude-high-model');
});

test('3. Mixed exhaustion (weekly + 5-hour short limit) returns exit 2 with manual_pause', () => {
  const { dir } = createTestWorkspace('mixed-exhaustion');
  const res = runBatonflow(['--tier', 'high', '--task', 'Refactor API'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:short_limit,gemini:weekly_limit' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /RESULT exit=2 limit_type=short_limit next_action=manual_pause/);
  assert.match(res.stderr, /executors=codex:weekly_limit,claude:short_limit,gemini:weekly_limit/);
});

test('4. All weekly/hard quota exhausted returns exit 3 with default planner_takeover', () => {
  const { dir } = createTestWorkspace('weekly-exhaustion-default');
  const res = runBatonflow(['--tier', 'high', '--task', 'Migrate schema'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:quota_exceeded,gemini:weekly_limit' },
  });
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /RESULT exit=3 limit_type=weekly_limit next_action=planner_takeover/);
});

test('5. Configurable weekly_limit=manual_pause disables automatic planner takeover', () => {
  const { dir } = createTestWorkspace('weekly-manual-pause', {
    exhaustion_policy: {
      short_limit: 'manual_pause',
      weekly_limit: 'manual_pause',
      auto_wait: {
        poll_interval_seconds: 1,
        max_wait_seconds: 3,
        buffer_seconds: 0,
        on_timeout: 'manual_pause',
      },
    },
  });
  const res = runBatonflow(['--tier', 'low', '--task', 'Update docs'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:weekly_limit,gemini:weekly_limit' },
  });
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /RESULT exit=3 limit_type=weekly_limit next_action=manual_pause/);
});

test('6. Configurable short_limit=planner_takeover lets Planner take over immediately on 5h limit', () => {
  const { dir } = createTestWorkspace('short-planner-takeover', {
    exhaustion_policy: {
      short_limit: 'planner_takeover',
      weekly_limit: 'planner_takeover',
      auto_wait: {
        poll_interval_seconds: 1,
        max_wait_seconds: 3,
        buffer_seconds: 0,
        on_timeout: 'manual_pause',
      },
    },
  });
  const res = runBatonflow(['--tier', 'high', '--task', 'Fix race condition'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:short_limit,claude:short_limit,gemini:short_limit' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /RESULT exit=2 limit_type=short_limit next_action=planner_takeover/);
});

test('7. Configurable short_limit=auto_wait waits and automatically resumes to exit 0', () => {
  const { dir } = createTestWorkspace('short-auto-wait-recover', {
    exhaustion_policy: {
      short_limit: 'auto_wait',
      weekly_limit: 'planner_takeover',
      auto_wait: {
        poll_interval_seconds: 1,
        max_wait_seconds: 5,
        buffer_seconds: 0,
        on_timeout: 'manual_pause',
      },
    },
  });
  const res = runBatonflow(['--tier', 'high', '--task', 'Auto resume task'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:short_limit_once,claude:short_limit_fast,gemini:short_limit_fast' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /AUTO_WAIT limit_type=short_limit retry=1/);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.status, 'ok_after_wait');
  assert.equal(payload.executor, 'codex');
});

test('8. auto_wait timeout falls back to configured on_timeout action', () => {
  const { dir } = createTestWorkspace('short-auto-wait-timeout', {
    exhaustion_policy: {
      short_limit: 'auto_wait',
      weekly_limit: 'planner_takeover',
      auto_wait: {
        poll_interval_seconds: 1,
        max_wait_seconds: 1,
        buffer_seconds: 0,
        on_timeout: 'planner_takeover',
      },
    },
  });
  const res = runBatonflow(['--tier', 'low', '--task', 'Still exhausted'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:short_limit_fast,claude:short_limit_fast,gemini:short_limit_fast' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /next_action=planner_takeover reason=auto_wait_timeout/);
});

test('9. Normal code error returns exit 1 immediately WITHOUT failing over', () => {
  const { dir } = createTestWorkspace('normal-error');
  const res = runBatonflow(['--tier', 'high', '--task', 'Broken build'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:error,claude:ok,gemini:ok' },
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /RESULT exit=1 reason=normal_error executor=codex/);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=claude/);
});

test('10. --executor forces a single executor without unintended chain failover', () => {
  const { dir } = createTestWorkspace('forced-executor');
  const res = runBatonflow(['--tier', 'high', '--executor', 'claude', '--task', 'Forced run'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok,claude:short_limit,gemini:ok' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=codex/);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=gemini/);
  assert.match(res.stderr, /executors=claude:short_limit/);
});

test('11. Timeout enforcement terminates hung process group and returns exit 1', () => {
  const { dir } = createTestWorkspace('timeout-check', { timeout_seconds: 1 });
  const res = runBatonflow(['--tier', 'low', '--task', 'Hung job'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:hang,claude:ok' },
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /TIMEOUT: executor "codex"/);
  assert.match(res.stderr, /RESULT exit=1 reason=timeout/);
});

test('12. Missing CLI binary (ENOENT) gracefully fails over to next executor', () => {
  const { dir } = createTestWorkspace('missing-cli', {
    commands: {
      codex: ['definitely-nonexistent-cli-binary-xyz', '--model', '{{model}}', '{{task}}'],
      claude: [process.execPath, MOCK_EXECUTOR, '--executor', 'claude', '--model', '{{model}}', '--task', '{{task}}'],
      gemini: [process.execPath, MOCK_EXECUTOR, '--executor', 'gemini', '--model', '{{model}}', '--task', '{{task}}'],
    },
  });
  const res = runBatonflow(['--tier', 'low', '--task', 'Skip missing CLI'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'claude:ok' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /HANDOFF codex \(cli_not_found\) -> claude/);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.executor, 'claude');
});

test('13. String command template safely preserves quotes, backticks, $VAR, and newlines', () => {
  const { dir } = createTestWorkspace('string-template-escaping', {
    commands: {
      codex: `${process.execPath} ${MOCK_EXECUTOR} --executor codex --model "{{model}}" --task "{{task}}"`,
      claude: [process.execPath, MOCK_EXECUTOR, '--executor', 'claude', '--model', '{{model}}', '--task', '{{task}}'],
      gemini: [process.execPath, MOCK_EXECUTOR, '--executor', 'gemini', '--model', '{{model}}', '--task', '{{task}}'],
    },
    executor_prompt_prefix: '',
  });
  const trickyTask = 'Fix "$HOME" & `whoami` with \'single\' quotes\nand line 2 $(echo nope)';
  const res = runBatonflow(['--tier', 'high', '--task', trickyTask], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(res.status, 0, res.stderr);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.task, trickyTask);
});

test('14. Recursion guard blocks Executor from calling batonflow recursively', () => {
  const { dir } = createTestWorkspace('recursion-guard');
  const res = runBatonflow(['--tier', 'low', '--task', 'Attempt nested dispatch'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:try_nested' },
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /Nested batonflow invocation blocked/);
});

test('15. Cooldown state skips exhausted executor on next call until --reset-state', () => {
  const { dir } = createTestWorkspace('cooldown-memory');

  const run1 = runBatonflow(['--tier', 'low', '--task', 'Task 1'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:ok' },
  });
  assert.equal(run1.status, 0, run1.stderr);

  const run2 = runBatonflow(['--tier', 'low', '--task', 'Task 2'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok,claude:ok' },
  });
  assert.equal(run2.status, 0, run2.stderr);
  assert.match(run2.stderr, /SKIP codex: active weekly_limit cooldown/);
  assert.equal(parseMockJson(run2.stdout).executor, 'claude');

  const reset = runBatonflow(['--reset-state'], { cwd: dir });
  assert.equal(reset.status, 0, reset.stderr);

  const run3 = runBatonflow(['--tier', 'low', '--task', 'Task 3'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok,claude:ok' },
  });
  assert.equal(run3.status, 0, run3.stderr);
  assert.equal(parseMockJson(run3.stdout).executor, 'codex');
});

test('16. Built-in --dry-run and --mock failover modes succeed', () => {
  const dry = runBatonflow(['--dry-run', '--tier', 'high', '--task', 'Preview relay'], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /batonflow Dry Run/);
  assert.match(dry.stdout, /\[codex\]/);

  const mock = runBatonflow(['--mock', 'failover', '--tier', 'high', '--task', 'Demo relay'], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(mock.status, 0, mock.stderr);
  assert.match(mock.stderr, /HANDOFF codex \(short_limit/);
  assert.equal(parseMockJson(mock.stdout).executor, 'claude');
});

test('17. `batonflow init` initializes current working directory with zero args', () => {
  const dir = path.join(tmpBase, 'init-cwd');
  fs.mkdirSync(dir, { recursive: true });

  const res = runBatonflow(['init'], { cwd: dir });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'batonflow.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.batonflow', 'WORKFLOW.md')));
  assert.ok(fs.existsSync(path.join(dir, 'PLAN.md')));
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'batonflow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, '.agent', 'rules', 'batonflow.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'batonflow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));

  const skillContent = fs.readFileSync(path.join(dir, '.agents', 'skills', 'batonflow', 'SKILL.md'), 'utf8');
  assert.match(skillContent, /^---\nname: batonflow\n/);
  const claudeSkillContent = fs.readFileSync(path.join(dir, '.claude', 'skills', 'batonflow', 'SKILL.md'), 'utf8');
  assert.equal(claudeSkillContent, skillContent);

  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.batonflow\/logs\//);
  assert.match(gitignore, /\.batonflow\/\*\.json/);
});

test('18. `batonflow init` preserves existing CLAUDE.md and updates marker block idempotently', () => {
  const dir = path.join(tmpBase, 'init-idempotent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Custom Rules\nAlways use strict mode.\n', 'utf8');

  const r1 = runBatonflow(['init'], { cwd: dir });
  assert.equal(r1.status, 0, r1.stderr);

  // Customize PLAN.md to verify second run skips overwriting it
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Custom Plan\n', 'utf8');

  const r2 = runBatonflow(['init'], { cwd: dir });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8'), '# Custom Plan\n');

  const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /# My Custom Rules/);
  assert.match(claudeMd, /Always use strict mode\./);
  const startMatches = claudeMd.match(/<!-- batonflow:start -->/g) || [];
  assert.equal(startMatches.length, 1, 'Marker block should appear exactly once after repeated init');
});

test('19. `batonflow init --adapter <client>` installs only the selected client skill & adapter', () => {
  const dirAgy = path.join(tmpBase, 'init-antigravity-only');
  fs.mkdirSync(dirAgy, { recursive: true });

  const resAgy = runBatonflow(['init', '--adapter', 'antigravity'], { cwd: dirAgy });
  assert.equal(resAgy.status, 0, resAgy.stderr);
  assert.ok(fs.existsSync(path.join(dirAgy, '.agents', 'skills', 'batonflow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dirAgy, '.agent', 'rules', 'batonflow.md')));
  assert.ok(!fs.existsSync(path.join(dirAgy, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(dirAgy, '.claude', 'skills', 'batonflow', 'SKILL.md')));

  const dirClaude = path.join(tmpBase, 'init-claude-only');
  fs.mkdirSync(dirClaude, { recursive: true });

  const resClaude = runBatonflow(['init', '--adapter', 'claude-code'], { cwd: dirClaude });
  assert.equal(resClaude.status, 0, resClaude.stderr);
  assert.ok(fs.existsSync(path.join(dirClaude, '.claude', 'skills', 'batonflow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dirClaude, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(dirClaude, '.claude', 'settings.json')));
  assert.ok(!fs.existsSync(path.join(dirClaude, '.agent', 'rules', 'batonflow.md')));
});

test('20. `batonflow init --global-skill [target]` installs universal SKILL.md without creating project files', () => {
  const cwdDir = path.join(tmpBase, 'init-global-cwd');
  const fakeHome = path.join(tmpBase, 'fake-home');
  fs.mkdirSync(cwdDir, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });

  // Default `all` installs to all 3 standard global client paths
  const res = runBatonflow(['init', '--global-skill'], {
    cwd: cwdDir,
    env: { BATONFLOW_HOME: fakeHome },
  });
  assert.equal(res.status, 0, res.stderr);

  const universalSkill = path.join(fakeHome, '.agents', 'skills', 'batonflow', 'SKILL.md');
  const agySkill = path.join(fakeHome, '.gemini', 'config', 'skills', 'batonflow', 'SKILL.md');
  const claudeSkill = path.join(fakeHome, '.claude', 'skills', 'batonflow', 'SKILL.md');

  for (const p of [universalSkill, agySkill, claudeSkill]) {
    assert.ok(fs.existsSync(p), `Expected global skill at ${p}`);
    assert.match(fs.readFileSync(p, 'utf8'), /^---\nname: batonflow\n/);
  }
  // Must NOT pollute cwd with project files
  assert.ok(!fs.existsSync(path.join(cwdDir, 'PLAN.md')));
  assert.ok(!fs.existsSync(path.join(cwdDir, 'batonflow.config.json')));

  // Targeted `--global-skill claude-code` respects existing file unless `--force` is passed
  fs.writeFileSync(claudeSkill, 'custom-claude-skill', 'utf8');
  const r2 = runBatonflow(['init', '--global-skill', 'claude-code'], {
    cwd: cwdDir,
    env: { BATONFLOW_HOME: fakeHome },
  });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(claudeSkill, 'utf8'), 'custom-claude-skill');

  const r3 = runBatonflow(['init', '--global-skill', 'claude-code', '--force'], {
    cwd: cwdDir,
    env: { BATONFLOW_HOME: fakeHome },
  });
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(fs.readFileSync(claudeSkill, 'utf8'), /^---\nname: batonflow\n/);
});

test('21. Reasoning effort defaults per tier, --effort overrides, and effort_map downgrades on failover', () => {
  const { dir } = createTestWorkspace('effort-routing');

  // Default effort: high -> high, low -> medium
  const highDefault = runBatonflow(['--tier', 'high', '--task', 'Core design'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(highDefault.status, 0, highDefault.stderr);
  assert.equal(parseMockJson(highDefault.stdout).effort, 'high');

  const lowDefault = runBatonflow(['--tier', 'low', '--task', 'Simple tests'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(lowDefault.status, 0, lowDefault.stderr);
  assert.equal(parseMockJson(lowDefault.stdout).effort, 'medium');

  // Explicit --effort xhigh override
  const xhigh = runBatonflow(['--tier', 'high', '--effort', 'xhigh', '--task', 'Deep debug'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(xhigh.status, 0, xhigh.stderr);
  assert.equal(parseMockJson(xhigh.stdout).effort, 'xhigh');

  // Failover with --effort max -> codex & claude hit limit -> gemini receives mapped `xhigh`
  const mappedFailover = runBatonflow(['--tier', 'high', '--effort', 'max', '--task', 'Hardest bug'], {
    cwd: dir,
    env: { BATONFLOW_MOCK_BEHAVIOR: 'codex:short_limit,claude:short_limit,gemini:ok' },
  });
  assert.equal(mappedFailover.status, 0, mappedFailover.stderr);
  const payload = parseMockJson(mappedFailover.stdout);
  assert.equal(payload.executor, 'gemini');
  assert.equal(payload.effort, 'xhigh');
});

test('22. `batonflow init --permission-mode yolo` and `batonflow mode safe|yolo` switch presets safely', () => {
  const dir = path.join(tmpBase, 'permission-modes');
  fs.mkdirSync(dir, { recursive: true });

  // 1. Initialize directly in yolo mode
  const initYolo = runBatonflow(['init', '--permission-mode', 'yolo'], { cwd: dir });
  assert.equal(initYolo.status, 0, initYolo.stderr);
  const cfgPath = path.join(dir, 'batonflow.config.json');
  let cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(cfg.commands.codex.includes('--yolo'));
  assert.ok(cfg.commands.claude.includes('--dangerously-skip-permissions'));
  assert.ok(cfg.commands.gemini.includes('--dangerously-skip-permissions'));

  // Add a custom executor & custom timeout to ensure `batonflow mode` preserves them
  cfg.commands.opencode = ['opencode', 'run', '{{task}}'];
  cfg.timeout_seconds = 1234;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

  // 2. Switch back to safe mode
  const toSafe = runBatonflow(['mode', 'safe'], { cwd: dir });
  assert.equal(toSafe.status, 0, toSafe.stderr);
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(cfg.commands.codex.includes('workspace-write'));
  assert.ok(cfg.commands.claude.includes('acceptEdits'));
  assert.ok(cfg.commands.gemini.includes('--mode=auto'));
  assert.deepEqual(cfg.commands.opencode, ['opencode', 'run', '{{task}}']);
  assert.equal(cfg.timeout_seconds, 1234);

  // 3. Switch to yolo mode again
  const toYolo = runBatonflow(['mode', 'yolo'], { cwd: dir });
  assert.equal(toYolo.status, 0, toYolo.stderr);
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(cfg.commands.codex.includes('--yolo'));
  assert.ok(cfg.commands.claude.includes('--dangerously-skip-permissions'));
  assert.ok(cfg.commands.gemini.includes('--dangerously-skip-permissions'));
});

test('23. `batonflow archive` refuses unfinished PLAN.md unless --force, and avoids archive overwrites', () => {
  const dir = path.join(tmpBase, 'archive-guard');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(runBatonflow(['init'], { cwd: dir }).status, 0);

  // Default template PLAN.md has pending [ ] tasks -> must refuse without --force
  const blocked = runBatonflow(['archive', 'wip-feature'], { cwd: dir });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Refusing to archive/);

  // With --force -> archives cleanly
  const forced1 = runBatonflow(['archive', 'wip-feature', '--force'], { cwd: dir });
  assert.equal(forced1.status, 0, forced1.stderr);
  const archiveDir = path.join(dir, '.batonflow', 'archive');
  const files1 = fs.readdirSync(archiveDir);
  assert.equal(files1.length, 1);
  assert.match(files1[0], /^\d{4}-\d{2}-\d{2}-wip-feature\.md$/);

  // Second archive with same slug creates -2.md without overwriting the first
  const forced2 = runBatonflow(['archive', 'wip-feature', '--force'], { cwd: dir });
  assert.equal(forced2.status, 0, forced2.stderr);
  const files2 = fs.readdirSync(archiveDir).sort();
  assert.equal(files2.length, 2);
  assert.ok(files2.some((f) => /-wip-feature-2\.md$/.test(f)));
});

test('24. `batonflow archive` succeeds on completed PLAN.md and preserves Section 1 project constraints', () => {
  const dir = path.join(tmpBase, 'archive-smart-reset');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(runBatonflow(['init'], { cwd: dir }).status, 0);

  const planPath = path.join(dir, 'PLAN.md');
  const completedPlan = `# batonflow Task Plan (\`PLAN.md\`)

---

## 1. Global Goal & Constraints

- **Objective**: Implement JWT login and refresh token rotation
- **Tech Stack**: TypeScript, Node 22, PostgreSQL, Vitest
- **Repo Conventions**: Follow existing \`AGENTS.md\` / \`CLAUDE.md\`.
- **Verification Commands**:
  - Test: \`pnpm test\`
  - Build / Typecheck: \`pnpm typecheck\`
  - Lint: \`pnpm lint\`
- **Hard Constraints / Do Not Touch**:
  - Never alter historical SQL migrations

---

## 2. Task Board

Status legend: \`[ ]\` Pending · \`[x]\` Verified & Committed · \`[!]\` Interrupted / Blocked

| ID | Status | Tier | Batch | Depends On | Task Description | Acceptance Criteria |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| \`T1\` | \`[x]\` | \`high\` | single | \`-\` | Build JWT service | Tests pass |
| \`T2\` | \`[x]\` | \`low\` | single | \`T1\` | Add unit tests | Tests pass |

---

## 3. Relay & Checkpoint Recovery Log

- **State**: \`COMPLETED\`
`;
  fs.writeFileSync(planPath, completedPlan, 'utf8');

  const res = runBatonflow(['archive', 'jwt-auth'], { cwd: dir });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /preserved Tech Stack, Verification Commands, and Hard Constraints/);

  // Archived copy contains original completed plan
  const archiveDir = path.join(dir, '.batonflow', 'archive');
  const archivedFiles = fs.readdirSync(archiveDir);
  assert.equal(archivedFiles.length, 1);
  const archivedContent = fs.readFileSync(path.join(archiveDir, archivedFiles[0]), 'utf8');
  assert.match(archivedContent, /Implement JWT login and refresh token rotation/);
  assert.match(archivedContent, /Build JWT service/);

  // Reset PLAN.md cleared old Objective & old tasks, but kept Tech Stack, Verification Commands & Hard Constraints!
  const resetContent = fs.readFileSync(planPath, 'utf8');
  assert.doesNotMatch(resetContent, /Implement JWT login and refresh token rotation/);
  assert.doesNotMatch(resetContent, /Build JWT service/);
  assert.match(resetContent, /TypeScript, Node 22, PostgreSQL, Vitest/);
  assert.match(resetContent, /pnpm test/);
  assert.match(resetContent, /Never alter historical SQL migrations/);
});

// Run all tests
let passed = 0;
let failed = 0;

for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log(`PASS  ${t.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${t.name}`);
    console.error(`      ${err.message}`);
  }
}

fs.rmSync(tmpBase, { recursive: true, force: true });
// Clean up ephemeral mock state generated in PROJECT_ROOT by test #16
fs.rmSync(path.join(PROJECT_ROOT, '.batonflow'), { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed (total ${tests.length})`);
process.exit(failed > 0 ? 1 : 0);
