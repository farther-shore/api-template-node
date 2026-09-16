import { describe, expect, it } from "vitest";

import {
  DEFAULT_PORT,
  bootstrapFailureMessage,
  describeBootstrapFailure,
  resolvePort,
} from "./startup.js";

describe("resolvePort", () => {
  it("defaults to the documented scaffold port", () => {
    expect(DEFAULT_PORT).toBe(3000);
    expect(resolvePort({})).toBe(3000);
    expect(resolvePort({ PORT: "" })).toBe(3000);
  });

  it("honours an explicit PORT", () => {
    expect(resolvePort({ PORT: "8080" })).toBe(8080);
    expect(resolvePort({ PORT: " 4000 " })).toBe(4000);
  });

  it("never yields NaN or an out-of-range port", () => {
    expect(resolvePort({ PORT: "not-a-port" })).toBe(3000);
    expect(resolvePort({ PORT: "70000" })).toBe(3000);
    expect(resolvePort({ PORT: "-1" })).toBe(3000);
    expect(resolvePort({ PORT: "3000.5" })).toBe(3000);
  });
});

describe("describeBootstrapFailure", () => {
  it("surfaces a typed SDK error's code and message", () => {
    const error = Object.assign(new Error("bootstrap returned HTTP 409"), {
      code: "no_backend",
    });
    expect(describeBootstrapFailure(error)).toEqual({
      code: "no_backend",
      message: "bootstrap returned HTTP 409",
    });
  });

  it("falls back for an untyped throw", () => {
    expect(describeBootstrapFailure(new Error("boom"))).toEqual({
      code: "bootstrap_failed",
      message: "boom",
    });
    expect(describeBootstrapFailure("boom").code).toBe("bootstrap_failed");
  });

  it("logs the code, the message, and that /healthz survives", () => {
    const line = bootstrapFailureMessage(
      Object.assign(new Error("no backend configured"), {
        code: "no_backend",
      }),
    );
    expect(line).toContain("no_backend");
    expect(line).toContain("no backend configured");
    expect(line).toContain("/healthz");
  });
});
