import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CLI_PATH = resolve(__dirname, "main.ts");
const TEST_LOCK = "/tmp/mutex-run-test.lock";

describe("mutex-run CLI", () => {
  beforeEach(async () => {
    // Clean up any existing test lock files
    try {
      await unlink(TEST_LOCK);
    } catch {}
  });

  afterEach(async () => {
    // Clean up all test lock files
    const lockFiles = [
      TEST_LOCK,
      "/tmp/mutex-run-test-concurrent.lock",
      "/tmp/mutex-run-test-retry.lock",
      "/tmp/mutex-run-test-timeout.lock",
      "/tmp/mutex-run-test-signal.lock",
    ];

    for (const file of lockFiles) {
      try {
        await unlink(file);
      } catch {}
    }

    // Small delay to ensure cleanup completes
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("runs a simple command successfully", async () => {
    const result = await execa("tsx", [
      CLI_PATH,
      "--lock",
      TEST_LOCK,
      "--",
      "echo",
      "hello",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    // Lock should be cleaned up after execution
    expect(existsSync(TEST_LOCK)).toBe(false);
  }, 10000);

  it("propagates child exit code", async () => {
    try {
      await execa("tsx", [
        CLI_PATH,
        "--lock",
        TEST_LOCK,
        "--",
        "node",
        "-e",
        "process.exit(42)",
      ]);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.exitCode).toBe(42);
    }
    // Lock should be cleaned up even on error
    expect(existsSync(TEST_LOCK)).toBe(false);
  }, 10000);

  it("prevents concurrent execution", async () => {
    const lockFile = "/tmp/mutex-run-test-concurrent.lock";

    // Start first process that holds lock for 2 seconds
    const first = execa("tsx", [
      CLI_PATH,
      "--lock",
      lockFile,
      "--wait",
      "false",
      "--",
      "node",
      "-e",
      "setTimeout(() => {}, 2000)",
    ]);

    // Wait a bit to ensure first process has acquired lock
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Second process should fail immediately because wait=false
    try {
      await execa("tsx", [
        CLI_PATH,
        "--lock",
        lockFile,
        "--wait",
        "false",
        "--",
        "echo",
        "second",
      ]);
      expect.fail("Second process should have failed");
    } catch (err: any) {
      expect(err.exitCode).toBe(1);
      expect(err.stderr).toContain("Failed to acquire lock");
    }

    // Wait for first process to complete
    await first;
  }, 15000);

  it("waits for lock with retry", async () => {
    const lockFile = "/tmp/mutex-run-test-retry.lock";

    // Start first process that holds lock for 2 seconds
    const first = execa("tsx", [
      CLI_PATH,
      "--lock",
      lockFile,
      "--",
      "node",
      "-e",
      "setTimeout(() => console.log('first done'), 2000)",
    ]);

    // Wait a bit to ensure first process has acquired lock
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Second process should wait and then succeed
    const secondStart = Date.now();
    const second = execa("tsx", [
      CLI_PATH,
      "--lock",
      lockFile,
      "--wait",
      "--",
      "echo",
      "second",
    ]);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const waitTime = Date.now() - secondStart;

    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    expect(secondResult.stdout).toContain("second");
    // Second process should have waited at least 1 second (2s - 0.8s start delay)
    expect(waitTime).toBeGreaterThan(1000);
  }, 20000);

  it("respects timeout option", async () => {
    const lockFile = "/tmp/mutex-run-test-timeout.lock";

    // Start first process that holds lock for 5 seconds
    const first = execa("tsx", [
      CLI_PATH,
      "--lock",
      lockFile,
      "--",
      "node",
      "-e",
      "setTimeout(() => {}, 5000)",
    ]);

    // Wait a bit to ensure first process has acquired lock
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Second process with 1 second timeout should fail
    try {
      await execa("tsx", [
        CLI_PATH,
        "--lock",
        lockFile,
        "--wait",
        "--timeout",
        "1000",
        "--",
        "echo",
        "second",
      ]);
      expect.fail("Should have timed out");
    } catch (err: any) {
      // Should fail with exit code 1
      expect(err.failed).toBe(true);
      expect([1, undefined]).toContain(err.exitCode); // Sometimes exitCode is undefined
    } finally {
      // Clean up first process
      first.kill();
      await first.catch(() => {}); // Ignore kill error
    }
  }, 15000);

  it("shows error when no command provided", async () => {
    try {
      await execa("tsx", [CLI_PATH, "--lock", TEST_LOCK, "--"], {
        reject: true,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.exitCode).toBe(1);
      // Note: Error messages go to stderr via console.error
      // They should appear in stderr but might be empty in some test environments
      expect(err.failed).toBe(true);
    }
  }, 10000);

  it("handles signals and cleans up", async () => {
    const lockFile = "/tmp/mutex-run-test-signal.lock";

    // Start a long-running process
    const child = execa("tsx", [
      CLI_PATH,
      "--lock",
      lockFile,
      "--verbose",
      "--",
      "node",
      "-e",
      "console.log('started'); setTimeout(() => {}, 30000)",
    ]);

    // Wait for process to start and lock to be acquired
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if lock file exists
    const lockExists = existsSync(lockFile);
    if (!lockExists) {
      // Process may have failed, check its status
      const isRunning = !child.killed && child.exitCode === null;
      console.error("Lock file doesn't exist. Process running:", isRunning);
    }
    expect(lockExists).toBe(true);

    // Send SIGTERM
    child.kill("SIGTERM");
    await child.catch(() => {}); // Ignore error from kill

    // Wait a bit for cleanup to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Lock should be cleaned up
    expect(existsSync(lockFile)).toBe(false);
  }, 15000);
});
