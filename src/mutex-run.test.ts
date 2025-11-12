import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mutexRun } from "./mutex-run";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

describe("mutexRun API", () => {
  const testLockFile = ".test-mutex.lock";

  beforeEach(async () => {
    // Clean up any existing lock file
    if (existsSync(testLockFile)) {
      await unlink(testLockFile).catch(() => {});
    }
  });

  afterEach(async () => {
    // Clean up lock file after each test
    if (existsSync(testLockFile)) {
      await unlink(testLockFile).catch(() => {});
    }
  });

  it("should run a simple command successfully", async () => {
    const result = await mutexRun(["echo", "hello"], {
      lockFile: testLockFile,
      wait: false,
    });

    expect(result.exitCode).toBe(0);
  });

  it("should accept command as string", async () => {
    const result = await mutexRun("echo hello", {
      lockFile: testLockFile,
      wait: false,
    });

    expect(result.exitCode).toBe(0);
  });

  it("should return non-zero exit code on command failure", async () => {
    const result = await mutexRun(["sh", "-c", "exit 42"], {
      lockFile: testLockFile,
      wait: false,
    });

    expect(result.exitCode).toBe(42);
  });

  it("should throw error when no command provided", async () => {
    await expect(
      mutexRun([], {
        lockFile: testLockFile,
      })
    ).rejects.toThrow("No command specified");
  });

  it("should use provided logger", async () => {
    const logs: string[] = [];
    const mockLogger = {
      log: (...args: any[]) => logs.push(args.join(" ")),
      error: (...args: any[]) => logs.push("ERROR: " + args.join(" ")),
    };

    await mutexRun(["echo", "test"], {
      lockFile: testLockFile,
      wait: false,
      logger: mockLogger,
    });

    // Should have some log output
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((log) => log.includes("acquiring lock"))).toBe(true);
  });

  it("should handle cwd option", async () => {
    const result = await mutexRun(["pwd"], {
      lockFile: testLockFile,
      wait: false,
      cwd: "/tmp",
    });

    expect(result.exitCode).toBe(0);
  });

  it("should handle env option", async () => {
    const result = await mutexRun(["sh", "-c", "echo $TEST_VAR"], {
      lockFile: testLockFile,
      wait: false,
      env: { TEST_VAR: "test-value" },
    });

    expect(result.exitCode).toBe(0);
  });

  it("should capture stdout/stderr when stdio is pipe", async () => {
    const result = await mutexRun(["echo", "hello world"], {
      lockFile: testLockFile,
      wait: false,
      stdio: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout?.trim()).toBe("hello world");
  });

  it("should not capture stdout/stderr when stdio is inherit", async () => {
    const result = await mutexRun(["echo", "hello"], {
      lockFile: testLockFile,
      wait: false,
      stdio: "inherit",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBeUndefined();
  });

  it("should use default lock file when not specified", async () => {
    const result = await mutexRun(["echo", "test"], {
      wait: false,
    });

    expect(result.exitCode).toBe(0);

    // Clean up default lock file
    if (existsSync(".mutex-run.lock")) {
      await unlink(".mutex-run.lock").catch(() => {});
    }
  });

  it("should respect wait=false and fail immediately if lock held", async () => {
    // First, acquire the lock with a long-running command
    const firstPromise = mutexRun(["sleep", "2"], {
      lockFile: testLockFile,
      wait: false,
    });

    // Wait a bit to ensure first command has acquired the lock
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to acquire the same lock without waiting
    await expect(
      mutexRun(["echo", "test"], {
        lockFile: testLockFile,
        wait: false,
        timeout: 100,
      })
    ).rejects.toThrow("Failed to acquire lock");

    // Wait for first command to complete
    await firstPromise;
  });
});
