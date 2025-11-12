# mutex-run

A CLI utility that ensures only one command runs at a time using file-based locking.

## Why?

In CI environments, parallel jobs can thrash when running the same command simultaneously (e.g., multiple `turbo run build` tasks). **mutex-run** uses file-based locking to ensure they wait for each other instead of competing for resources, leading to more reliable builds and better resource utilization.

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

By default, `mutex-run` waits up to 10 minutes for a lock. You can customize this:

```bash
# Wait up to 5 minutes (300000ms)
mutex-run --timeout 300000 -- turbo run build

# Wait indefinitely (no timeout)
mutex-run --timeout 0 -- turbo run build

# Fail immediately if lock is held (no waiting)
mutex-run --wait false -- turbo run build
```

### Verbose Mode

See detailed diagnostic information about lock acquisition and release:

```bash
mutex-run --verbose -- turbo run build
```

## How It Works

1. **Lock Acquisition**: When `mutex-run` starts, it attempts to acquire a lock on the specified lock file using [proper-lockfile](https://www.npmjs.com/package/proper-lockfile)
2. **Wait/Retry**: If the lock is held by another process and `--wait` is true, it will retry with exponential backoff until:
   - The lock becomes available, OR
   - The timeout is reached (if specified)
3. **Command Execution**: Once the lock is acquired, your command runs as normal
4. **Cleanup**: When the command completes (success or failure) or is interrupted by a signal (SIGINT, SIGTERM), the lock is released and the lock file is removed
5. **Stale Lock Handling**: If a lock file is older than the stale timeout (default 5 minutes), it's automatically considered stale and can be taken over

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

If your command takes longer than 10 minutes, increase the timeout:

```bash
mutex-run --timeout 1800000 -- turbo run build  # 30 minutes
```

### Verbose Debugging

Use `--verbose` to see detailed lock acquisition information:

```bash
mutex-run --verbose -- your-command
```

Output:

```
[mutex-run] acquiring lock at /path/to/.mutex-run.lock
[mutex-run] will wait for lock (timeout=600000ms, retries=infinite)
[mutex-run] lock acquired
[mutex-run] exec: your-command
[mutex-run] cleanup start
[mutex-run] lock released
[mutex-run] lockfile removed
```
