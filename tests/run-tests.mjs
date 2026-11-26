#!/usr/bin/env node
/**
 * Zero-dependency automated test suite for agent-baton.
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
const BIN_PATH = path.join(PROJECT_ROOT, 'bin', 'agent-baton');
const MOCK_EXECUTOR = path.join(__dirname, 'mock-executor.mjs');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-baton-tests-'));

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
      codex: [process.execPath, MOCK_EXECUTOR, '--executor', 'codex', '--model', '{{model}}', '--task', '{{task}}'],
      claude: [process.execPath, MOCK_EXECUTOR, '--executor', 'claude', '--model', '{{model}}', '--task', '{{task}}'],
      gemini: [process.execPath, MOCK_EXECUTOR, '--executor', 'gemini', '--model', '{{model}}', '--task', '{{task}}'],
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
    log_dir: '.agent-baton/logs',
    state_file: '.agent-baton/state.json',
    ...configOverrides,
  };

  const configPath = path.join(dir, 'agent-baton.config.json');
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), 'utf8');
  return { dir, configPath };
}

function runAgentBaton(args, { cwd, env = {} }) {
  return spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_BATON_ROLE: '',
      AGENT_BATON_DEPTH: '0',
      AGENT_BATON_MOCK_STATE_FILE: path.join(cwd, '.agent-baton', 'mock-counter.json'),
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

  const highRes = runAgentBaton(['--tier', 'high', '--task', 'Build auth'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(highRes.status, 0, highRes.stderr);
  const highPayload = parseMockJson(highRes.stdout);
  assert.equal(highPayload.executor, 'codex');
  assert.equal(highPayload.model, 'codex-high-model');
  assert.equal(highPayload.role, 'executor');
  assert.equal(highPayload.depth, '1');

  const lowRes = runAgentBaton(['--tier', 'low', '--task', 'Add tests'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(lowRes.status, 0, lowRes.stderr);
  const lowPayload = parseMockJson(lowRes.stdout);
  assert.equal(lowPayload.executor, 'codex');
  assert.equal(lowPayload.model, 'codex-low-model');
});

test('2. Automatic failover on 429 / 5-hour rate limit hands off to next executor', () => {
  const { dir } = createTestWorkspace('failover-short');
  const res = runAgentBaton(['--tier', 'high', '--task', 'Implement caching'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:short_limit,claude:ok,gemini:ok' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /HANDOFF codex \(short_limit/);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.executor, 'claude');
  assert.equal(payload.model, 'claude-high-model');
});

test('3. Mixed exhaustion (weekly + 5-hour short limit) returns exit 2 with manual_pause', () => {
  const { dir } = createTestWorkspace('mixed-exhaustion');
  const res = runAgentBaton(['--tier', 'high', '--task', 'Refactor API'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:short_limit,gemini:weekly_limit' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /RESULT exit=2 limit_type=short_limit next_action=manual_pause/);
  assert.match(res.stderr, /executors=codex:weekly_limit,claude:short_limit,gemini:weekly_limit/);
});

test('4. All weekly/hard quota exhausted returns exit 3 with default planner_takeover', () => {
  const { dir } = createTestWorkspace('weekly-exhaustion-default');
  const res = runAgentBaton(['--tier', 'high', '--task', 'Migrate schema'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:quota_exceeded,gemini:weekly_limit' },
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
  const res = runAgentBaton(['--tier', 'low', '--task', 'Update docs'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:weekly_limit,gemini:weekly_limit' },
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
  const res = runAgentBaton(['--tier', 'high', '--task', 'Fix race condition'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:short_limit,claude:short_limit,gemini:short_limit' },
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
  const res = runAgentBaton(['--tier', 'high', '--task', 'Auto resume task'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:short_limit_once,claude:short_limit_fast,gemini:short_limit_fast' },
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
  const res = runAgentBaton(['--tier', 'low', '--task', 'Still exhausted'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:short_limit_fast,claude:short_limit_fast,gemini:short_limit_fast' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /next_action=planner_takeover reason=auto_wait_timeout/);
});

test('9. Normal code error returns exit 1 immediately WITHOUT failing over', () => {
  const { dir } = createTestWorkspace('normal-error');
  const res = runAgentBaton(['--tier', 'high', '--task', 'Broken build'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:error,claude:ok,gemini:ok' },
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /RESULT exit=1 reason=normal_error executor=codex/);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=claude/);
});

test('10. --executor forces a single executor without unintended chain failover', () => {
  const { dir } = createTestWorkspace('forced-executor');
  const res = runAgentBaton(['--tier', 'high', '--executor', 'claude', '--task', 'Forced run'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok,claude:short_limit,gemini:ok' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=codex/);
  assert.doesNotMatch(res.stderr, /DISPATCH executor=gemini/);
  assert.match(res.stderr, /executors=claude:short_limit/);
});

test('11. Timeout enforcement terminates hung process group and returns exit 1', () => {
  const { dir } = createTestWorkspace('timeout-check', { timeout_seconds: 1 });
  const res = runAgentBaton(['--tier', 'low', '--task', 'Hung job'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:hang,claude:ok' },
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
  const res = runAgentBaton(['--tier', 'low', '--task', 'Skip missing CLI'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'claude:ok' },
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
  const res = runAgentBaton(['--tier', 'high', '--task', trickyTask], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok' },
  });
  assert.equal(res.status, 0, res.stderr);
  const payload = parseMockJson(res.stdout);
  assert.equal(payload.task, trickyTask);
});

test('14. Recursion guard blocks Executor from calling agent-baton recursively', () => {
  const { dir } = createTestWorkspace('recursion-guard');
  const res = runAgentBaton(['--tier', 'low', '--task', 'Attempt nested dispatch'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:try_nested' },
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /Nested agent-baton invocation blocked/);
});

test('15. Cooldown state skips exhausted executor on next call until --reset-state', () => {
  const { dir } = createTestWorkspace('cooldown-memory');

  const run1 = runAgentBaton(['--tier', 'low', '--task', 'Task 1'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:weekly_limit,claude:ok' },
  });
  assert.equal(run1.status, 0, run1.stderr);

  const run2 = runAgentBaton(['--tier', 'low', '--task', 'Task 2'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok,claude:ok' },
  });
  assert.equal(run2.status, 0, run2.stderr);
  assert.match(run2.stderr, /SKIP codex: active weekly_limit cooldown/);
  assert.equal(parseMockJson(run2.stdout).executor, 'claude');

  const reset = runAgentBaton(['--reset-state'], { cwd: dir });
  assert.equal(reset.status, 0, reset.stderr);

  const run3 = runAgentBaton(['--tier', 'low', '--task', 'Task 3'], {
    cwd: dir,
    env: { AGENT_BATON_MOCK_BEHAVIOR: 'codex:ok,claude:ok' },
  });
  assert.equal(run3.status, 0, run3.stderr);
  assert.equal(parseMockJson(run3.stdout).executor, 'codex');
});

test('16. Built-in --dry-run and --mock failover modes succeed', () => {
  const dry = runAgentBaton(['--dry-run', '--tier', 'high', '--task', 'Preview relay'], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /agent-baton Dry Run/);
  assert.match(dry.stdout, /\[codex\]/);

  const mock = runAgentBaton(['--mock', 'failover', '--tier', 'high', '--task', 'Demo relay'], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(mock.status, 0, mock.stderr);
  assert.match(mock.stderr, /HANDOFF codex \(short_limit/);
  assert.equal(parseMockJson(mock.stdout).executor, 'claude');
});

test('17. `agent-baton init` initializes current working directory with zero args', () => {
  const dir = path.join(tmpBase, 'init-cwd');
  fs.mkdirSync(dir, { recursive: true });

  const res = runAgentBaton(['init'], { cwd: dir });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'agent-baton.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agent-baton', 'WORKFLOW.md')));
  assert.ok(fs.existsSync(path.join(dir, 'PLAN.md')));
  assert.ok(fs.existsSync(path.join(dir, '.agent', 'rules', 'agent-baton.md')));
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));

  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.agent-baton\/logs\//);
  assert.match(gitignore, /\.agent-baton\/\*\.json/);
});

test('18. `agent-baton init` preserves existing CLAUDE.md and updates marker block idempotently', () => {
  const dir = path.join(tmpBase, 'init-idempotent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Custom Rules\nAlways use strict mode.\n', 'utf8');

  const r1 = runAgentBaton(['init'], { cwd: dir });
  assert.equal(r1.status, 0, r1.stderr);

  // Customize PLAN.md to verify second run skips overwriting it
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Custom Plan\n', 'utf8');

  const r2 = runAgentBaton(['init'], { cwd: dir });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8'), '# Custom Plan\n');

  const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /# My Custom Rules/);
  assert.match(claudeMd, /Always use strict mode\./);
  const startMatches = claudeMd.match(/<!-- agent-baton:start -->/g) || [];
  assert.equal(startMatches.length, 1, 'Marker block should appear exactly once after repeated init');
});

test('19. `agent-baton init --adapter antigravity` installs only Antigravity adapter', () => {
  const dir = path.join(tmpBase, 'init-antigravity-only');
  fs.mkdirSync(dir, { recursive: true });

  const res = runAgentBaton(['init', '--adapter', 'antigravity'], { cwd: dir });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.agent', 'rules', 'agent-baton.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'settings.json')));
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
fs.rmSync(path.join(PROJECT_ROOT, '.agent-baton'), { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed (total ${tests.length})`);
process.exit(failed > 0 ? 1 : 0);
