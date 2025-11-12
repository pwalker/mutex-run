import { describe, it, expect } from "vitest";
import { add } from "./utils";

describe("add", () => {
  it("should add 2 numbers", () => {
    const result = add(1, 2);
    expect(result).toBe(3);
  });
});
