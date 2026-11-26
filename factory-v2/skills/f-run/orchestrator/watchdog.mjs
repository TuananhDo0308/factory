// Process runner with idle-timeout watchdog (kills hung dev servers / watch tests / y-n prompts).
import { spawn } from "node:child_process";

const HANG_PATTERNS = [
  { cause: "watch-mode", re: /waiting for file changes|watch mode|press .* to quit|rerun/i },
  { cause: "dev-server-foreground", re: /ready in \d+|started server on|local:\s+https?:\/\//i },
  { cause: "interactive-prompt", re: /\(y\/n\)|\[y\/N\]|press enter to continue|proceed\?/i },
  { cause: "port-in-use", re: /EADDRINUSE|address already in use/i },
];

export function classifyHang(outputTail) {
  for (const { cause, re } of HANG_PATTERNS) {
    if (re.test(outputTail)) return cause;
  }
  return "idle-timeout";
}

export function runWithWatchdog(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    stdinText = null,
    idleTimeoutMs = 8 * 60 * 1000, // 8 minutes default
    hardTimeoutMs = 25 * 60 * 1000, // 25 minutes absolute cap
    shell = false,
    onChunk = null,
  } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutCause = null;
    let settled = false;

    const killTree = () => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // already dead
      }
      setTimeout(() => {
        try {
          if (process.platform !== "win32" && child.pid) {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {
          // already dead
        }
      }, 1500).unref();
    };

    let idleTimer = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (idleTimeoutMs > 0) {
        idleTimer = setTimeout(() => {
          timedOut = true;
          const tail = (stdout + "\n" + stderr).slice(-2000);
          timeoutCause = classifyHang(tail);
          killTree();
        }, idleTimeoutMs);
        idleTimer.unref();
      }
    };

    const hardTimer =
      hardTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            timeoutCause = "hard-timeout";
            killTree();
          }, hardTimeoutMs)
        : null;
    if (hardTimer) hardTimer.unref();

    resetIdle();

    child.stdout.on("data", (buf) => {
      const s = buf.toString("utf8");
      stdout += s;
      resetIdle();
      if (onChunk) onChunk("stdout", s);
    });

    child.stderr.on("data", (buf) => {
      const s = buf.toString("utf8");
      stderr += s;
      resetIdle();
      if (onChunk) onChunk("stderr", s);
    });

    if (stdinText !== null && stdinText !== undefined) {
      child.stdin.write(stdinText);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
      const combined = (stdout + "\n" + stderr).trim();
      const lastLines = combined ? combined.split(/\r?\n/).slice(-25).join("\n") : "";
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        signal,
        timedOut,
        timeoutCause,
        stdout,
        stderr,
        lastLines,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(1, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

export function notifyMac(title, message) {
  if (process.platform !== "darwin") return;
  try {
    const safeTitle = String(title).replace(/"/g, "'");
    const safeMsg = String(message).replace(/"/g, "'").slice(0, 220);
    const child = spawn("osascript", [
      "-e",
      `display notification "${safeMsg}" with title "${safeTitle}"`,
    ], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // non-fatal
  }
}
