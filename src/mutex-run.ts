import { execa, type ExecaError } from "execa";
import lockfile from "proper-lockfile";
import { ensureFile } from "./utils";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";

/**
 * Simple logger interface compatible with console
 */
export interface Logger {
  log(...args: any[]): void;
  error?(...args: any[]): void;
  info?(...args: any[]): void;
}

/**
 * Options for mutexRun
 */
export interface MutexRunOptions {
  /**
   * Lock file path (relative or absolute)
   * @default ".mutex-run.lock"
   */
  lockFile?: string;

  /**
   * Wait for lock instead of failing immediately
   * @default true
   */
  wait?: boolean;

  /**
   * Overall timeout in milliseconds (0 = no timeout)
   * @default 0
   */
  timeout?: number;

  /**
   * Consider locks older than this stale (milliseconds)
   * @default 600000 (10 minutes)
   */
  staleTimeout?: number;

  /**
   * Working directory for command execution
   */
  cwd?: string;

  /**
   * Environment variables for command execution
   */
  env?: Record<string, string>;

  /**
   * Optional logger for diagnostics (must have at least a log method)
   */
  logger?: Logger;

  /**
   * Use shell to execute command (auto-enabled on Windows)
   */
  shell?: boolean;

  /**
   * Stdio configuration for child process
   * @default "inherit"
   */
  stdio?: "inherit" | "pipe" | "ignore";
}

/**
 * Result of mutexRun execution
 */
export interface MutexRunResult {
  /**
   * Exit code of the executed command
   */
  exitCode: number;

  /**
   * stdout output (only if stdio is "pipe")
   */
  stdout?: string;

  /**
   * stderr output (only if stdio is "pipe")
   */
  stderr?: string;
}

/**
 * Run a command with file-based mutual exclusion
 *
 * @param command - Command to execute (string or array of [command, ...args])
 * @param options - Configuration options
 * @returns Promise resolving to command result with exit code
 *
 * @example
 * ```ts
 * // Simple usage
 * await mutexRun("pnpm build");
 *
 * // With options
 * await mutexRun(["pnpm", "build"], {
 *   lockFile: ".my-lock",
 *   wait: true,
 *   timeout: 30000,
 *   logger: console
 * });
 * ```
 */
export async function mutexRun(
  command: string | string[],
  options: MutexRunOptions = {},
): Promise<MutexRunResult> {
  // Parse command
  const isStringCommand = typeof command === "string";
  const cmdArray = isStringCommand ? [command] : command;
  if (cmdArray.length === 0) {
    throw new Error("No command specified");
  }

  const childCmd = cmdArray[0]!;
  const childArgs = cmdArray.slice(1);

  // Set defaults
  const lockFile = options.lockFile ?? ".mutex-run.lock";
  const wait = options.wait ?? true;
  const timeout = options.timeout ?? 0;
  const staleTimeout = options.staleTimeout ?? 600000; // 10 minutes
  const stdio = options.stdio ?? "inherit";
  // If command is a string, use shell by default to parse it
  // Otherwise, only use shell on Windows
  const shell =
    options.shell ?? (isStringCommand || process.platform === "win32");

  // Create no-op logger if none provided
  const log = options.logger ?? {
    log: () => {},
    error: () => {},
    info: () => {},
  };

  // Retry configuration (hardcoded defaults)
  const retryInterval = 1000; // 1 second
  const maxRetryInterval = 3000; // 3 seconds
  const factor = 1.1;

  // Calculate retry count based on wait flag
  // If wait=true, retry for ~1 hour (3600000ms / maxRetryInterval)
  // If wait=false, fail immediately (retries=0)
  const retries = wait ? Math.floor(3600000 / maxRetryInterval) : 0;

  // Resolve lock path and ensure the lock target exists
  const lockPath = resolve(lockFile);
  await ensureFile(lockPath);

  let release: undefined | (() => Promise<void>);
  const cleanup = async (signal?: NodeJS.Signals) => {
    try {
      log.log?.("cleanup start", signal ? `(${signal})` : "");
      if (release) await release();
      log.log?.("lock released");
      await unlink(lockPath);
      log.log?.("lockfile removed");
    } catch (err) {
      log.log?.("cleanup error:", err);
      // Errors during cleanup are non-fatal
    }
  };

  // Acquire lock
  try {
    const lockOpts: Parameters<typeof lockfile.lock>[1] = {
      realpath: false, // allow locking a path we just created
      stale: staleTimeout, // auto-clear stale locks
      retries: wait
        ? {
            retries: retries,
            factor: factor,
            minTimeout: retryInterval,
            maxTimeout: maxRetryInterval,
          }
        : 0,
    };

    log.log?.(`acquiring lock at ${lockPath}`);
    if (wait) {
      log.log?.(
        `will wait for lock (timeout=${timeout}ms, max wait time ~${Math.floor((retries * maxRetryInterval) / 60000)}min)`,
      );
    }

    // Wrap lock acquisition with overall timeout if specified
    const lockPromise = lockfile.lock(lockPath, lockOpts);

    if (timeout > 0) {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Lock acquisition timeout after ${timeout}ms`)),
          timeout,
        ),
      );
      release = await Promise.race([lockPromise, timeoutPromise]);
    } else {
      release = await lockPromise;
    }

    log.log?.("lock acquired");
  } catch (err) {
    const errorMsg = `Failed to acquire lock at: ${lockPath}`;
    log.error?.(errorMsg);
    throw new Error(errorMsg, { cause: err });
  }

  // Launch child command
  log.log?.(`exec: ${childCmd} ${childArgs.join(" ")}`);

  try {
    const child = execa(childCmd, childArgs, {
      stdio,
      shell,
      cwd: options.cwd,
      env: options.env,
    });

    // If parent receives a signal, forward to child
    const forward = (sig: NodeJS.Signals) => {
      try {
        child.kill(sig);
      } catch (err) {
        log.log?.(`failed to forward signal ${sig}:`, err);
        // Child may have already exited, this is non-fatal
      }
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);

    const res = await child;

    await cleanup();

    return {
      exitCode: res.exitCode ?? 0,
      stdout: stdio === "pipe" ? res.stdout : undefined,
      stderr: stdio === "pipe" ? res.stderr : undefined,
    };
  } catch (err: any) {
    await cleanup();

    // execa throws with exit code info; normalize and return
    const exitCode = typeof err?.exitCode === "number" ? err.exitCode : 1;

    return {
      exitCode,
      stdout: stdio === "pipe" ? err?.stdout : undefined,
      stderr: stdio === "pipe" ? err?.stderr : undefined,
    };
  }
}
