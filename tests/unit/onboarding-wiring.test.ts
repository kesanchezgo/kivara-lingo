/**
 * The wizard USES the extracted stepper — this file is the guard that it
 * keeps doing so. The unit tests in onboarding-steps.test.ts prove what
 * steps.ts does; this one proves the wizard stopped carrying its own
 * copy (the regression the 901c40e review caught: imports present, body
 * still inline, the tests green while the wizard drifted).
 *
 * A full mount of the wizard is the e2e's job (chrome + bridge + store +
 * yomitan at module scope); instead of faking all of that, this reads
 * the source: the inline index arithmetic and the inline lock, if they
 * come back, fail here by name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(process.cwd(), "src/onboarding/Onboarding.tsx");
const src = readFileSync(SRC_PATH, "utf8");

describe("the wizard consumes the shared stepper", () => {
  it("has no inline index arithmetic for step moves", () => {
    // The 901c40e shape: `idx + 1` / `idx - 1` driving setStep directly.
    expect(src).not.toMatch(/\bidx\s*\+\s*1\b/);
    expect(src).not.toMatch(/\bidx\s*-\s*1\b/);
    expect(src).not.toMatch(/idx\s*>=\s*0\s*&&\s*idx\s*\+\s*1\s*</);
  });

  it("has no inline canAdvance gate", () => {
    // The lock must come from steps.ts, once, next to its tests.
    expect(src).not.toMatch(/const canAdvance = \(\(\) =>/);
    expect(src).not.toMatch(/const canAdvance\s*=\s*\(/);
  });

  it("calls the stepper's next/prev from the root", () => {
    expect(src).toMatch(/obNextStepId\(step\)/);
    expect(src).toMatch(/obPrevStepId\(step\)/);
    expect(src).toMatch(/obCanAdvance\(step,/);
  });

  it("keeps the completed-store write at the root, not in the pure module", () => {
    // The one side effect that belongs to the component: reaching done
    // writes `onboarding.completed`. It must stay here, not migrate.
    expect(src).toMatch(/setOnboarding\(\{\s*completed: true/);
  });
});
