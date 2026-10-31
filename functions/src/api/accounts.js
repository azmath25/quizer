import { define, version, requireRole, hash } from "../domain/runtime.js";
import {
  fields,
  text,
  enumeration,
  number,
  id,
  assert,
} from "../../shared/schema.js";

define("getSessionInfo", "user", [], async (c) => {
  const uid = c.actor.uid;
  let profile = await c.get(`users/${uid}`, false);
  let role = await c.get(`roles/${uid}`, false);
  if (!role) {
    role = {
      role: "student",
      accountStatus: "active",
      version: 1,
      updatedAt: c.now,
      updatedBy: uid,
    };
    c.set(`roles/${uid}`, role);
  }
  if (!profile) {
    profile = {
      schemaVersion: 2,
      uid,
      displayName:
        c.actor.displayName || c.actor.email.split("@")[0] || "Student",
      email: c.actor.email,
      emailVerified: c.actor.emailVerified,
      version: 1,
      createdAt: c.now,
      updatedAt: c.now,
      lastSeenAt: c.now,
      preferences: { theme: "light", textScale: 1 },
    };
    profile.searchName = profile.displayName.toLowerCase();
    profile.searchEmail = profile.email.toLowerCase();
    c.audit("account.created", "user", uid);
  } else if (
    c.now.toMillis() - (profile.lastSeenAt?.toMillis?.() ?? 0) > 900000 ||
    profile.email !== c.actor.email ||
    profile.emailVerified !== c.actor.emailVerified
  )
    profile = {
      ...profile,
      email: c.actor.email,
      searchEmail: c.actor.email.toLowerCase(),
      emailVerified: c.actor.emailVerified,
      lastSeenAt: c.now,
    };
  // Version 1 accounts have no preferences/version; normalize on first sign-in.
  profile = {
    ...profile,
    schemaVersion: 2,
    uid,
    displayName: String(
      profile.displayName ||
        c.actor.displayName ||
        c.actor.email.split("@")[0] ||
        "Student",
    ).slice(0, 100),
    version:
      Number.isInteger(profile.version) && profile.version > 0
        ? profile.version
        : 1,
    preferences: {
      theme: ["light", "dark", "system"].includes(profile.preferences?.theme)
        ? profile.preferences.theme
        : "light",
      textScale: [1, 1.125, 1.25].includes(profile.preferences?.textScale)
        ? profile.preferences.textScale
        : 1,
    },
  };
  profile.searchName = profile.displayName.toLowerCase();
  profile.searchEmail = c.actor.email.toLowerCase();
  c.set(`users/${uid}`, profile);
  return {
    profile,
    role: role.role,
    accountStatus: role.accountStatus ?? "active",
    roleVersion: role.version ?? 0,
    capabilities: {
      teach: c.actor.emailVerified && ["teacher", "admin"].includes(role.role),
      admin: c.actor.emailVerified && role.role === "admin",
    },
  };
});
define(
  "updateProfile",
  "user",
  ["displayName", "preferences", "expectedVersion"],
  async (c, r) => {
    const p = await c.get(`users/${c.actor.uid}`);
    version(p.version, r.expectedVersion);
    const preferences = { ...p.preferences };
    if (r.preferences) {
      fields(r.preferences, ["theme", "textScale"], "preferences");
      if (r.preferences.theme !== undefined)
        preferences.theme = enumeration(
          r.preferences.theme,
          ["light", "dark", "system"],
          "theme",
        );
      if (r.preferences.textScale !== undefined)
        preferences.textScale = enumeration(
          r.preferences.textScale,
          [1, 1.125, 1.25],
          "text size",
        );
    }
    const name =
      r.displayName === undefined
        ? p.displayName
        : text(r.displayName, "Name", 100, true).trim();
    const next = {
      ...p,
      displayName: name,
      searchName: name.toLowerCase(),
      preferences,
      version: p.version + 1,
      updatedAt: c.now,
    };
    c.set(`users/${c.actor.uid}`, next);
    c.audit("profile.updated", "user", c.actor.uid, {
      changedFields: ["displayName", "preferences"],
    });
    return next;
  },
  { mutation: true },
);
define("listMyNotifications", "user", ["limit", "cursor"], (c, r) =>
  c.list(`users/${c.actor.uid}/notifications`, [], r, "createdAt"),
);
define(
  "markNotificationRead",
  "user",
  ["notificationId"],
  async (c, r) => {
    const p = `users/${c.actor.uid}/notifications/${id(r.notificationId)}`;
    const n = await c.get(p);
    c.set(p, { ...n, readAt: c.now });
    return { readAt: c.now };
  },
  { mutation: true },
);
define("getDashboard", "guest", [], async (c) => {
  const catalog = c.list("catalog", [], { limit: 5 });
  if (!c.actor) return { publicQuizzes: (await catalog).items };
  requireRole(c.actor, "user");
  const uid = c.actor.uid,
    teacher =
      ["teacher", "admin"].includes(c.actor.role) && c.actor.emailVerified,
    items = (q) => q.then((r) => r.items),
    none = Promise.resolve([]);
  const [publicQuizzes, attempts, requests, notifications, myQuizzes, incoming, marking] =
    await Promise.all([
      items(catalog),
      items(c.list("attempts", [["studentId", "==", uid]], { limit: 5 }, "startedAt")),
      items(c.list("@participants", [["uid", "==", uid]], { limit: 5 })),
      items(c.list(`users/${uid}/notifications`, [], { limit: 5 }, "createdAt")),
      teacher
        ? items(
            c.list(
              "quizzes",
              [
                ["ownerId", "==", uid],
                ["lifecycle", "==", "active"],
              ],
              { limit: 5 },
            ),
          )
        : none,
      teacher
        ? items(
            c.list(
              "@participants",
              [
                ["quizOwnerId", "==", uid],
                ["accessStatus", "==", "pending"],
              ],
              { limit: 5 },
            ),
          )
        : none,
      teacher
        ? items(
            c.list(
              "attempts",
              [
                ["quizOwnerId", "==", uid],
                ["gradeState", "==", "pending_manual"],
              ],
              { limit: 5 },
              "startedAt",
            ),
          )
        : none,
    ]);
  const result = {
    publicQuizzes,
    attempts: attempts.map((a) => ({
      id: a.id,
      quizId: a.quizId,
      quizTitle: a.quizTitle,
      status: a.status,
      gradeState: a.gradeState,
      startedAt: a.startedAt,
      lastSavedAt: a.lastSavedAt,
    })),
    requests: requests.map((p) => ({
      quizId: p.quizId,
      title: p.quizTitle ?? "Quiz",
      accessStatus: p.accessStatus,
    })),
    notifications,
  };
  if (teacher) {
    result.myQuizzes = myQuizzes;
    result.incoming = incoming;
    result.marking = marking.map((a) => ({
      id: a.id,
      quizTitle: a.quizTitle,
      studentDisplayName: a.studentDisplayName,
      pending: a.totals.pending,
    }));
  }
  return result;
});
define(
  "listUsers",
  "admin",
  ["limit", "cursor", "search", "role", "status"],
  async (c, r) => {
    // Role/status views paginate canonical roles and hydrate only that page.
    if (r.role || r.status) {
      assert(
        !r.search,
        "INVALID_FIELDS",
        "Use either email search or role/status filters.",
      );
      const filters = [];
      if (r.role)
        filters.push([
          "role",
          "==",
          enumeration(r.role, ["student", "teacher", "admin"], "role"),
        ]);
      if (r.status)
        filters.push([
          "accountStatus",
          "==",
          enumeration(r.status, ["active", "disabled"], "status"),
        ]);
      const page = await c.list("roles", filters, r);
      const items = [];
      for (const role of page.items) {
        const p = await c.get(`users/${role.id}`, false);
        items.push({
          id: role.id,
          displayName: p?.displayName ?? role.id,
          email: p?.email ?? "",
          emailVerified: p?.emailVerified ?? false,
          ...role,
        });
      }
      return { ...page, items };
    }
    const filters = [];
    let order = "createdAt",
      direction = "desc";
    if (r.search) {
      const s = text(r.search, "Email prefix", 200).toLowerCase();
      filters.push(
        ["searchEmail", ">=", s],
        ["searchEmail", "<=", s + "\uf8ff"],
      );
      order = "searchEmail";
      direction = "asc";
    }
    const page = await c.list("users", filters, r, order, direction);
    const items = [];
    for (const p of page.items) {
      const role = await c.get(`roles/${p.id}`, false);
      items.push({
        id: p.id,
        displayName: p.displayName,
        email: p.email,
        emailVerified: p.emailVerified,
        role: role?.role ?? "student",
        accountStatus: role?.accountStatus ?? "active",
        version: role?.version ?? 0,
      });
    }
    return { ...page, items };
  },
);
async function changeAuthority(c, r, mode) {
  const uid = id(r.targetUid),
    p = `roles/${uid}`;
  const old = await c.get(p);
  version(old.version ?? 0, r.expectedVersion);
  text(r.reason, "Reason", 500, true);
  const next = {
    ...old,
    version: (old.version ?? 0) + 1,
    updatedAt: c.now,
    updatedBy: c.actor.uid,
  };
  if (mode === "role")
    next.role = enumeration(r.role, ["student", "teacher", "admin"], "role");
  else
    next.accountStatus = enumeration(
      r.status,
      ["active", "disabled"],
      "account status",
    );
  const was =
      old.role === "admin" && (old.accountStatus ?? "active") === "active",
    will =
      next.role === "admin" && (next.accountStatus ?? "active") === "active";
  if (was !== will) {
    const counter = await c.get("system/accessControl");
    const count = counter.activeAdminCount + (will ? 1 : -1);
    assert(
      count >= 1,
      "LAST_ADMIN",
      "At least one active administrator must remain.",
    );
    c.set("system/accessControl", {
      ...counter,
      activeAdminCount: count,
      version: counter.version + 1,
      updatedAt: c.now,
    });
  }
  c.set(p, next);
  const eventId = c.key("chg_", uid);
  c.set(`users/${uid}/authorityChanges/${eventId}`, {
    before: { role: old.role, accountStatus: old.accountStatus ?? "active" },
    after: { role: next.role, accountStatus: next.accountStatus ?? "active" },
    reason: r.reason,
    actorId: c.actor.uid,
    changedAt: c.now,
  });
  c.audit(
    mode === "role" ? "role.changed" : "account.status_changed",
    "user",
    uid,
    {
      affectedUserId: uid,
      changedFields: [mode === "role" ? "role" : "accountStatus"],
    },
  );
  c.notify(uid, "account", "Your account permissions have changed.", null, uid);
  return next;
}
define(
  "setUserRole",
  "admin",
  ["targetUid", "role", "expectedVersion", "reason"],
  (c, r) => changeAuthority(c, r, "role"),
  { mutation: true },
);
define(
  "setAccountStatus",
  "admin",
  ["targetUid", "status", "expectedVersion", "reason"],
  (c, r) => changeAuthority(c, r, "status"),
  { mutation: true },
);
define(
  "listActivity",
  "admin",
  ["limit", "cursor", "actorId", "role", "quizId", "actionName", "from", "to"],
  (c, r) => {
    const filters = [];
    if (r.actorId) filters.push(["actorId", "==", id(r.actorId)]);
    if (r.role)
      filters.push([
        "actorRoleAtTime",
        "==",
        enumeration(r.role, ["student", "teacher", "admin", "system"], "role"),
      ]);
    if (r.quizId) filters.push(["quizId", "==", id(r.quizId)]);
    if (r.actionName)
      filters.push(["action", "==", text(r.actionName, "Action", 80)]);
    assert(
      filters.length <= 1,
      "INVALID_FIELDS",
      "Use one activity filter at a time.",
    );
    assert(
      !r.from && !r.to,
      "INVALID_FIELDS",
      "Date filtering is available through the time-ordered pages.",
    );
    return c.list("auditEvents", filters, r, "occurredAt");
  },
);
define(
  "getAdminUserActivity",
  "admin",
  ["targetUid", "limit", "cursor"],
  (c, r) =>
    c.list(
      "auditEvents",
      [["actorId", "==", id(r.targetUid)]],
      r,
      "occurredAt",
    ),
);
define(
  "adminListContent",
  "admin",
  ["kind", "ownerId", "lifecycle", "limit", "cursor"],
  (c, r) => {
    const collection = enumeration(
      r.kind,
      ["quizzes", "problems"],
      "content kind",
    );
    const filters = [];
    if (r.ownerId) filters.push(["ownerId", "==", id(r.ownerId)]);
    if (r.lifecycle)
      filters.push([
        "lifecycle",
        "==",
        enumeration(r.lifecycle, ["active", "trashed"], "lifecycle"),
      ]);
    return c.list(collection, filters, r);
  },
);
define("listJobs", "admin", ["status", "limit", "cursor"], (c, r) =>
  c.list(
    "jobs",
    r.status
      ? [
          [
            "status",
            "==",
            enumeration(
              r.status,
              ["queued", "running", "succeeded", "failed", "cancelled"],
              "job status",
            ),
          ],
        ]
      : [],
    r,
  ),
);
