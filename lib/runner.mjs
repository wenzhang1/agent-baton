/**
 * Cross-platform (macOS/Linux) child-process runner with live output streaming,
 * structured log persistence, process-group timeout termination, and recursion guard env.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Terminate a child process and its entire process group safely on POSIX.
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} signal
 */
function killProcessGroup(child, signal) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process already exited.
    }
  }
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Execute a resolved command with timeout and full stdout/stderr logging.
 */
export function runExecutorCommand({
  bin,
  args,
  display,
  executor,
  tier,
  model,
  effort,
  timeoutSeconds,
  logDir,
  cwd = process.cwd(),
  extraEnv = {},
}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${fileTimestamp()}-${executor}-${tier}.log`);

    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
    logStream.write(
      [
        `# batonflow execution log`,
        `timestamp: ${new Date().toISOString()}`,
        `executor:  ${executor}`,
        `tier:      ${tier}`,
        `model:     ${model}`,
        `effort:    ${effort || 'default'}`,
        `timeout:   ${timeoutSeconds}s`,
        `command:   ${display}`,
        `--- OUTPUT ---`,
        '',
      ].join('\n')
    );

    const currentDepth = Number.parseInt(process.env.BATONFLOW_DEPTH || '0', 10) || 0;
    const childEnv = {
      ...process.env,
      ...extraEnv,
      BATONFLOW_ROLE: 'executor',
      BATONFLOW_DEPTH: String(currentDepth + 1),
      BATONFLOW_EXECUTOR: executor,
      BATONFLOW_TIER: tier,
      BATONFLOW_MODEL: model,
      BATONFLOW_EFFORT: effort || '',
    };

    let stdoutBuf = '';
    let stderrBuf = '';
    let combinedBuf = '';
    let timedOut = false;
    let notFound = false;
    let settled = false;
    let killGraceTimer = null;

    const child = spawn(bin, args, {
      cwd,
      env: childEnv,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onParentSignal = (sig) => {
      killProcessGroup(child, sig);
    };
    process.on('SIGINT', onParentSignal);
    process.on('SIGTERM', onParentSignal);

    const timeoutMs = Math.max(100, Math.round(timeoutSeconds * 1000));
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      const msg = `\n[batonflow] TIMEOUT: executor "${executor}" exceeded ${timeoutSeconds}s, terminating process group...\n`;
      process.stderr.write(msg);
      logStream.write(msg);
      combinedBuf += msg;

      killProcessGroup(child, 'SIGTERM');
      killGraceTimer = setTimeout(() => {
        killProcessGroup(child, 'SIGKILL');
      }, 3000);
      killGraceTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;

      clearTimeout(timeoutTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      process.off('SIGINT', onParentSignal);
      process.off('SIGTERM', onParentSignal);

      const durationMs = Date.now() - startTime;
      logStream.write(
        [
          '',
          `--- END ---`,
          `exit_code:   ${exitCode}`,
          `signal:      ${signal || 'none'}`,
          `timed_out:   ${timedOut}`,
          `not_found:   ${notFound}`,
          `duration_ms: ${durationMs}`,
          '',
        ].join('\n')
      );
      logStream.end();

      resolve({
        ok: exitCode === 0 && !timedOut && !notFound,
        exitCode: exitCode ?? 1,
        signal: signal || null,
        timedOut,
        notFound,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        output: combinedBuf,
        durationMs,
        logPath,
      });
    };

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutBuf += text;
      combinedBuf += text;
      process.stdout.write(text);
      logStream.write(text);
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuf += text;
      combinedBuf += text;
      process.stderr.write(text);
      logStream.write(text);
    });

    child.on('error', (err) => {
      const msg = `[batonflow] SPAWN_ERROR (${executor}): ${err.message}\n`;
      if (err.code === 'ENOENT') {
        notFound = true;
      }
      stderrBuf += msg;
      combinedBuf += msg;
      process.stderr.write(msg);
      logStream.write(msg);
      finish(notFound ? 127 : 1, null);
    });

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(124, signal);
      } else if (code === null) {
        finish(1, signal);
      } else {
        finish(code, signal);
      }
    });
  });
}
