import { describe, it, expect, afterEach } from "vitest";
import { splitAtDoubleDash, ensureFile } from "./utils";
import { existsSync } from "node:fs";
import { unlink, rm } from "node:fs/promises";
import { dirname } from "node:path";

describe("splitAtDoubleDash", () => {
  it("splits arguments at --", () => {
    const result = splitAtDoubleDash(["arg1", "arg2", "--", "cmd", "arg3"]);
    expect(result).toEqual({
      head: ["arg1", "arg2"],
      tail: ["cmd", "arg3"],
    });
  });

  it("returns all args in head when no -- present", () => {
    const result = splitAtDoubleDash(["arg1", "arg2", "arg3"]);
    expect(result).toEqual({
      head: ["arg1", "arg2", "arg3"],
      tail: [],
    });
  });

  it("handles -- at the beginning", () => {
    const result = splitAtDoubleDash(["--", "cmd", "arg"]);
    expect(result).toEqual({
      head: [],
      tail: ["cmd", "arg"],
    });
  });

  it("handles -- at the end", () => {
    const result = splitAtDoubleDash(["arg1", "arg2", "--"]);
    expect(result).toEqual({
      head: ["arg1", "arg2"],
      tail: [],
    });
  });

  it("handles empty array", () => {
    const result = splitAtDoubleDash([]);
    expect(result).toEqual({
      head: [],
      tail: [],
    });
  });

  it("handles only --", () => {
    const result = splitAtDoubleDash(["--"]);
    expect(result).toEqual({
      head: [],
      tail: [],
    });
  });

  it("finds first -- when multiple present", () => {
    const result = splitAtDoubleDash(["arg", "--", "cmd", "--", "more"]);
    expect(result).toEqual({
      head: ["arg"],
      tail: ["cmd", "--", "more"],
    });
  });
});

describe("ensureFile", () => {
  const testFile = "/tmp/mutex-run-test-file.lock";
  const testFileNested = "/tmp/mutex-run-test/nested/dir/file.lock";

  afterEach(async () => {
    // Clean up test files
    try {
      await unlink(testFile);
    } catch {}
    try {
      await rm("/tmp/mutex-run-test", { recursive: true, force: true });
    } catch {}
  });

  it("creates file if it doesn't exist", async () => {
    expect(existsSync(testFile)).toBe(false);
    await ensureFile(testFile);
    expect(existsSync(testFile)).toBe(true);
  });

  it("doesn't error if file already exists", async () => {
    await ensureFile(testFile);
    expect(existsSync(testFile)).toBe(true);
    // Should not throw
    await ensureFile(testFile);
    expect(existsSync(testFile)).toBe(true);
  });

  it("creates parent directories recursively", async () => {
    expect(existsSync(dirname(testFileNested))).toBe(false);
    await ensureFile(testFileNested);
    expect(existsSync(testFileNested)).toBe(true);
    expect(existsSync(dirname(testFileNested))).toBe(true);
  });
});
