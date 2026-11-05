import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, validateSettings } from "../../shared/schema.js";

test("pass/fail is opt-in and defaults to 50 percent", () => {
  assert.equal(DEFAULT_SETTINGS.passFailEnabled, false);
  assert.equal(DEFAULT_SETTINGS.passPercentage, 50);
  const settings = validateSettings({});
  assert.equal(settings.passFailEnabled, false);
  assert.equal(settings.passPercentage, 50);
});

test("teacher can configure threshold without changing grading or release", () => {
  const settings = validateSettings({ passFailEnabled: true, passPercentage: 72.5 });
  assert.equal(settings.passFailEnabled, true);
  assert.equal(settings.passPercentage, 72.5);
  assert.equal(settings.scoreRelease, "immediate");
  assert.equal(settings.solutionRelease, "manual");
  assert.equal(settings.penalty, 0);
});

test("invalid thresholds and pass/fail flags are rejected", () => {
  assert.throws(() => validateSettings({ passPercentage: -1 }));
  assert.throws(() => validateSettings({ passPercentage: 101 }));
  assert.throws(() => validateSettings({ passPercentage: Number.NaN }));
  assert.throws(() => validateSettings({ passFailEnabled: "yes" }));
});

test("published snapshot settings do not mutate teacher defaults", () => {
  const attemptSettings = validateSettings({ passFailEnabled: true, passPercentage: 75 });
  assert.notEqual(attemptSettings, DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.passFailEnabled, false);
});
