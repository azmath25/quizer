import { define, path, hash, canReadProblem } from "../domain/runtime.js";
import { id, assert, bool, enumeration } from "../../shared/schema.js";
import { authorizeAttempt } from "./attempts.js";

const starPath = (uid, ref) => `users/${uid}/stars/${hash(ref).slice(0, 40)}`;

define(
  "setStar",
  "user",
  ["kind", "problemId", "attemptId", "itemId", "starred", "ref"],
  async (c, r) => {
    if (r.ref !== undefined) {
      // Removing a star only needs the reference the list returned.
      assert(
        r.starred === false && typeof r.ref === "string" && /^[pi]:[\w:-]{1,300}$/.test(r.ref),
        "INVALID_FIELDS",
        "Invalid star reference.",
      );
      c.delete(starPath(c.actor.uid, r.ref));
      return { ref: r.ref, starred: false };
    }
    const kind = enumeration(r.kind, ["problem", "quizItem"], "star kind"),
      starred = bool(r.starred, "Starred");
    let ref, entry;
    if (kind === "problem") {
      const problemId = id(r.problemId, "problem ID"),
        p = await c.get(path("problems", problemId));
      canReadProblem(c.actor, p);
      ref = `p:${problemId}`;
      entry = {
        kind,
        ref,
        title: String(p.title || "Problem").slice(0, 200),
        subject: String(p.subject || "").slice(0, 80),
        href: `problem-edit.html?id=${problemId}`,
      };
    } else {
      const attemptId = id(r.attemptId, "attempt ID"),
        itemId = id(r.itemId, "item ID"),
        a = await c.get(path("attempts", attemptId));
      authorizeAttempt(c, a);
      const index = a.order.indexOf(itemId);
      assert(index >= 0, "INVALID_FIELDS", "That problem is not in this attempt.");
      ref = `i:${a.quizId}:${itemId}`;
      entry = {
        kind,
        ref,
        title: `Problem ${index + 1} · ${String(a.quizTitle || "Quiz").slice(0, 150)}`,
        subject: "",
        href: `quiz.html?id=${a.quizId}`,
      };
    }
    const p = starPath(c.actor.uid, ref);
    if (starred) {
      const old = await c.get(p, false);
      c.set(p, { ...entry, createdAt: old?.createdAt ?? c.now });
    } else c.delete(p);
    return { ref, starred };
  },
  { mutation: true },
);

define("listStars", "user", [], async (c) => {
  const page = await c.list(`users/${c.actor.uid}/stars`, [], { limit: 100 }, "createdAt");
  return {
    items: page.items.map((s) => ({
      ref: s.ref,
      kind: s.kind,
      title: s.title,
      subject: s.subject,
      href: s.href,
    })),
  };
});
