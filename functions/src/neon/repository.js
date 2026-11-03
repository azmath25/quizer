// QN3: READ-ONLY, UNWIRED design adapter; no credentials, pool, driver or live calls.
// QN8 integrates and extends it inside existing authenticated Firebase actions.
import {
  NeonContractError, requireId, requireTeacher, requirePageSize,
  requireText, asIso, toProblemHeader, safeSource,
} from "./contracts.js";

// One problem-bank row, including tags, never includes statement/answer keys.
const HEADERS = [
  "SELECT p.problem_id, p.owner_uid, p.owner_display_name, p.title,",
  "p.search_title, p.subject, p.difficulty, p.bank_visibility, p.lifecycle,",
  "p.latest_revision_id, p.revision_number, p.version, p.updated_at,",
  "COALESCE((SELECT array_agg(t.tag::text ORDER BY t.tag)",
  "FROM quizer.problem_tags t WHERE t.problem_id = p.problem_id),",
  "ARRAY[]::text[]) AS tags",
  "FROM quizer.problems p",
].join(" ");

function rows(result) {
  if (!result || !Array.isArray(result.rows))
    throw new NeonContractError("DATABASE_ERROR", "Invalid database result.");
  return result.rows;
}

/**
 * @param {{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}} port
 * @returns {{getProblemForTeacher:Function, listProblemHeaders:Function}}
 *
 * Inject a server-held, pooled Postgres query function at QN8.
 * Never accept an actor from browser JSON: pass Context.actor after Firebase
 * auth, role, lifecycle and email verification. The SQL also scopes reads.
 */
