import { initializeApp } from "../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {
  getFirestore,
  Timestamp,
} from "../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1];
const project = args.includes("--project") ? value("--project") : null,
  uid = args.includes("--uid") ? value("--uid") : null,
  apply = args.includes("--apply");
if (!project || !uid || !/^[-_a-zA-Z0-9]+$/.test(uid))
  throw new Error(
    "Usage: node scripts/bootstrap-admin.mjs --project PROJECT_ID --uid USER_UID [--apply]. Without --apply this is a dry run.",
  );
initializeApp({ projectId: project });
const db = getFirestore(),
  user = await getAuth().getUser(uid);
if (!user.emailVerified || user.disabled)
  throw new Error(
    "The initial administrator must have an active, verified Firebase Auth account.",
  );
const admins = await db.collection("roles").where("role", "==", "admin").get();
console.log(
  JSON.stringify(
    {
      project,
      uid,
      email: user.email,
      apply,
      currentAdminCount: admins.docs.filter(
        (d) => (d.data().accountStatus ?? "active") === "active",
      ).length,
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);
await db.runTransaction(async (tx) => {
  const counter = await tx.get(db.doc("system/accessControl")),
    existing = await tx.get(db.doc("roles/" + uid));
  if (counter.exists && counter.data().activeAdminCount > 0)
    throw new Error(
      "Administration is already initialized. Use the admin page to change roles.",
    );
  const active =
    admins.docs.filter(
      (d) => (d.data().accountStatus ?? "active") === "active" && d.id !== uid,
    ).length + 1;
  tx.set(db.doc("roles/" + uid), {
    role: "admin",
    accountStatus: "active",
    version: (existing.data()?.version ?? 0) + 1,
    updatedAt: Timestamp.now(),
    updatedBy: "bootstrap",
  });
  tx.set(db.doc("system/accessControl"), {
    activeAdminCount: active,
    version: 1,
    updatedAt: Timestamp.now(),
  });
  tx.set(db.collection("auditEvents").doc(), {
    actorId: "bootstrap",
    actorRoleAtTime: "system",
    action: "role.bootstrapped",
    targetType: "user",
    targetId: uid,
    affectedUserId: uid,
    quizId: null,
    quizOwnerId: null,
    changedFields: ["role"],
    requestId: "bootstrap",
    occurredAt: Timestamp.now(),
  });
});
console.log(
  "Administrator initialized. Sign out and back in to refresh the app.",
);
