import { createHash, randomUUID } from "node:crypto";
import { Timestamp, FieldPath } from "firebase-admin/firestore";
import {
  assert,
  bounded,
  fields,
  id,
  number,
  version,
  DomainError,
} from "../../shared/schema.js";

export const handlers = new Map();
export function define(
  name,
  permission,
  allowed,
  fn,
  { mutation = false } = {},
) {
  handlers.set(name, { permission, allowed, fn, mutation });
}
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value.toDate) return JSON.stringify(value.toDate().toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : canonical(value),
    )
    .digest("hex");
export const millis = (value) =>
  value?.toMillis?.() ?? (value ? Date.parse(value) : 0);
export function wire(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (value.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(wire);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, wire(v)]),
  );
}
export function path(collection, value) {
  return `${collection}/${id(value)}`;
}
export function requireRole(actor, permission = "user") {
  if (permission === "guest") return;
  assert(actor?.uid, "AUTH_REQUIRED", "Sign in to continue.");
  assert(
    actor.accountStatus !== "disabled",
    "ACCOUNT_DISABLED",
    "This account has been disabled.",
  );
  if (["verified", "teacher", "admin"].includes(permission))
    assert(
      actor.emailVerified,
      "EMAIL_UNVERIFIED",
      "Verify your email address to continue.",
    );
  if (permission === "teacher")
    assert(
      ["teacher", "admin"].includes(actor.role),
      "ROLE_REQUIRED",
      "Teacher access is required.",
    );
  if (permission === "admin")
    assert(
      actor.role === "admin",
      "ROLE_REQUIRED",
      "Administrator access is required.",
    );
}
export function manage(actor, record) {
  requireRole(actor, "teacher");
  assert(
    record && (record.ownerId === actor.uid || actor.role === "admin"),
    "RESOURCE_UNAVAILABLE",
    "This content is unavailable.",
  );
}
export function canReadProblem(actor, record) {
  requireRole(actor, "teacher");
  assert(
    record &&
      (record.ownerId === actor.uid ||
        actor.role === "admin" ||
        (record.bankVisibility === "teachers" &&
          record.lifecycle === "active")),
    "RESOURCE_UNAVAILABLE",
    "This problem is unavailable.",
  );
}
export function released(attempt, kind, now) {
  if (
    attempt.status === "active" ||
    ["not_started", "queued", "running", "failed"].includes(attempt.gradeState)
  )
    return false;
  const policy =
    attempt.settingsSnapshot[
      kind === "score" ? "scoreRelease" : "solutionRelease"
    ];
  if (policy === "never") return false;
  if (attempt[kind === "score" ? "scoreReleasedAt" : "solutionsReleasedAt"])
    return true;
  return (
    policy === "immediate" ||
    (policy === "afterClose" &&
      attempt.closedAtSnapshot &&
      millis(attempt.closedAtSnapshot) <= millis(now))
  );
}
export function admission(quiz, participant, actor, now) {
  requireRole(actor, "verified");
  assert(
    quiz?.schemaVersion === 2 &&
      quiz.lifecycle === "active" &&
      quiz.publishedRevisionId,
    "RESOURCE_UNAVAILABLE",
    "This quiz is unavailable.",
  );
  const state = participant?.accessStatus ?? "none";
  if (["revoked", "declined"].includes(state))
    assert(
      false,
      "ACCESS_" + state.toUpperCase(),
      "You do not have access to start this quiz.",
    );
  assert(
    (quiz.accessMode === "open" && quiz.visibility === "public") ||
      state === "approved",
    state === "pending" ? "ACCESS_PENDING" : "ROLE_REQUIRED",
    state === "pending"
      ? "Your request is awaiting approval."
      : "Request access before starting.",
  );
  if (quiz.opensAt)
    assert(
      millis(now) >= millis(quiz.opensAt),
      "QUIZ_NOT_OPEN",
      "This quiz has not opened yet.",
    );
  if (quiz.closesAt)
    assert(
      millis(now) < millis(quiz.closesAt),
      "QUIZ_CLOSED",
      "This quiz has closed.",
    );
  assert(
    quiz.maxAttempts === null ||
      (participant?.attemptCount ?? 0) <
        quiz.maxAttempts + (participant?.extraAttempts ?? 0),
    "ATTEMPT_LIMIT",
    "You have used your attempts. Ask the teacher for another attempt.",
  );
}
export class Context {
  constructor(db, tx, auth, action, requestId, now) {
    this.db = db;
    this.tx = tx;
    this.auth = auth;
    this.action = action;
    this.requestId = requestId;
    this.now = now;
    this.pending = new Map();
    this.actor = null;
  }
  key(prefix, suffix = "") {
    return (
      prefix +
      hash(
        `${this.auth?.uid ?? "system"}:${this.action}:${this.requestId}:${suffix}`,
      ).slice(0, 28)
    );
  }
  async get(p, required = true) {
    if (this.pending.has(p)) {
      const value = this.pending.get(p);
      if (required)
        assert(value, "RESOURCE_UNAVAILABLE", "This content is unavailable.");
      return value;
    }
    const snap = await this.tx.get(this.db.doc(p));
    const value = snap.exists ? snap.data() : null;
    if (required)
      assert(value, "RESOURCE_UNAVAILABLE", "This content is unavailable.");
    return value;
  }
  set(p, value) {
    bounded(value);
    this.pending.set(p, value);
  }
  delete(p) {
    this.pending.set(p, null);
  }
  async loadActor() {
    if (!this.auth) {
      this.actor = null;
      return;
    }
    id(this.auth.uid, "user ID");
    const role = await this.get(`roles/${this.auth.uid}`, false);
    this.actor = {
      uid: this.auth.uid,
      role: role?.role ?? "student",
      accountStatus: role?.accountStatus ?? "active",
      email: this.auth.token?.email ?? "",
      emailVerified: this.auth.token?.email_verified === true,
      displayName: this.auth.token?.name ?? "",
      roleVersion: role?.version ?? 0,
    };
  }
  async all(
    collection,
    filters = [],
    order = "__name__",
    direction = "asc",
    limit = 500,
  ) {
    let q = collection.startsWith("@")
      ? this.db.collectionGroup(collection.slice(1))
      : this.db.collection(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    q = q
      .orderBy(order === "__name__" ? FieldPath.documentId() : order, direction)
      .limit(limit);
    const snapshot = await this.tx.get(q);
    return snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
      _path: d.ref.path,
    }));
  }
  async list(
    collection,
    filters = [],
    input = {},
    order = "updatedAt",
    direction = "desc",
  ) {
    const limit = number(input.limit ?? 25, "Page size", 1, 100, true);
    const scope = hash({ collection, filters, order, direction });
    let q = collection.startsWith("@")
      ? this.db.collectionGroup(collection.slice(1))
      : this.db.collection(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    q = q.orderBy(order, direction).orderBy(FieldPath.documentId(), direction);
    if (input.cursor) {
      assert(
        typeof input.cursor === "string" && input.cursor.length < 3000,
        "INVALID_FIELDS",
        "Invalid page cursor.",
      );
      let cursor;
      try {
        cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      } catch {
        throw new DomainError("INVALID_FIELDS", "Invalid page cursor.");
      }
      assert(
        cursor.scope === scope &&
          typeof cursor.path === "string" &&
          cursor.path.length < 1000,
        "INVALID_FIELDS",
        "This cursor belongs to another list.",
      );
      const value = cursor.timestamp
        ? Timestamp.fromMillis(cursor.value)
        : cursor.value;
      assert(
        ["string", "number", "boolean"].includes(typeof cursor.value),
        "INVALID_FIELDS",
        "Invalid cursor value.",
      );
      q = q.startAfter(value, this.db.doc(cursor.path));
    }
    const snap = await this.tx.get(q.limit(limit + 1));
    const docs = snap.docs.slice(0, limit);
    const last = docs.at(-1);
    const nextCursor =
      snap.size > limit
        ? Buffer.from(
            JSON.stringify({
              scope,
              path: last.ref.path,
              timestamp: !!last.get(order)?.toMillis,
              value: last.get(order)?.toMillis?.() ?? last.get(order),
            }),
          ).toString("base64url")
        : null;
    return { items: docs.map((d) => ({ ...d.data(), id: d.id })), nextCursor };
  }
  audit(action, targetType, targetId, extra = {}) {
    fields(extra, ["quizId", "quizOwnerId", "affectedUserId", "changedFields"]);
    const eventId = this.key("evt_", `${action}:${targetId}`);
    this.set(`auditEvents/${eventId}`, {
      actorId: this.actor?.uid ?? "system",
      actorRoleAtTime: this.actor?.role ?? "system",
      action,
      targetType,
      targetId,
      quizId: extra.quizId ?? null,
      quizOwnerId: extra.quizOwnerId ?? null,
      affectedUserId: extra.affectedUserId ?? null,
      changedFields: extra.changedFields ?? [],
      requestId: this.requestId,
      occurredAt: this.now,
    });
  }
  notify(uid, type, title, quizId, targetId) {
    const notificationId = this.key("ntf_", `${uid}:${type}:${targetId}`);
    this.set(`users/${id(uid)}/notifications/${notificationId}`, {
      type,
      title,
      quizId: quizId ?? null,
      targetId,
      createdAt: this.now,
      readAt: null,
    });
  }
  async rate(name, maximum, period = 3600000) {
    const bucket = hash(
      `${this.actor.uid}:${name}:${Math.floor(millis(this.now) / period)}`,
    );
    const p = `rateLimits/${bucket}`;
    const old = await this.get(p, false);
    assert(
      (old?.count ?? 0) < maximum,
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
    );
    this.set(p, {
      count: (old?.count ?? 0) + 1,
      expiresAt: Timestamp.fromMillis(millis(this.now) + period * 2),
    });
  }
  async job(kind, targetId, input = {}) {
    const jobId = this.key("job_", `${kind}:${targetId}`);
    this.set(`jobs/${jobId}`, {
      kind,
      targetId,
      input,
      requestedBy: this.actor.uid,
      actorRoleAtTime: this.actor.role,
      requestId: this.requestId,
      status: "queued",
      progress: { processed: 0, total: 0, stage: "Queued" },
      leaseOwner: null,
      leaseExpiresAt: null,
      retryCount: 0,
      createdAt: this.now,
      updatedAt: this.now,
      completedAt: null,
      result: {},
      error: null,
    });
    return jobId;
  }
  flush() {
    for (const [p, value] of this.pending)
      value === null
        ? this.tx.delete(this.db.doc(p))
        : this.tx.set(this.db.doc(p), value);
  }
}
export async function dispatch(
  db,
  auth,
  request,
  { now = Timestamp.now() } = {},
) {
  assert(
    request && typeof request === "object" && !Array.isArray(request),
    "INVALID_FIELDS",
    "Invalid request.",
  );
  assert(
    request.apiVersion === 2,
    "API_VERSION",
    "Please reload to update the app.",
  );
  const def = handlers.get(request.action);
  assert(def, "INVALID_FIELDS", "Unknown action.");
  fields(request, ["apiVersion", "action", "requestId", ...def.allowed]);
  bounded(request, 1500000);
  if (def.mutation)
    assert(
      typeof request.requestId === "string" &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(request.requestId),
      "INVALID_FIELDS",
      "A unique request ID is required.",
    );
  const requestId = request.requestId ?? randomUUID();
  const inputHash = hash(request);
  const data = await db.runTransaction(async (tx) => {
    const c = new Context(db, tx, auth, request.action, requestId, now);
    await c.loadActor();
    requireRole(c.actor, def.permission);
    if (def.mutation) {
      const maintenance = await c.get("system/maintenance", false);
      assert(
        !maintenance?.enabled,
        "MAINTENANCE",
        "The quiz service is temporarily in maintenance. Please try again later.",
      );
    }
    const receipt = def.mutation
      ? `operations/${c.actor.uid}/requests/${requestId}`
      : null;
    const prior = receipt ? await c.get(receipt, false) : null;
    if (prior) {
      assert(
        prior.inputHash === inputHash,
        "INVALID_FIELDS",
        "This request ID was already used for different content.",
      );
      return prior.result;
    }
    const result = await def.fn(c, request);
    if (receipt)
      c.set(receipt, {
        action: request.action,
        inputHash,
        result: c.receiptResult ?? result,
        createdAt: now,
      });
    c.flush();
    return result;
  });
  return {
    apiVersion: 2,
    serverTime: now.toDate().toISOString(),
    data: wire(data),
  };
}
export async function transact(db, action, requestId, fn, auth = null) {
  return db.runTransaction(async (tx) => {
    const c = new Context(db, tx, auth, action, requestId, Timestamp.now());
    await c.loadActor();
    const result = await fn(c);
    c.flush();
    return result;
  });
}
export { version, Timestamp };
