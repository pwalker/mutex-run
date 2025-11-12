#!/usr/bin/env node
import { execa } from "execa";
import lockfile from "proper-lockfile";
import { defineCommand, runMain } from "citty";
import { ensureFile, splitAtDoubleDash } from "./utils";
import { dirname, resolve } from "node:path";
import { unlink } from "node:fs/promises";

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
    wait: {
      type: "boolean",
      description: "Wait for lock instead of failing immediately.",
      default: true,
    },
    timeout: {
      type: "string",
      description: "Overall timeout in milliseconds (0 = no timeout).",
      default: "0",
    },
    retries: {
      type: "string",
      description: "Maximum retry attempts (0 = a lot).",
      default: "0",
    },
    "retry-interval": {
      type: "string",
      description: "Initial retry interval in milliseconds.",
      default: "1000",
    },
    "max-retry-interval": {
      type: "string",
      description: "Maximum retry interval in milliseconds.",
      default: "3000",
    },
    factor: {
      type: "string",
      description: "Scaling factor for retry interval",
      default: "1.1",
    },
    "stale-timeout": {
      type: "string",
      description: "Consider locks older than this stale (milliseconds).",
      default: "600000", // 10 minutes
    },
  },
  async run({ args, rawArgs }) {
    const { head, tail } = splitAtDoubleDash(rawArgs);

    // Parse numeric arguments
    const timeout = parseInt(args.timeout, 10);
    const retries = parseInt(args.retries, 10);
    const retryInterval = parseInt(args["retry-interval"], 10);
    const maxRetryInterval = parseInt(args["max-retry-interval"], 10);
    const staleTimeout = parseInt(args["stale-timeout"], 10);
    const factor = parseFloat(args["factor"]);

    // If there is no "--" in the args, assume that everything is the command
    const childArgv = tail.length === 0 ? head : tail;

    // Resolve lock path and ensure the lock target exists.
    // proper-lockfile prefers locking an existing file/directory.
    const lockPath = resolve(args.lock);
    await ensureFile(lockPath);

    let release: undefined | (() => Promise<void>);
    const cleanup = async (signal?: NodeJS.Signals) => {
      try {
        if (args.verbose)
          console.error(
            "[mutex-run] cleanup start",
            signal ? `(${signal})` : "",
          );
        if (release) await release();
        if (args.verbose) console.error("[mutex-run] lock released");
        await unlink(lockPath);
        if (args.verbose) console.error("[mutex-run] lockfile removed");
      } catch (err) {
        if (args.verbose) {
          console.error("[mutex-run] cleanup error:", err);
        }
        // Errors during cleanup are non-fatal, but we log them in verbose mode
      }
    };

    // Acquire lock (wait or fail-fast)
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

      if (args.verbose) {
        console.error(`[mutex-run] acquiring lock at ${lockPath}`);
        if (args.wait) {
          console.error(
            `[mutex-run] will wait for lock (timeout=${timeout}ms, retries=${retries === 0 ? "infinite" : retries})`,
          );
        }
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

      if (args.verbose) {
        console.error("[mutex-run] lock acquired");
      }
    } catch (err) {
      console.error(`[mutex-run] Failed to acquire lock at: ${lockPath}`);
      console.error("[mutex-run]");
      console.error("[mutex-run] This could mean:");
      console.error("[mutex-run]   - Another instance is currently running");
      console.error(
        "[mutex-run]   - A stale lock exists (consider adjusting --stale-timeout)",
      );
      console.error(
        "[mutex-run]   - Insufficient permissions to create/access the lock file",
      );
      console.error("[mutex-run]");
      console.error(
        `[mutex-run] Try: mutex-run --verbose --lock ${lockPath} -- <command>`,
      );
      if (args.verbose) {
        console.error("[mutex-run]");
        console.error("[mutex-run] Error details:");
        console.error(String(err));
      }
      process.exit(1);
    }

    // Validate command was provided
    if (childArgv.length === 0) {
      console.error("[mutex-run] Error: No command specified");
      console.error("Usage: mutex-run [options] -- <command> [args...]");
      console.error("Example: mutex-run --verbose -- echo 'hello world'");
      await cleanup();
      process.exit(1);
    }

    // Launch child command
    const childCmd = childArgv[0]!;
    const childArgs = childArgv.slice(1);

    if (args.verbose) {
      console.error(`[mutex-run] exec: ${childCmd} ${childArgs.join(" ")}`);
    }

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
          if (args.verbose) {
            console.error(`[mutex-run] failed to forward signal ${sig}:`, err);
          }
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
