import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "commander";
import { parsePort, resolveOutputPath } from "../src/cliHelpers.js";

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

describe("resolveOutputPath", () => {
  it("replaces a .md extension with .pdf when no output is given", () => {
    expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
  });

  it("appends .pdf instead of no-op'ing when the input has no .md suffix", () => {
    expect(resolveOutputPath("deck")).toBe("deck.pdf");
    expect(resolveOutputPath("deck.markdown")).toBe("deck.markdown.pdf");
  });

  it("uses the explicit output path when one is given", () => {
    expect(resolveOutputPath("deck.md", "custom-name.pdf")).toBe(
      "custom-name.pdf",
    );
  });

  it("refuses to resolve to the same path as the input file", () => {
    expect(() => resolveOutputPath("deck.md", "deck.md")).toThrow(
      /Refusing to overwrite the source file/,
    );
  });
});
