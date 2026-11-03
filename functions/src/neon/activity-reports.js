// QN6: internal future-only activity reports. Not wired to live Firebase
// actions until a separately approved cutover. No additional public API.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  NeonContractError, requireTeacher, requireId, requirePageSize, asIso,
} from "./contracts.js";

function requireAdmin(actor) {
  requireTeacher(actor);
  if (actor.role !== "admin")
    throw new NeonContractError("ROLE_REQUIRED", "Admin access required.");
}
const validAction = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,120}$/.test(value))
    throw new NeonContractError("INVALID_FIELDS", "Invalid action filter");
  return value;
};
function mapEvent(r) {
  return {
    id: r.event_id, actorId: r.actor_uid, actorRoleAtTime: r.actor_role,
    action: r.action, targetType: r.target_type, targetId: r.target_id,
    quizId: r.quiz_id, quizOwnerId: r.quiz_owner_uid,
    changedFields: r.changed_fields ?? [],
    occurredAt: asIso(r.occurred_at),
  };
}

export function createFutureActivityReader({
  sql, enabled = false, cutoverAt = null, cursorSecret = "", resolveQuizOwnerId = null,
}) {
  // No live SQL path unless this separate future-log feature is enabled.
  if (enabled !== true)
    return Object.freeze({
      listAdminActivity: async () => ({disabled:true, items:[], nextCursor:null}),
      listOwnedQuizHistory: async () => ({disabled:true, items:[], nextCursor:null}),
      listAdminUserActivity: async () => ({disabled:true, items:[], nextCursor:null}),
    });
  if (typeof sql?.query !== "function" || typeof cursorSecret !== "string" ||
    cursorSecret.length < 32 || !cutoverAt)
    throw new Error("Trusted Neon read port, explicit cutover and private cursor secret required");
  const start = asIso(cutoverAt);
  const sign = (value) => createHmac("sha256",cursorSecret).update(value).digest("hex");
  const scopeHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const encode = (entry) => {
    const body = JSON.stringify(entry);
    return Buffer.from(JSON.stringify({body, mac:sign(body)})).toString("base64url");
  };
  const decode = (token, expectedScope) => {
    if (typeof token !== "string" || token.length > 3000)
      throw new NeonContractError("INVALID_FIELDS", "Invalid activity cursor");
    try {
      const raw = JSON.parse(Buffer.from(token,"base64url").toString("utf8"));
      const digest = Buffer.from(sign(raw.body), "hex");
      const actual = Buffer.from(raw.mac, "hex");
      if (actual.length !== digest.length || !timingSafeEqual(actual,digest))
        throw new Error("bad cursor signature");
      const body = JSON.parse(raw.body);
      if (body.scope !== expectedScope || body.v !== 1)
        throw new Error("invalid cursor scope");
      return { at:asIso(body.at), eventId:requireId(body.eventId) };
    } catch {
      throw new NeonContractError("INVALID_FIELDS", "Invalid activity cursor");
    }
  };
  async function read({actor, filter={}, limit=25, cursor=null, from=null, to=null, ownership=null}) {
    requireTeacher(actor);
    requirePageSize(limit);
    const low = from ? asIso(from) : start;
    const lower = low < start ? start : low;
    const upper = to ? asIso(to) : null;
    const resultHeader = { historyStartsAt:start, historicalBackfill:false,
      source:"neon_future_only" };
    const filters = {};
    if (filter.actorId !== undefined) filters.actorId = requireId(filter.actorId);
    if (filter.quizId !== undefined) filters.quizId = requireId(filter.quizId);
    if (filter.actionName !== undefined) filters.actionName = validAction(filter.actionName);
    if (filter.role !== undefined) {
      if (!["student","teacher","admin","system"].includes(filter.role))
        throw new NeonContractError("INVALID_FIELDS", "Invalid role filter");
      filters.role = filter.role;
    }
    if (ownership !== null) {
      if (ownership.quizId !== filters.quizId ||
          (actor.role !== "admin" && ownership.ownerId !== actor.uid))
        throw new NeonContractError("RESOURCE_UNAVAILABLE", "Quiz unavailable");
    }
    if (upper && upper < lower)
      return { ...resultHeader, items:[],nextCursor:null };
    const scope = scopeHash({uid:actor.uid,role:actor.role,filters,
      ownership,lower,upper,start});
    const after = cursor ? decode(cursor,scope) : null;
    const values = [];
    const bind = (v) => {values.push(v);return "$"+values.length;};
    const where = ["e.occurred_at >= " + bind(lower) + "::timestamptz"];
    if (upper) where.push("e.occurred_at <= " + bind(upper) + "::timestamptz");
    if (actor.role !== "admin") {
      if (ownership !== null)
        where.push("e.quiz_owner_uid = " + bind(actor.uid));
      else
        where.push("(e.actor_uid = " + bind(actor.uid) +
          " OR (e.quiz_owner_uid = " + bind(actor.uid) + " AND e.quiz_id IS NOT NULL))");
    }
    for (const [key,column] of [
      ["actorId","e.actor_uid"],["quizId","e.quiz_id"],
      ["actionName","e.action"],["role","e.actor_role"],
    ]) if (filters[key] !== undefined)
      where.push(column + " = " + bind(filters[key]));
    if (after)
      where.push("(e.occurred_at,e.event_id) < (" +
        bind(after.at) + "::timestamptz," + bind(after.eventId) + "::varchar)");
    const query =
      "SELECT e.event_id,e.actor_uid,e.actor_role,e.action,e.target_type," +
      "e.target_id,e.quiz_id,e.quiz_owner_uid,e.changed_fields,e.occurred_at " +
      "FROM quizer.activity_events e WHERE " + where.join(" AND ") +
      " ORDER BY e.occurred_at DESC,e.event_id DESC LIMIT " + bind(limit+1);
    const rows = (await sql.query(query,values)).rows;
    if (!Array.isArray(rows))
      throw new Error("Bad future activity query result");
    const items = rows.slice(0,limit).map(mapEvent);
    const last = items.at(-1);
    return { ...resultHeader,items,
      nextCursor:rows.length > limit && last ? encode({
        v:1,scope,at:last.occurredAt,eventId:last.id,
      }) : null };
  }
  return Object.freeze({
    listAdminActivity: async ({actor,...rest}) => {
      requireAdmin(actor);return read({actor,...rest});
    },
    listAdminUserActivity: async ({actor,targetUid,...rest}) => {
      requireAdmin(actor);return read({actor,...rest,filter:{actorId:requireId(targetUid)}});
    },
    // Quiz ownership comes only from the trusted Firebase lookup injected at
    // initialization, never from request fields.
    listOwnedQuizHistory: async ({actor,quizId,...rest}) => {
      requireTeacher(actor);
      const id = requireId(quizId);
      if (typeof resolveQuizOwnerId !== "function")
        throw new Error("Trusted Firebase quiz owner resolver required");
      const ownerId = requireId(await resolveQuizOwnerId(id), "quiz owner ID");
      return read({actor,...rest,filter:{quizId:id},
        ownership:{quizId:id,ownerId}});
    },
  });
}
