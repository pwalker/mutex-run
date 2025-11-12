#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { splitAtDoubleDash } from "./utils";
import { resolve } from "node:path";
import ora from "ora";
import { createLogger } from "./logger";
import { mutexRun } from "./mutex-run";

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
      description:
        "Wait for lock instead of failing immediately (default: true, waits ~1 hour).",
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

    // If there is no "--" in the args, assume that everything is the command
    const childArgv = tail.length === 0 ? head : tail;

    // Validate command was provided
    if (childArgv.length === 0) {
      log.error("No command specified");
      log.info("Usage: mutex-run [options] -- <command> [args...]");
      log.info("Example: mutex-run --verbose -- echo 'hello world'");
      process.exit(1);
    }

    // Resolve lock path for spinner display
    const lockPath = resolve(args.lock);

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
      // Call mutexRun API with mapped options
      const result = await mutexRun(childArgv, {
        lockFile: args.lock,
        wait: args.wait,
        timeout,
        staleTimeout,
        logger: args.verbose
          ? {
              log: (...logArgs: any[]) => log.verbose(...logArgs),
              error: (...logArgs: any[]) => log.error(...logArgs),
            }
          : undefined,
      });

      if (spinner) {
        spinner.succeed("Command completed");
      }

      process.exit(result.exitCode);
    } catch (err: any) {
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
  },
});

runMain(main);