export function createQuizerNeonReadRepository(port) {
  if (!port || typeof port.query !== "function")
    throw new NeonContractError("INVALID_FIELDS", "Trusted database query port required.");
  const query = (statement, values) => port.query(statement, values);
  return Object.freeze({
    async getProblemForTeacher({ actor, problemId, revisionId = null }) {
      requireTeacher(actor);
      requireId(problemId, "problem ID");
      if (revisionId !== null) requireId(revisionId, "revision ID");
      // Never fetch protected grading if the actor cannot read the bank row.
      const permitted = rows(await query(
        HEADERS + " WHERE p.problem_id = $1 AND " +
          "(p.owner_uid = $2 OR $3 = 'admin' OR " +
          "(p.bank_visibility = 'teachers' AND p.lifecycle = 'active')) LIMIT 1",
        [problemId, actor.uid, actor.role],
      ));
      if (!permitted.length)
        throw new NeonContractError("RESOURCE_UNAVAILABLE", "Problem unavailable.");
      const problemRow = permitted[0];
      const rid = revisionId ?? problemRow.latest_revision_id;
      requireId(rid, "revision ID");
      const revision = rows(await query(
        "SELECT revision_id, revision_number, content_json, grading_json, " +
        "source_json, content_hash, created_by_uid, created_at " +
        "FROM quizer.problem_revisions " +
        "WHERE problem_id = $1 AND revision_id = $2 LIMIT 1",
        [problemId, rid],
      ))[0];
      if (!revision)
        throw new NeonContractError("RESOURCE_UNAVAILABLE", "Revision unavailable.");
      const source = safeSource(revision.source_json,
        actor.uid === problemRow.owner_uid || actor.role === "admin");
      return {
        problemId,
        revisionId: revision.revision_id,
        problem: toProblemHeader(problemRow),
        content: {
          ...revision.content_json,
          revisionNumber: Number(revision.revision_number),
          createdBy: revision.created_by_uid,
          createdAt: asIso(revision.created_at),
          contentHash: revision.content_hash,
          source,
        },
        grading: { ...revision.grading_json },
      };
    },

    async listProblemHeaders({
      actor, view = "mine", lifecycle = "active", search = "", tag = "",
      subject = "", difficulty = "", limit = 25, after = null,
    }) {
      requireTeacher(actor);
      // 101 is the internal hybrid-merge lookahead for a public page of 100.
      if (!Number.isInteger(limit) || limit < 1 || limit > 101)
        throw new NeonContractError("INVALID_FIELDS", "Page size must be 1–101.");
      if (!["mine", "shared"].includes(view) ||
        !["active", "trashed"].includes(lifecycle))
        throw new NeonContractError("INVALID_FIELDS", "Invalid bank filter.");
      requireText(search, 200, "search");
      requireText(tag, 60, "tag");
      requireText(subject, 80, "subject");
      requireText(difficulty, 40, "difficulty");
      if ([subject, difficulty, tag].filter(Boolean).length > 1)
        throw new NeonContractError("INVALID_FIELDS",
          "Use one subject, difficulty or tag filter at a time.");
      const values = [];
      const bind = (value) => {
        values.push(value);
        return "$" + values.length;
      };
      const where = [];
      if (view === "mine") {
        where.push("p.owner_uid = " + bind(actor.uid));
        where.push("p.lifecycle = " + bind(lifecycle));
      } else {
        where.push("p.bank_visibility = 'teachers'");
        where.push("p.lifecycle = 'active'");
      }
      if (search.trim()) {
        // Literal prefix, not a LIKE wildcard; compatible with the pattern index.
        const prefix = search.trim().toLowerCase().replace(/[!%_]/g, (ch) => "!" + ch) + "%";
        where.push("p.search_title LIKE " + bind(prefix) + " ESCAPE '!'");
      }
      if (tag.trim()) {
        where.push("EXISTS (SELECT 1 FROM quizer.problem_tags ft " +
          "WHERE ft.problem_id = p.problem_id AND ft.tag = " + bind(tag.trim()) + ")");
      }
      if (subject) where.push("p.subject = " + bind(subject));
      if (difficulty) where.push("p.difficulty = " + bind(difficulty));
      const byTitle = !!search.trim();
      if (after !== null) {
        if (!after || typeof after !== "object")
          throw new NeonContractError("INVALID_FIELDS", "Invalid bank cursor.");
        const afterId = requireId(after.problemId, "cursor problem ID");
        if (byTitle) {
          const cursorTitle = requireText(after.searchTitle, 200, "cursor title");
          where.push("(p.search_title, p.problem_id) > (" +
            bind(cursorTitle) + "::varchar, " + bind(afterId) + "::varchar)");
        } else {
          const timestamp = asIso(after.updatedAt);
          where.push("(p.updated_at, p.problem_id) < (" +
            bind(timestamp) + "::timestamptz, " + bind(afterId) + "::varchar)");
        }
      }
      const sql = HEADERS +
        " WHERE " + where.join(" AND ") +
        (byTitle ? " ORDER BY p.search_title ASC, p.problem_id ASC LIMIT "
          : " ORDER BY p.updated_at DESC, p.problem_id DESC LIMIT ") +
        bind(limit + 1);
      const found = rows(await query(sql, values));
      const selected = found.slice(0, limit);
      const last = selected.at(-1);
      return {
        items: selected.map(toProblemHeader),
        // INTERNAL only. QN8 wraps it as a scoped opaque browser cursor.
        next: found.length > limit && last
          ? byTitle
            ? { searchTitle:last.search_title, problemId:last.problem_id }
            : { updatedAt: asIso(last.updated_at), problemId: last.problem_id }
          : null,
      };
    },

    async listProblemRevisions({actor,problemId,limit=25,after=null}) {
      requireTeacher(actor);
      requireId(problemId, "problem ID");
      requirePageSize(limit);
      // Permission is checked before any immutable revision metadata leaves SQL.
      const visible = rows(await query(
        HEADERS + " WHERE p.problem_id=$1 AND " +
          "(p.owner_uid=$2 OR $3='admin' OR " +
          "(p.bank_visibility='teachers' AND p.lifecycle='active')) LIMIT 1",
        [problemId,actor.uid,actor.role]));
      if (!visible.length)
        throw new NeonContractError("RESOURCE_UNAVAILABLE","Problem unavailable.");
      const values=[problemId];
      let cursor="";
      if(after!==null){
        if(!after || typeof after!=="object")
          throw new NeonContractError("INVALID_FIELDS","Invalid revision cursor.");
        const at=asIso(after.createdAt);
        const rid=requireId(after.revisionId,"cursor revision ID");
        cursor=" AND (created_at,revision_id)<($2::timestamptz,$3::varchar)";
        values.push(at,rid);
      }
      values.push(limit+1);
      const found=rows(await query(
        "SELECT revision_id,revision_number,created_by_uid,created_at " +
        "FROM quizer.problem_revisions WHERE problem_id=$1"+cursor+
        " ORDER BY created_at DESC,revision_id DESC LIMIT $"+values.length,
        values));
      const items=found.slice(0,limit).map(row=>({
        id:row.revision_id,revisionNumber:Number(row.revision_number),
        createdAt:asIso(row.created_at),createdBy:row.created_by_uid,
      }));
      const last=items.at(-1);
      return {items,next:found.length>limit && last
        ? {createdAt:last.createdAt,revisionId:last.id}:null};
    },
  });
}
