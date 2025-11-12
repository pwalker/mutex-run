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

### Wait with Timeout

By default, `mutex-run` waits up to 30 minutes for a lock. You can customize this:

```bash
# Wait up to 5 minutes (300000ms)
mutex-run --timeout 300000 -- turbo run build

# Wait indefinitely (no timeout)
mutex-run --timeout 0 -- turbo run build

# Fail immediately if lock is held (no waiting)
mutex-run --wait false -- turbo run build
```

### Retry Behavior

Control how `mutex-run` retries when the lock is held:

```bash
# Set retry interval to 2 seconds (default: 1000ms)
mutex-run --retry-interval 2000 -- turbo run build

# Set maximum retry interval to 5 seconds (default: 3000ms)
mutex-run --max-retry-interval 5000 -- turbo run build

# Adjust the backoff factor (default: 1.1 for minimal backoff)
mutex-run --factor 1.0 -- turbo run build  # no backoff, constant interval
mutex-run --factor 1.5 -- turbo run build  # moderate exponential backoff
```

## How It Works

1. **Lock Acquisition**: When `mutex-run` starts, it attempts to acquire a lock on the specified lock file using [proper-lockfile](https://www.npmjs.com/package/proper-lockfile)
2. **Wait/Retry**: If the lock is held by another process and `--wait` is true, it will retry with a configurable backoff strategy (default: 1 second interval with 1.1x backoff factor, capped at 3 seconds) until:
   - The lock becomes available, OR
   - The timeout is reached (if specified)
3. **Command Execution**: Once the lock is acquired, your command runs as normal
4. **Cleanup**: When the command completes (success or failure) or is interrupted by a signal (SIGINT, SIGTERM), the lock is released and the lock file is removed.

## Exit Codes

`mutex-run` forwards the exit code from your command:

- **0**: Command succeeded
- **1**: Failed to acquire lock or no command specified
- **N**: Command exited with code N

## Troubleshooting

### Lock Not Released

If a process crashes without cleaning up, locks older than 5 minutes are automatically considered stale and can be taken over. You can adjust this with `--stale-timeout`:

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

### Timeout Errors

If your command takes longer than the default 30 minutes, increase the timeout:

```bash
mutex-run --timeout 3600000 -- turbo run build  # 60 minutes
```
