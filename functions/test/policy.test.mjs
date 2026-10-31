import test from "node:test";
import assert from "node:assert/strict";
import {
  Timestamp,
  requireRole,
  manage,
  released,
  admission,
  hash,
  canonical,
} from "../src/domain/runtime.js";
const now = Timestamp.fromMillis(1000000),
  student = {
    uid: "student",
    role: "student",
    emailVerified: true,
    accountStatus: "active",
  };
test("Ownership never follows a teacher role alone; disabled and unverified are rejected", () => {
  assert.throws(() =>
    manage({ ...student, role: "teacher" }, { ownerId: "other" }),
  );
  assert.throws(() =>
    requireRole(
      { ...student, role: "admin", accountStatus: "disabled" },
      "admin",
    ),
  );
  assert.throws(() =>
    requireRole(
      { ...student, role: "teacher", emailVerified: false },
      "teacher",
    ),
  );
  assert.throws(() => requireRole(null));
});
test("Individual denies override public-open policy, and windows/attempt limits are strict", () => {
  const q = {
    schemaVersion: 2,
    lifecycle: "active",
    publishedRevisionId: "qrv_x",
    visibility: "public",
    accessMode: "open",
    maxAttempts: 1,
    closesAt: Timestamp.fromMillis(1000001),
  };
  admission(q, null, student, now);
  for (const status of ["declined", "revoked"])
    assert.throws(() => admission(q, { accessStatus: status }, student, now));
  assert.throws(() => admission(q, { attemptCount: 1 }, student, now));
  assert.throws(() => admission({ ...q, closesAt: now }, null, student, now));
  assert.throws(() =>
    admission(
      { ...q, visibility: "private", accessMode: "approval" },
      null,
      student,
      now,
    ),
  );
});
test("Scores and solutions release independently; never and active states cannot be bypassed", () => {
  const a = {
    status: "submitted",
    gradeState: "final",
    settingsSnapshot: { scoreRelease: "immediate", solutionRelease: "manual" },
    closedAtSnapshot: Timestamp.fromMillis(999999),
  };
  assert(released(a, "score", now));
  assert(!released(a, "solutions", now));
  assert(
    !released(
      { ...a, status: "active", solutionsReleasedAt: now },
      "solutions",
      now,
    ),
  );
  assert(
    !released(
      {
        ...a,
        settingsSnapshot: { ...a.settingsSnapshot, solutionRelease: "never" },
        solutionsReleasedAt: now,
      },
      "solutions",
      now,
    ),
  );
  assert(
    released(
      {
        ...a,
        settingsSnapshot: {
          ...a.settingsSnapshot,
          solutionRelease: "afterClose",
        },
      },
      "solutions",
      now,
    ),
  );
});
test("Canonical hashes are key-order independent and binary hashes use bytes", () => {
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  assert.equal(
    hash(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("Star and bulk problem actions are registered with the right roles", async () => {
  const { handlers } = await import("../src/router.js");
  for (const [name, role] of [
    ["setStar", "user"],
    ["listStars", "user"],
    ["bulkUpdateProblems", "teacher"],
    ["getQuizProblemStats", "teacher"],
  ])
    assert.equal(handlers.get(name)?.permission, role);
});
