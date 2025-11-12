# mutex-run

A CLI utility that ensures only one command runs at a time using file-based locking.

## Why?

Sometimes you only want a single command running at a time! My use case was in some CI scripts, I basically wanted to make multiple calls to `pnpm build`, but they would compete & thrash each other. With this script, only one `pnpm build` runs at a time, and I don't need to coordinate this in my CI script, I just get to wait.

## Installation

```bash
npm install -g mutex-run
# or
pnpm add -g mutex-run
# or
npx mutex-run [options] -- <command> [args...]
```

## Usage

### Basic Usage

Wrap any command with `mutex-run` to ensure exclusive execution:

```bash
mutex-run -- turbo run build
```

### Custom Lock File

Specify a custom lock file path to control which commands wait for each other:

```bash
# All commands using this lock file will wait for each other
mutex-run --lock /tmp/my-build.lock -- turbo run build
```

### Wait Behavior

By default, `mutex-run` waits up to approximately 1 hour for a lock. You can customize this:

```bash
# Wait up to 5 minutes (300000ms)
mutex-run --timeout 300000 -- turbo run build

# No timeout (wait the full ~1 hour)
mutex-run --timeout 0 -- turbo run build

# Fail immediately if lock is held (no waiting)
mutex-run --no-wait -- turbo run build
```

## Programmatic API

You can also use `mutex-run` as a library in your Node.js/TypeScript projects:

### Basic Usage

```typescript
import { mutexRun } from "mutex-run";

// Simple usage with command string
const result = await mutexRun("pnpm build");
console.log(`Exit code: ${result.exitCode}`);

// Or with command array
const result = await mutexRun(["pnpm", "build"]);
```

### With Options

```typescript
import { mutexRun } from "mutex-run";

const result = await mutexRun(["turbo", "run", "build"], {
  lockFile: ".my-custom.lock",
  wait: true,
  timeout: 30000, // 30 seconds
  staleTimeout: 600000, // 10 minutes
  cwd: "/path/to/project",
  env: { NODE_ENV: "production" },
  logger: console, // Optional logger for diagnostics
});

if (result.exitCode === 0) {
  console.log("Build succeeded!");
} else {
  console.error(`Build failed with code ${result.exitCode}`);
}
```

### Capturing Output

```typescript
import { mutexRun } from "mutex-run";

const result = await mutexRun(["echo", "hello world"], {
  stdio: "pipe", // Capture stdout/stderr
});

console.log(result.stdout); // "hello world"
console.log(result.stderr);
console.log(result.exitCode); // 0
```

### Custom Logger

```typescript
import { mutexRun } from "mutex-run";

const result = await mutexRun(["pnpm", "build"], {
  logger: {
    log: (...args) => console.log("[mutex]", ...args),
    error: (...args) => console.error("[mutex]", ...args),
  },
});
```

### TypeScript Types

```typescript
import type { MutexRunOptions, MutexRunResult, Logger } from "mutex-run";

const options: MutexRunOptions = {
  lockFile: ".my-lock",
  wait: true,
  timeout: 60000,
};

const result: MutexRunResult = await mutexRun("pnpm build", options);
```

## How It Works

1. **Lock Acquisition**: When `mutex-run` starts, it attempts to acquire a lock on the specified lock file using [proper-lockfile](https://www.npmjs.com/package/proper-lockfile)
2. **Wait/Retry**: If the lock is held by another process and `--wait` is true (default), it will retry with a gentle backoff strategy (1-3 second intervals) for up to ~1 hour until:
   - The lock becomes available, OR
   - The timeout is reached (if specified)
   - If `--no-wait` is specified, it fails immediately
3. **Command Execution**: Once the lock is acquired, your command runs as normal
4. **Cleanup**: When the command completes (success or failure) or is interrupted by a signal (SIGINT, SIGTERM), the lock is released and the lock file is removed.

## Exit Codes

`mutex-run` forwards the exit code from your command:

- **0**: Command succeeded
- **1**: Failed to acquire lock or no command specified
- **N**: Command exited with code N

## Troubleshooting

### Lock Not Released

If a process crashes without cleaning up, locks older than 10 minutes are automatically considered stale and can be taken over. You can adjust this with `--stale-timeout`:

```bash
mutex-run --stale-timeout 60000 -- turbo run build  # 1 minute
```

### Permission Errors

Ensure the lock file path is writable:

```bash
# Use /tmp for cross-user locks
mutex-run --lock /tmp/my-build.lock -- turbo run build

# Or use a project-specific path
mutex-run --lock ./.mutex-run/build.lock -- turbo run build
```

### Color Output

By default, `mutex-run` provides colorful output with a spinner while waiting for a lock. Colors are automatically disabled in CI environments or can be manually disabled with `--no-color`.
