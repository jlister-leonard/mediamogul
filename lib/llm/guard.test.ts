// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkPassphrase } from "./guard";

describe("checkPassphrase", () => {
  it("passes when the header matches the configured passphrase", () => {
    expect(checkPassphrase("open-sesame", "open-sesame")).toEqual({ ok: true });
  });

  it("rejects a wrong passphrase with 401 and no detail", () => {
    const verdict = checkPassphrase("wrong", "open-sesame");
    expect(verdict).toMatchObject({
      ok: false,
      status: 401,
      envelope: { error: { code: "unauthorized" } },
    });
    if (!verdict.ok) {
      expect(verdict.envelope.error.message).not.toContain("open-sesame");
    }
  });

  it("rejects a missing header with 401", () => {
    expect(checkPassphrase(null, "open-sesame")).toMatchObject({
      ok: false,
      status: 401,
      envelope: { error: { code: "unauthorized" } },
    });
  });

  it("reports 503 unconfigured when the env var is unset", () => {
    expect(checkPassphrase("anything", undefined)).toMatchObject({
      ok: false,
      status: 503,
      envelope: { error: { code: "unconfigured" } },
    });
  });

  it("treats an empty configured passphrase as unconfigured, not as a match", () => {
    expect(checkPassphrase("", "")).toMatchObject({ ok: false, status: 503 });
  });

  it("compares passphrases of different lengths without throwing", () => {
    expect(checkPassphrase("a", "a-much-longer-configured-passphrase")).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});
