/**
 * Cross-platform (macOS/Linux) child-process runner with live output streaming,
 * structured log persistence, dual hard + idle process-group timeout termination,
 * and recursion guard env.
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
 * Execute a resolved command with hard total timeout + optional idle (no-output) timeout
 * and full stdout/stderr logging.
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
  idleTimeoutSeconds = 0,
  logDir,
  cwd = process.cwd(),
  extraEnv = {},
}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${fileTimestamp()}-${executor}-${tier}.log`);

    const idleEnabled = typeof idleTimeoutSeconds === 'number' && idleTimeoutSeconds > 0;

    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
    logStream.write(
      [
        `# batonflow execution log`,
        `timestamp:    ${new Date().toISOString()}`,
        `executor:     ${executor}`,
        `tier:         ${tier}`,
        `model:        ${model}`,
        `effort:       ${effort || 'default'}`,
        `timeout:      ${timeoutSeconds}s`,
        `idle_timeout: ${idleEnabled ? `${idleTimeoutSeconds}s` : 'disabled'}`,
        `command:      ${display}`,
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
    let timeoutReason = null;
    let notFound = false;
    let settled = false;
    let killGraceTimer = null;
    let idleTimer = null;

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

    const triggerTermination = (reason, msg) => {
      if (timedOut || settled) return;
      timedOut = true;
      timeoutReason = reason;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      process.stderr.write(msg);
      logStream.write(msg);
      combinedBuf += msg;

      killProcessGroup(child, 'SIGTERM');
      killGraceTimer = setTimeout(() => {
        killProcessGroup(child, 'SIGKILL');
      }, 3000);
      killGraceTimer.unref?.();
    };

    const timeoutMs = Math.max(100, Math.round(timeoutSeconds * 1000));
    const timeoutTimer = setTimeout(() => {
      triggerTermination(
        'timeout',
        `\n[batonflow] TIMEOUT: executor "${executor}" exceeded total timeout of ${timeoutSeconds}s, terminating process group...\n`
      );
    }, timeoutMs);
    timeoutTimer.unref?.();

    const idleTimeoutMs = idleEnabled ? Math.max(100, Math.round(idleTimeoutSeconds * 1000)) : 0;
    const resetIdleTimer = () => {
      if (!idleEnabled || timedOut || settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        triggerTermination(
          'idle_timeout',
          `\n[batonflow] IDLE_TIMEOUT: executor "${executor}" produced no output for ${idleTimeoutSeconds}s, terminating process group...\n`
        );
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };
    resetIdleTimer();

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;

      clearTimeout(timeoutTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      process.off('SIGINT', onParentSignal);
      process.off('SIGTERM', onParentSignal);

      const durationMs = Date.now() - startTime;
      logStream.write(
        [
          '',
          `--- END ---`,
          `exit_code:      ${exitCode}`,
          `signal:         ${signal || 'none'}`,
          `timed_out:      ${timedOut}`,
          `timeout_reason: ${timeoutReason || 'none'}`,
          `not_found:      ${notFound}`,
          `duration_ms:    ${durationMs}`,
          '',
        ].join('\n')
      );
      logStream.end();

      resolve({
        ok: exitCode === 0 && !timedOut && !notFound,
        exitCode: exitCode ?? 1,
        signal: signal || null,
        timedOut,
        timeoutReason,
        notFound,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        output: combinedBuf,
        durationMs,
        logPath,
      });
    };

    child.stdout?.on('data', (chunk) => {
      resetIdleTimer();
      const text = chunk.toString('utf8');
      stdoutBuf += text;
      combinedBuf += text;
      process.stdout.write(text);
      logStream.write(text);
    });

    child.stderr?.on('data', (chunk) => {
      resetIdleTimer();
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
