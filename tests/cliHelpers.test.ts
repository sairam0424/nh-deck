import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "commander";
import { parsePort } from "../src/cliHelpers.js";

describe("parsePort", () => {
  it("accepts valid integer ports, including the boundaries", () => {
    expect(parsePort("0")).toBe(0);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("3000")).toBe(3000);
  });

  it("rejects non-numeric input", () => {
    expect(() => parsePort("abc")).toThrow(InvalidArgumentError);
  });

  it("rejects negative numbers", () => {
    expect(() => parsePort("-1")).toThrow(InvalidArgumentError);
  });

  it("rejects numbers above the valid port range", () => {
    expect(() => parsePort("65536")).toThrow(InvalidArgumentError);
  });

  it("rejects non-integer numbers", () => {
    expect(() => parsePort("3000.5")).toThrow(InvalidArgumentError);
  });
});
