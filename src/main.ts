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
  },
  async run({ args, rawArgs }) {
    const { head, tail } = splitAtDoubleDash(rawArgs);

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
          console.error("[runlock] cleanup start", signal ? `(${signal})` : "");
        if (release) await release();
        if (args.verbose) console.error("[runlock] lock released");
        await unlink(lockPath);
        if (args.verbose) console.error("[runlock] lockfile removed");
      } catch {
        // ignore
      }
    };

    // Acquire lock (wait or fail-fast)
    try {
      const lockOpts: Parameters<typeof lockfile.lock>[1] = {
        realpath: false, // allow locking a path we just created
        // stale: scaleMs, // auto-clear stale locks
        // retries: args.wait
        //   ? {
        //       retries: args.retries,
        //       factor: 1.2,
        //       minTimeout: args.minTimeout,
        //       maxTimeout: args.maxTimeout,
        //     }
        //   : 0,
      };

      if (args.verbose) {
        console.error(`[runlock] acquiring lock at ${lockPath}`);
      }

      release = await lockfile.lock(lockPath, lockOpts);
    } catch (err) {
      console.error(
        "[runlock] Another run is active (or lock could not be acquired).",
      );
      if (args.verbose) console.error(String(err));
      process.exit(1);
    }

    // Launch child command
    const childCmd = childArgv[0]!;
    const childArgs = childArgv.slice(1);

    if (args.verbose) {
      console.error(`[runlock] exec: ${childCmd} ${childArgs.join(" ")}`);
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
        } catch {
          // ignore
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
