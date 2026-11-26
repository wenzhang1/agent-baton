#!/usr/bin/env node
/**
 * Programmable Mock AI CLI Executor for zero-API-cost testing of batonflow.
 *
 * Controlled via BATONFLOW_MOCK_BEHAVIOR="codex:short_limit,claude:ok,gemini:weekly_limit"
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN_PATH = path.resolve(__dirname, '..', 'bin', 'batonflow');

function parseSimpleArgs(argv) {
  const out = { executor: 'unknown', model: 'unknown', effort: '', task: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--executor') out.executor = argv[++i] || '';
    else if (argv[i] === '--model') out.model = argv[++i] || '';
    else if (argv[i] === '--effort') out.effort = argv[++i] || '';
    else if (argv[i] === '--task') out.task = argv[++i] || '';
  }
  return out;
}

function getBehavior(executor) {
  const raw = process.env.BATONFLOW_MOCK_BEHAVIOR || '';
  for (const entry of raw.split(',')) {
    const [name, mode] = entry.split(':').map((s) => s.trim());
    if (name === executor && mode) {
      return mode;
    }
  }
  return 'ok';
}

function incrementCallCount(executor) {
  const counterFile = process.env.BATONFLOW_MOCK_STATE_FILE;
  if (!counterFile) return 1;
  let data = {};
  try {
    if (fs.existsSync(counterFile)) {
      data = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    }
  } catch {
    data = {};
  }
  data[executor] = (data[executor] || 0) + 1;
  fs.mkdirSync(path.dirname(counterFile), { recursive: true });
  fs.writeFileSync(counterFile, JSON.stringify(data), 'utf8');
  return data[executor];
}

const args = parseSimpleArgs(process.argv.slice(2));
const mode = getBehavior(args.executor);
const callCount = incrementCallCount(args.executor);

switch (mode) {
  case 'ok':
    console.log(
      JSON.stringify({
        mock: true,
        status: 'ok',
        executor: args.executor,
        model: args.model,
        effort: args.effort || process.env.BATONFLOW_EFFORT || null,
        callCount,
        role: process.env.BATONFLOW_ROLE || null,
        depth: process.env.BATONFLOW_DEPTH || null,
        task: args.task,
      })
    );
    process.exit(0);
    break;

  case 'short_limit':
    console.error(
      `[${args.executor}] HTTP 429 Too Many Requests: You have reached your 5-hour rate limit. Please try again in 45 minutes.`
    );
    process.exit(1);
    break;

  case 'short_limit_fast':
    console.error(
      `[${args.executor}] HTTP 429 Too Many Requests: 5-hour rate limit reached. Try again in 1 second.`
    );
    process.exit(1);
    break;

  case 'short_limit_once':
    if (callCount === 1) {
      console.error(
        `[${args.executor}] HTTP 429: 5-hour usage limit reached. Try again in 1 second.`
      );
      process.exit(1);
    } else {
      console.log(
        JSON.stringify({
          mock: true,
          status: 'ok_after_wait',
          executor: args.executor,
          model: args.model,
          callCount,
          task: args.task,
        })
      );
      process.exit(0);
    }
    break;

  case 'weekly_limit':
    console.error(
      `[${args.executor}] Error: Weekly usage limit exceeded. Your quota resets on Monday at 00:00 UTC.`
    );
    process.exit(1);
    break;

  case 'quota_exceeded':
    console.error(
      `[${args.executor}] Error: insufficient_quota — Your credit balance is too low to access the API.`
    );
    process.exit(1);
    break;

  case 'error':
    console.error(
      `[${args.executor}] SyntaxError: Unexpected token '}' in src/auth.js:42 (build failed)`
    );
    process.exit(1);
    break;

  case 'hang':
    console.log(`[${args.executor}] Starting long hung process...`);
    setTimeout(() => {
      console.log('Finished after sleep');
      process.exit(0);
    }, 10000);
    break;

  case 'try_nested': {
    const nested = spawnSync(
      process.execPath,
      [BIN_PATH, '--tier', 'low', '--task', 'nested call should be blocked'],
      { encoding: 'utf8' }
    );
    process.stdout.write(nested.stdout || '');
    process.stderr.write(nested.stderr || '');
    process.exit(nested.status === 0 ? 0 : 1);
    break;
  }

  default:
    console.error(`Unknown mock mode: ${mode}`);
    process.exit(1);
}
