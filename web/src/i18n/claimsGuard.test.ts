import { describe, expect, it } from "vitest";
import { sourceMessages } from "../core/i18n";
import { DISCLAIMER_KEYS, findAllClaimViolations, findClaimViolations } from "./claimsGuard";

describe("site text never claims to forecast or warn about floods", () => {
  it("finds no claim in any shipped message", () => {
    expect(findAllClaimViolations(sourceMessages())).toEqual([]);
  });

  it("only allowlists keys that exist", () => {
    const keys = new Set(sourceMessages().map(([key]) => key as string));
    for (const key of DISCLAIMER_KEYS) {
      expect(keys.has(key), `allowlisted key "${key}" is not in the catalog`).toBe(true);
    }
  });
});

describe("claims guard", () => {
  const allow = new Set(["rain.disclaimer"]);

  it.each([
    "Flood forecast for Kigali",
    "See which streets will flood tonight.",
    "Hilltide predicts where water goes.",
    "Early warning for your neighbourhood",
    "Get an alert when rain is heavy.",
    "A flood-risk map of the city",
    "Your home is safe from flooding.",
  ])("flags a claim: %s", (message) => {
    expect(findClaimViolations("rain.title", message, allow)).toHaveLength(1);
  });

  it.each([
    "Rain falls on the real terrain and runs downhill.",
    "Water pools in the valley floors.",
    "Drains and culverts are not modeled.",
  ])("accepts plain description: %s", (message) => {
    expect(findClaimViolations("rain.body", message, allow)).toEqual([]);
  });

  it("accepts a reviewed, negated disclaimer", () => {
    const message = "A visualization of where water flows. This is not a forecast or a warning.";
    expect(findClaimViolations("rain.disclaimer", message, allow)).toEqual([]);
  });

  it("rejects a negated sentence whose key is not allowlisted", () => {
    const [violation] = findClaimViolations("rain.title", "This is not a forecast.", allow);
    expect(violation?.reason).toBe("not-allowlisted");
  });

  it("rejects an allowlisted key that makes the claim anyway", () => {
    const message = "This is not a forecast. Trust this flood warning.";
    const violations = findClaimViolations("rain.disclaimer", message, allow);
    expect(violations).toEqual([
      { key: "rain.disclaimer", sentence: "Trust this flood warning.", reason: "not-negated" },
    ]);
  });
});
