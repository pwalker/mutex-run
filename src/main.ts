#!/usr/bin/env node
import { execa } from "execa";
import lockfile from "proper-lockfile";
import { defineCommand, runMain } from "citty";
import { ensureFile, splitAtDoubleDash } from "./utils";
import { dirname, resolve } from "node:path";
import { unlink } from "node:fs/promises";
import ora from "ora";
import * as colors from "yoctocolors";

// Logger helper to simplify verbose output
function createLogger(verbose: boolean, useColor: boolean) {
  // Create identity function for no-color mode
  const identity = (str: any) => String(str);

  // Use colors or identity functions based on useColor flag
  const c = useColor
    ? colors
    : {
        dim: identity,
        cyan: identity,
        green: identity,
        red: identity,
        yellow: identity,
      };

  return {
    verbose: (...args: any[]) => {
      if (verbose) {
        console.error(c.dim("[mutex-run]"), ...args);
      }
    },
    info: (...args: any[]) => {
      console.error(c.cyan("[mutex-run]"), ...args);
    },
    success: (...args: any[]) => {
      console.error(c.green("[mutex-run]"), ...args);
    },
    error: (...args: any[]) => {
      console.error(c.red("[mutex-run]"), ...args);
    },
    colors: c,
  };
}

const main = defineCommand({
  meta: {
    name: "mutex-run",
    version: "0.0.1",
    description: "Run just one thing at a time!",
  },
  args: {
    lock: {
      type: "string",
      description: "Lock file path (relative or absolute).",
      default: ".mutex-run.lock",
    },
    verbose: {
      type: "boolean",
      description: "Print extra diagnostics.",
      default: false,
    },
    "no-color": {
      type: "boolean",
      description: "Disable colored output.",
      default: process.env.CI === "true",
    },
    wait: {
      type: "boolean",
      description: "Wait for lock instead of failing immediately (default: true, waits ~1 hour).",
      default: true,
    },
    timeout: {
      type: "string",
      description: "Overall timeout in milliseconds (0 = no timeout).",
      default: "0",
    },
    "stale-timeout": {
      type: "string",
      description: "Consider locks older than this stale (milliseconds).",
      default: "600000", // 10 minutes
    },
  },
  async run({ args, rawArgs }) {
    const { head, tail } = splitAtDoubleDash(rawArgs);

    // Create logger with verbose and color settings
    const log = createLogger(args.verbose, !args["no-color"]);

    // Parse numeric arguments
    const timeout = parseInt(args.timeout, 10);
    const staleTimeout = parseInt(args["stale-timeout"], 10);

    // Retry configuration (hardcoded defaults)
    const retryInterval = 1000; // 1 second
    const maxRetryInterval = 3000; // 3 seconds
    const factor = 1.1;

    // Calculate retry count based on wait flag
    // If wait=true, retry for ~1 hour (3600000ms / maxRetryInterval)
    // If wait=false, fail immediately (retries=0)
    const retries = args.wait ? Math.floor(3600000 / maxRetryInterval) : 0;

    // If there is no "--" in the args, assume that everything is the command
    const childArgv = tail.length === 0 ? head : tail;

    // Resolve lock path and ensure the lock target exists.
    // proper-lockfile prefers locking an existing file/directory.
    const lockPath = resolve(args.lock);
    await ensureFile(lockPath);

    let release: undefined | (() => Promise<void>);
    const cleanup = async (signal?: NodeJS.Signals) => {
      try {
        log.verbose("cleanup start", signal ? `(${signal})` : "");
        if (release) await release();
        log.verbose("lock released");
        await unlink(lockPath);
        log.verbose("lockfile removed");
      } catch (err) {
        log.verbose("cleanup error:", err);
        // Errors during cleanup are non-fatal, but we log them in verbose mode
      }
    };

    // Acquire lock (wait or fail-fast)
    // Create spinner for lock acquisition (only if not verbose and color is enabled)
    const spinner =
      args.verbose || args["no-color"]
        ? null
        : ora({
            text: `Acquiring lock at ${lockPath}`,
            color: "cyan",
          }).start();

    // Show simple message if no-color is enabled
    if (!args.verbose && args["no-color"]) {
      log.info(`Acquiring lock...`);
    }

    try {
      const lockOpts: Parameters<typeof lockfile.lock>[1] = {
        realpath: false, // allow locking a path we just created
        stale: staleTimeout, // auto-clear stale locks
        retries: args.wait
          ? {
              retries: retries,
              factor: factor,
              minTimeout: retryInterval,
              maxTimeout: maxRetryInterval,
            }
          : 0,
      };

      log.verbose(`acquiring lock at ${lockPath}`);
      if (args.wait) {
        log.verbose(
          `will wait for lock (timeout=${timeout}ms, max wait time ~${Math.floor(retries * maxRetryInterval / 60000)}min)`,
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

      if (spinner) {
        spinner.succeed("Lock acquired");
      } else if (!args.verbose && args["no-color"]) {
        log.success("Lock acquired");
      }
      log.verbose("lock acquired");
    } catch (err) {
      if (spinner) {
        spinner.fail("Failed to acquire lock");
      }
      log.error(`Failed to acquire lock at: ${lockPath}`);
      log.info("");
      log.info("This could mean:");
      log.info("  - Another instance is currently running");
      log.info("  - A stale lock exists (consider adjusting --stale-timeout)");
      log.info("  - Insufficient permissions to create/access the lock file");
      log.info("");
      log.info(`Try: mutex-run --verbose --lock ${lockPath} -- <command>`);
      log.verbose("");
      log.verbose("Error details:");
      log.verbose(String(err));
      process.exit(1);
    }

    // Validate command was provided
    if (childArgv.length === 0) {
      log.error("No command specified");
      log.info("Usage: mutex-run [options] -- <command> [args...]");
      log.info("Example: mutex-run --verbose -- echo 'hello world'");
      await cleanup();
      process.exit(1);
    }

    // Launch child command
    const childCmd = childArgv[0]!;
    const childArgs = childArgv.slice(1);

    log.verbose(`exec: ${childCmd} ${childArgs.join(" ")}`);

    try {
      const child = execa(childCmd, childArgs, {
        stdio: "inherit",
        shell: process.platform === "win32", // helps Windows resolve .cmd and builtins
      });

      // If parent receives a signal, forward to child
      const forward = (sig: NodeJS.Signals) => {
        try {
          child.kill(sig);
        } catch (err) {
          log.verbose(`failed to forward signal ${sig}:`, err);
          // Child may have already exited, this is non-fatal
        }
      };
      process.on("SIGINT", forward);
      process.on("SIGTERM", forward);

      const res = await child;

      await cleanup();
      process.exit(res.exitCode ?? 0);
    } catch (err: any) {
      await cleanup();

      // execa throws with short-circuit info; normalize exit code
      const code = typeof err?.exitCode === "number" ? err.exitCode : 1;
      process.exit(code);
    }
  },
});

runMain(main);
