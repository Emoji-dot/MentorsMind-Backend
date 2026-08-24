import { PolicyEngineService } from "../policy-engine.service";
import { RESOURCE_SENSITIVITY } from "../../config/security-policies";

describe("PolicyEngineService.evaluate", () => {
  const cases: Array<{
    score: number;
    sensitivity: keyof typeof RESOURCE_SENSITIVITY;
    expected: "allow" | "step_up_mfa" | "deny";
  }> = [
    // standard tier
    { score: 0, sensitivity: "STANDARD", expected: "allow" },
    { score: 29, sensitivity: "STANDARD", expected: "allow" },
    { score: 30, sensitivity: "STANDARD", expected: "allow" },
    { score: 59, sensitivity: "STANDARD", expected: "allow" },
    { score: 60, sensitivity: "STANDARD", expected: "step_up_mfa" },
    { score: 84, sensitivity: "STANDARD", expected: "step_up_mfa" },
    { score: 85, sensitivity: "STANDARD", expected: "deny" },
    { score: 100, sensitivity: "STANDARD", expected: "deny" },

    // sensitive tier
    { score: 0, sensitivity: "SENSITIVE", expected: "allow" },
    { score: 29, sensitivity: "SENSITIVE", expected: "allow" },
    { score: 30, sensitivity: "SENSITIVE", expected: "step_up_mfa" },
    { score: 59, sensitivity: "SENSITIVE", expected: "step_up_mfa" },
    { score: 60, sensitivity: "SENSITIVE", expected: "step_up_mfa" },
    { score: 85, sensitivity: "SENSITIVE", expected: "deny" },

    // critical tier
    { score: 0, sensitivity: "CRITICAL", expected: "allow" },
    { score: 30, sensitivity: "CRITICAL", expected: "step_up_mfa" },
    { score: 59, sensitivity: "CRITICAL", expected: "step_up_mfa" },
    { score: 60, sensitivity: "CRITICAL", expected: "deny" },
    { score: 85, sensitivity: "CRITICAL", expected: "deny" },
    { score: 100, sensitivity: "CRITICAL", expected: "deny" },
  ];

  test.each(cases)(
    "score=$score sensitivity=$sensitivity -> $expected",
    ({ score, sensitivity, expected }) => {
      const result = PolicyEngineService.evaluate(
        score,
        RESOURCE_SENSITIVITY[sensitivity],
      );
      expect(result).toBe(expected);
    },
  );

  it("clamps out-of-range scores before evaluating", () => {
    expect(
      PolicyEngineService.evaluate(-10, RESOURCE_SENSITIVITY.STANDARD),
    ).toBe("allow");
    expect(
      PolicyEngineService.evaluate(1000, RESOURCE_SENSITIVITY.CRITICAL),
    ).toBe("deny");
  });
});
