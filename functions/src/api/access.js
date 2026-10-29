import { randomBytes } from "node:crypto";
import {
  define,
  path,
  manage,
  version,
  hash,
  millis,
  Timestamp,
  admission,
  requireRole,
} from "../domain/runtime.js";
import {
  assert,
  id,
  text,
  number,
  enumeration,
  fields,
} from "../../shared/schema.js";
import { getOwnedQuiz } from "./quizzes.js";
export function participant(c, quizId, quiz, uid = c.actor.uid) {
  return {
    quizId,
    quizOwnerId: quiz.ownerId,
    quizTitle: quiz.title,
    uid,
    displayName: "",
    email: "",
    accessStatus: "none",
    requestMessage: "",
    requestedAt: null,
    decidedAt: null,
    decidedBy: null,
    decisionReason: "",
    attemptCount: 0,
    extraAttempts: 0,
    activeAttemptId: null,
    latestAttemptId: null,
    version: 0,
    updatedAt: c.now,
  };
}
export async function linkQuiz(c, token) {
  assert(
    typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token),
    "RESOURCE_UNAVAILABLE",
    "This request link is unavailable.",
  );
  const link = await c.get(`joinLinks/${hash(token)}`, false);
  assert(
    link && !link.revokedAt && millis(link.expiresAt) > millis(c.now),
    "RESOURCE_UNAVAILABLE",
    "This request link has expired or was revoked.",
  );
  const quiz = await c.get(`quizzes/${link.quizId}`);
  assert(
    quiz.lifecycle === "active" && quiz.publishedRevisionId,
    "RESOURCE_UNAVAILABLE",
    "This quiz is unavailable.",
  );
  return { quizId: link.quizId, quiz };
}
export async function overview(c, quizId, token = null) {
  if (c.actor) requireRole(c.actor, "user");
  id(quizId);
  const quiz = await c.get(`quizzes/${quizId}`, false);
  assert(
    quiz?.schemaVersion === 2,
    "RESOURCE_UNAVAILABLE",
    "This quiz is unavailable.",
  );
  const p = c.actor
    ? await c.get(`quizzes/${quizId}/participants/${c.actor.uid}`, false)
    : null;
  const staff =
    c.actor?.emailVerified &&
    ["teacher", "admin"].includes(c.actor.role) &&
    (quiz.ownerId === c.actor.uid || c.actor.role === "admin");
  let validLink = false;
  if (token) {
    const linked = await linkQuiz(c, token);
    validLink = linked.quizId === quizId;
  }
  assert(
    (quiz.visibility === "public" &&
      quiz.lifecycle === "active" &&
      quiz.publishedRevisionId) ||
      staff ||
      (p && p.accessStatus !== "none") ||
      p?.activeAttemptId ||
      validLink,
    "RESOURCE_UNAVAILABLE",
    "This quiz is unavailable.",
  );
  let revision = null;
  if (quiz.publishedRevisionId)
    revision = await c.get(
      `quizzes/${quizId}/revisions/${quiz.publishedRevisionId}`,
    );
  let active = null;
  if (p?.activeAttemptId)
    active = await c.get(`attempts/${p.activeAttemptId}`, false);
  if (active?.status !== "active") active = null;
  let reason = null;
  try {
    if (!active) admission(quiz, p, c.actor, c.now);
  } catch (e) {
    reason = e.reason ?? "RESOURCE_UNAVAILABLE";
  }
  const limited =
    quiz.visibility === "private" &&
    !staff &&
    p?.accessStatus !== "approved" &&
    !active;
  return {
    quizId,
    title: revision?.title ?? quiz.title,
    ownerDisplayName: quiz.ownerDisplayName,
    description: limited ? "" : (revision?.description ?? ""),
    subject: limited ? "" : (revision?.subject ?? ""),
    difficulty: limited ? "" : (revision?.difficulty ?? ""),
    questionCount: limited ? null : (revision?.itemCount ?? 0),
    totalPoints: limited ? null : (revision?.totalPoints ?? 0),
    durationSeconds: limited ? null : (revision?.settings.durationSeconds ?? 0),
    visibility: quiz.visibility,
    accessMode: quiz.accessMode,
    opensAt: quiz.opensAt,
    closesAt: quiz.closesAt,
    maxAttempts: quiz.maxAttempts,
    attemptCount: p?.attemptCount ?? 0,
    extraAttempts: p?.extraAttempts ?? 0,
    accessStatus: p?.accessStatus ?? "none",
    canStart: !reason && !active,
    activeAttemptId: active?.id ?? (active ? p.activeAttemptId : null),
    reason,
    canManage: !!staff,
    published: !!quiz.publishedRevisionId,
    lifecycle: quiz.lifecycle,
    canRequest:
      !!quiz.publishedRevisionId &&
      quiz.lifecycle === "active" &&
      (quiz.visibility === "public" || validLink) &&
      (!p || p.accessStatus === "none"),
  };
}
define("getQuizOverview", "guest", ["quizId", "joinToken"], (c, r) =>
  overview(c, r.quizId, r.joinToken),
);
define("resolveJoinLink", "guest", ["token"], async (c, r) => {
  const { quizId, quiz } = await linkQuiz(c, r.token);
  const rev = await c.get(
    `quizzes/${quizId}/revisions/${quiz.publishedRevisionId}`,
  );
  return { quizId, title: rev.title, ownerDisplayName: quiz.ownerDisplayName };
});
define(
  "createJoinLink",
  "teacher",
  ["quizId", "expiresInDays"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    const days = number(r.expiresInDays ?? 30, "Link duration", 1, 90, true),
      token = randomBytes(32).toString("base64url"),
      linkId = hash(token),
      expiresAt = Timestamp.fromMillis(millis(c.now) + days * 86400000);
    c.set(`joinLinks/${linkId}`, {
      quizId: r.quizId,
      creator: c.actor.uid,
      createdAt: c.now,
      expiresAt,
      revokedAt: null,
    });
    c.audit("access.link_created", "quiz", r.quizId, {
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
    });
    c.receiptResult = { linkId, expiresAt, token: null };
    return { linkId, token, expiresAt };
  },
  { mutation: true },
);
define(
  "listJoinLinks",
  "teacher",
  ["quizId", "limit", "cursor"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    return c.list("joinLinks", [["quizId", "==", r.quizId]], r, "createdAt");
  },
);
define(
  "revokeJoinLink",
  "teacher",
  ["quizId", "linkId"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    const link = await c.get(path("joinLinks", r.linkId));
    assert(
      link.quizId === r.quizId,
      "RESOURCE_UNAVAILABLE",
      "Link unavailable.",
    );
    c.set(`joinLinks/${r.linkId}`, { ...link, revokedAt: c.now });
    c.audit("access.link_revoked", "quiz", r.quizId, { quizId: r.quizId });
    return { revokedAt: c.now };
  },
  { mutation: true },
);
define(
  "requestQuizAccess",
  "verified",
  ["quizId", "token", "message"],
  async (c, r) => {
    let quizId, quiz;
    if (r.token) {
      ({ quizId, quiz } = await linkQuiz(c, r.token));
      if (r.quizId)
        assert(
          r.quizId === quizId,
          "RESOURCE_UNAVAILABLE",
          "Link unavailable.",
        );
    } else {
      quizId = id(r.quizId);
      quiz = await c.get(`quizzes/${quizId}`);
      assert(
        quiz.visibility === "public" &&
          quiz.lifecycle === "active" &&
          quiz.publishedRevisionId,
        "RESOURCE_UNAVAILABLE",
        "This quiz is unavailable.",
      );
    }
    const p = `quizzes/${quizId}/participants/${c.actor.uid}`,
      old = await c.get(p, false);
    if (["pending", "approved"].includes(old?.accessStatus))
      return { accessStatus: old.accessStatus, version: old.version };
    assert(
      !["declined", "revoked"].includes(old?.accessStatus),
      "ACCESS_REVOKED",
      "Ask the teacher to reopen your access.",
    );
    await c.rate("requests", 10);
    const profile = await c.get(`users/${c.actor.uid}`, false),
      next = {
        ...(old ?? participant(c, quizId, quiz)),
        quizTitle: quiz.title,
        displayName: profile?.displayName ?? c.actor.displayName,
        email: c.actor.email,
        accessStatus: "pending",
        requestMessage: text(r.message ?? "", "Message", 500),
        requestedAt: c.now,
        updatedAt: c.now,
        version: (old?.version ?? 0) + 1,
      };
    c.set(p, next);
    c.notify(
      quiz.ownerId,
      "access_request",
      `${next.displayName || "A student"} requested access to ${quiz.title}`,
      quizId,
      c.actor.uid,
    );
    c.audit("access.requested", "quiz", quizId, {
      quizId,
      quizOwnerId: quiz.ownerId,
      affectedUserId: c.actor.uid,
    });
    return { accessStatus: "pending", version: next.version };
  },
  { mutation: true },
);
define("listMyApplications", "user", ["limit", "cursor"], (c, r) =>
  c.list("@participants", [["uid", "==", c.actor.uid]], r),
);
define(
  "listTeacherRequests",
  "teacher",
  ["status", "limit", "cursor"],
  (c, r) =>
    c.list(
      "@participants",
      [
        ["quizOwnerId", "==", c.actor.uid],
        [
          "accessStatus",
          "==",
          enumeration(
            r.status ?? "pending",
            ["pending", "approved", "declined", "revoked"],
            "access status",
          ),
        ],
      ],
      r,
    ),
);
define("listAvailableQuizzes", "user", ["limit", "cursor"], async (c, r) => {
  const page = await c.list(
    "@participants",
    [
      ["uid", "==", c.actor.uid],
      ["accessStatus", "==", "approved"],
    ],
    r,
  );
  const items = [];
  for (const p of page.items) {
    const q = await c.get(`quizzes/${p.quizId}`, false);
    if (q?.lifecycle === "active" && q.publishedRevisionId)
      items.push(await overview(c, p.quizId));
  }
  return { ...page, items };
});
define(
  "listAccessRequests",
  "teacher",
  ["quizId", "status", "limit", "cursor"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    const filters = r.status
      ? [
          [
            "accessStatus",
            "==",
            enumeration(
              r.status,
              ["none", "pending", "approved", "declined", "revoked"],
              "access status",
            ),
          ],
        ]
      : [];
    return c.list(`quizzes/${r.quizId}/participants`, filters, r);
  },
);
async function decide(c, r, direct = false) {
  const quiz = await getOwnedQuiz(c, r.quizId),
    uid = id(r.targetUid),
    p = `quizzes/${r.quizId}/participants/${uid}`,
    old = await c.get(p, false);
  const profile = await c.get(`users/${uid}`, false);
  assert(
    profile,
    "RESOURCE_UNAVAILABLE",
    "That registered user could not be found.",
  );
  if (!direct) version(old?.version ?? 0, r.expectedVersion);
  const decision = direct
    ? "approve"
    : enumeration(
        r.decision,
        ["approve", "decline", "revoke", "reopen"],
        "decision",
      );
  const status = {
    approve: "approved",
    decline: "declined",
    revoke: "revoked",
    reopen: "none",
  }[decision];
  const next = {
    ...(old ?? participant(c, r.quizId, quiz, uid)),
    quizTitle: quiz.title,
    displayName: profile.displayName,
    email: profile.email,
    accessStatus: status,
    decidedAt: c.now,
    decidedBy: c.actor.uid,
    decisionReason: text(r.reason ?? "", "Reason", 500),
    updatedAt: c.now,
    version: (old?.version ?? 0) + 1,
  };
  c.set(p, next);
  c.audit(
    "access." +
      {
        approve: "approved",
        decline: "declined",
        revoke: "revoked",
        reopen: "reopened",
      }[decision],
    "quiz",
    r.quizId,
    { quizId: r.quizId, quizOwnerId: quiz.ownerId, affectedUserId: uid },
  );
  c.notify(
    uid,
    "access_decision",
    `${quiz.title}: ${status === "none" ? "you may apply again" : status}`,
    r.quizId,
    uid,
  );
  return { targetUid: uid, accessStatus: status, version: next.version };
}
define(
  "decideQuizAccess",
  "teacher",
  ["quizId", "targetUid", "decision", "expectedVersion", "reason"],
  (c, r) => decide(c, r),
  { mutation: true },
);
define(
  "grantQuizAccess",
  "teacher",
  ["quizId", "targetUid", "reason"],
  (c, r) => decide(c, r, true),
  { mutation: true },
);
define(
  "bulkDecideQuizAccess",
  "teacher",
  ["quizId", "decisions"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    assert(
      Array.isArray(r.decisions) &&
        r.decisions.length > 0 &&
        r.decisions.length <= 25,
      "INVALID_FIELDS",
      "Choose 1–25 participants.",
    );
    const seen = new Set(),
      results = [];
    for (const d of r.decisions) {
      fields(d, ["targetUid", "decision", "expectedVersion", "reason"]);
      assert(
        !seen.has(d.targetUid),
        "INVALID_FIELDS",
        "Duplicate participant.",
      );
      seen.add(d.targetUid);
      try {
        results.push({
          ok: true,
          ...(await decide(c, { ...d, quizId: r.quizId })),
        });
      } catch (e) {
        if (!e.reason) throw e;
        results.push({
          ok: false,
          targetUid: d.targetUid,
          reason: e.reason,
          message: e.message,
        });
      }
    }
    return { results };
  },
  { mutation: true },
);
define(
  "lookupParticipant",
  "teacher",
  ["quizId", "exactEmail"],
  async (c, r) => {
    await getOwnedQuiz(c, r.quizId);
    await c.rate("lookup", 20);
    const email = text(r.exactEmail, "Email address", 254, true)
      .trim()
      .toLowerCase();
    assert(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "INVALID_FIELDS",
      "Enter a complete email address.",
    );
    const users = await c.all(
      "users",
      [["searchEmail", "==", email]],
      "__name__",
      "asc",
      1,
    );
    return {
      user: users.length
        ? {
            uid: users[0].id,
            displayName: users[0].displayName,
            email: users[0].email,
          }
        : null,
    };
  },
);
define(
  "addAttemptAllowance",
  "teacher",
  ["quizId", "targetUid", "delta", "expectedVersion", "reason"],
  async (c, r) => {
    const quiz = await getOwnedQuiz(c, r.quizId);
    const p = `quizzes/${r.quizId}/participants/${id(r.targetUid)}`,
      old = await c.get(p);
    version(old.version, r.expectedVersion);
    number(r.delta, "Extra attempts", 1, 100, true);
    text(r.reason, "Reason", 500, true);
    const next = {
      ...old,
      extraAttempts: old.extraAttempts + r.delta,
      version: old.version + 1,
      updatedAt: c.now,
    };
    c.set(p, next);
    c.audit("attempt.allowance_changed", "quiz", r.quizId, {
      quizId: r.quizId,
      quizOwnerId: quiz.ownerId,
      affectedUserId: r.targetUid,
    });
    return { version: next.version, extraAttempts: next.extraAttempts };
  },
  { mutation: true },
);
