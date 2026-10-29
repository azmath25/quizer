export const API_VERSION = 2;
export const DEFAULT_SETTINGS = Object.freeze({
  durationSeconds: 1200,
  shuffleQuestions: false,
  shuffleOptions: false,
  allowBack: true,
  penalty: 0,
  scoreRelease: "immediate",
  solutionRelease: "manual",
});
export const LIMITS = Object.freeze({
  items: 500,
  choices: 12,
  problemBytes: 250000,
  documentBytes: 700000,
  imageBytes: 4194304,
  sourceBytes: 20971520,
  page: 100,
  questionPage: 20,
  answerBatch: 20,
  teacherBytes: 1073741824,
});
export class DomainError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.reason = reason;
    this.details = details;
  }
}
export function fail(reason, message, details) {
  throw new DomainError(reason, message, details);
}
export function assert(condition, reason, message, details) {
  if (!condition) fail(reason, message, details);
}
export function fields(object, allowed, label = "request") {
  assert(
    object && typeof object === "object" && !Array.isArray(object),
    "INVALID_FIELDS",
    `${label} must be an object.`,
  );
  for (const key of Object.keys(object))
    assert(
      allowed.includes(key),
      "INVALID_FIELDS",
      `Unknown ${label} field: ${key}`,
    );
  return object;
}
export function text(value, label, max = 30000, required = false) {
  assert(typeof value === "string", "INVALID_FIELDS", `${label} must be text.`);
  assert(
    value.length <= max && (!required || value.trim().length > 0),
    "INVALID_FIELDS",
    `${label} must contain ${required ? "1" : "0"}–${max} characters.`,
  );
  return value;
}
export function id(value, label = "ID") {
  assert(
    typeof value === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
      !["__proto__", "prototype", "constructor"].includes(value),
    "INVALID_FIELDS",
    `Invalid ${label}.`,
  );
  return value;
}
export function number(
  value,
  label,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  integer = false,
) {
  assert(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value)),
    "INVALID_FIELDS",
    `${label} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`,
  );
  return value;
}
export function enumeration(value, allowed, label) {
  assert(allowed.includes(value), "INVALID_FIELDS", `Invalid ${label}.`);
  return value;
}
export function bool(value, label) {
  assert(
    typeof value === "boolean",
    "INVALID_FIELDS",
    `${label} must be true or false.`,
  );
  return value;
}
export function version(actual, expected) {
  number(expected, "expected version", 0, Number.MAX_SAFE_INTEGER, true);
  assert(
    actual === expected,
    "VERSION_CONFLICT",
    "This was changed elsewhere. Reload before saving.",
    { actualVersion: actual, expectedVersion: expected },
  );
}
export function byteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
export function bounded(value, max = LIMITS.documentBytes) {
  assert(
    byteSize(value) < max,
    "INVALID_FIELDS",
    `Content exceeds the ${max} byte limit.`,
  );
  return value;
}
export function markup(value, label, maximum = 30000, required = false) {
  text(value, label, maximum, required);
  assert(
    !/\\(?:input|include(?!graphics)|write\d*|openout|read\d*|immediate|href|url|require|class|cssId|style|html\w*)\b/i.test(
      value,
    ),
    "INVALID_FIELDS",
    `${label} contains an unsupported LaTeX command.`,
  );
  return value;
}
export function bindings(value = {}) {
  fields(value, Object.keys(value), "image bindings");
  const out = {};
  assert(
    Object.keys(value).length <= 50,
    "INVALID_FIELDS",
    "Use at most 50 images per problem.",
  );
  for (const [alias, assetId] of Object.entries(value)) {
    assert(
      alias.length > 0 &&
        alias.length <= 180 &&
        !["__proto__", "constructor", "prototype"].includes(alias) &&
        !/[\x00-\x1f]/.test(alias),
      "INVALID_FIELDS",
      "Invalid image filename.",
    );
    out[alias] = id(assetId, "asset ID");
  }
  return out;
}
export function validateMetadata(input) {
  fields(
    input,
    ["title", "subject", "difficulty", "tags", "bankVisibility"],
    "metadata",
  );
  const tags = input.tags ?? [];
  assert(
    Array.isArray(tags) && tags.length <= 12,
    "INVALID_FIELDS",
    "Use at most 12 tags.",
  );
  return {
    title: text(input.title, "Title", 200, true).trim(),
    subject: text(input.subject ?? "", "Subject", 80),
    difficulty: text(input.difficulty ?? "", "Difficulty", 40),
    tags: [...new Set(tags.map((t) => text(t, "Tag", 60, true).trim()))],
    bankVisibility: enumeration(
      input.bankVisibility ?? "private",
      ["private", "teachers"],
      "bank visibility",
    ),
  };
}
export function validateProblem(content, grading) {
  fields(
    content,
    [
      "type",
      "answerMode",
      "statementLatex",
      "options",
      "defaultPoints",
      "questionAssetBindings",
    ],
    "content",
  );
  fields(
    grading,
    [
      "correctOptionId",
      "acceptedAnswers",
      "tolerance",
      "explanationLatex",
      "rubricLatex",
      "solutionAssetBindings",
    ],
    "grading",
  );
  const type = enumeration(content.type, ["choice", "open"], "problem type");
  const answerMode = enumeration(
    content.answerMode ?? "auto",
    ["auto", "manual"],
    "answer mode",
  );
  assert(
    type !== "choice" || answerMode === "auto",
    "INVALID_FIELDS",
    "Multiple choice questions use automatic marking.",
  );
  const options = content.options ?? [];
  assert(
    Array.isArray(options) &&
      options.length <= (type === "choice" ? 12 : 0) &&
      (type !== "choice" || options.length >= 2),
    "INVALID_FIELDS",
    "Multiple choice requires 2–12 choices; open problems have none.",
  );
  const seen = new Set();
  const normalized = options.map((o) => {
    fields(o, ["id", "textLatex"], "choice");
    id(o.id);
    assert(!seen.has(o.id), "INVALID_FIELDS", "Choice IDs must be unique.");
    seen.add(o.id);
    return { id: o.id, textLatex: markup(o.textLatex, "Choice", 10000, true) };
  });
  const correctOptionId =
    type === "choice" ? id(grading.correctOptionId, "correct choice") : null;
  assert(
    type !== "choice" || seen.has(correctOptionId),
    "INVALID_FIELDS",
    "Select one of the choices as the answer.",
  );
  const acceptedAnswers = grading.acceptedAnswers ?? [];
  assert(
    Array.isArray(acceptedAnswers) && acceptedAnswers.length <= 30,
    "INVALID_FIELDS",
    "Use at most 30 accepted answers.",
  );
  acceptedAnswers.forEach((a) => text(a, "Accepted answer", 500, true));
  assert(
    type !== "open" || answerMode === "manual" || acceptedAnswers.length > 0,
    "INVALID_FIELDS",
    "Automatic open problems need an accepted answer.",
  );
  const result = {
    content: {
      type,
      answerMode,
      statementLatex: markup(content.statementLatex, "Statement", 30000, true),
      options: normalized,
      defaultPoints: number(
        content.defaultPoints ?? 1,
        "Points",
        0.00000001,
        1000,
      ),
      questionAssetBindings: bindings(content.questionAssetBindings),
    },
    grading: {
      gradingVersion: 1,
      correctOptionId,
      acceptedAnswers:
        type === "choice" || answerMode === "manual" ? [] : acceptedAnswers,
      tolerance: number(grading.tolerance ?? 0.000001, "Tolerance", 0, 1),
      explanationLatex: markup(grading.explanationLatex ?? "", "Solution"),
      rubricLatex: markup(grading.rubricLatex ?? "", "Marking rubric"),
      solutionAssetBindings: bindings(grading.solutionAssetBindings),
    },
  };
  for (const [name, assetId] of Object.entries(
    result.content.questionAssetBindings,
  ))
    assert(
      !Object.hasOwn(result.grading.solutionAssetBindings, name) ||
        result.grading.solutionAssetBindings[name] === assetId,
      "INVALID_FIELDS",
      `Use different filenames for different question and solution images: ${name}`,
    );
  for (const [source, map] of [
    [
      result.content.statementLatex +
        " " +
        normalized.map((o) => o.textLatex).join(" "),
      result.content.questionAssetBindings,
    ],
    [
      result.grading.explanationLatex + " " + result.grading.rubricLatex,
      result.grading.solutionAssetBindings,
    ],
  ]) {
    for (const match of source.matchAll(
      /\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
    ))
      assert(
        Object.hasOwn(map, match[1].trim()),
        "INVALID_FIELDS",
        `Image needed: ${match[1].trim()}`,
      );
  }
  return bounded(result, LIMITS.problemBytes);
}
export function validateSettings(input, previous = DEFAULT_SETTINGS) {
  fields(input, Object.keys(DEFAULT_SETTINGS), "settings");
  const value = { ...previous, ...input };
  number(value.durationSeconds, "Time limit", 0, 86400, true);
  number(value.penalty, "Penalty", 0, 1000);
  for (const name of ["shuffleQuestions", "shuffleOptions", "allowBack"])
    bool(value[name], name);
  enumeration(
    value.scoreRelease,
    ["immediate", "afterClose", "manual"],
    "score release",
  );
  enumeration(
    value.solutionRelease,
    ["immediate", "afterClose", "manual", "never"],
    "solution release",
  );
  return value;
}
export function timestampInput(value, label) {
  if (value === null) return null;
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      Number.isFinite(Date.parse(value)),
    "INVALID_FIELDS",
    `Invalid ${label}.`,
  );
  return new Date(value);
}
export function assetIds(content, grading = {}) {
  return [
    ...new Set([
      ...Object.values(content.questionAssetBindings ?? {}),
      ...Object.values(grading.solutionAssetBindings ?? {}),
    ]),
  ];
}
export function studentItem(item) {
  return {
    itemId: item.itemId,
    type: item.type,
    answerMode: item.answerMode,
    statementLatex: item.statementLatex,
    options: item.options.map((o) => ({ id: o.id, textLatex: o.textLatex })),
    points: item.points,
    questionAssetBindings: item.questionAssetBindings,
  };
}
export function fromLegacyQuestion(q, assets = {}) {
  const pick = (source) =>
    Object.fromEntries(
      [...source.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)]
        .map((m) => [
          m[1].trim(),
          assets[m[1].trim()] ??
            Object.entries(assets).find(
              ([name]) =>
                name === m[1].trim().replaceAll("\\", "/").split("/").at(-1) ||
                name.replace(/\.[^.]+$/, "") ===
                  m[1].trim().replaceAll("\\", "/").split("/").at(-1),
            )?.[1],
        ])
        .filter(([, v]) => v),
    );
  return {
    metadata: {
      title: `Problem ${q.id}`,
      subject: "",
      difficulty: "",
      tags: [],
      bankVisibility: "private",
    },
    content: {
      type: q.type,
      answerMode: q.answerMode,
      statementLatex: q.prompt,
      options: (q.options ?? []).map((o) => ({ id: o.id, textLatex: o.text })),
      defaultPoints: q.points,
      questionAssetBindings: pick(
        q.prompt + " " + (q.options ?? []).map((o) => o.text).join(" "),
      ),
    },
    grading: {
      correctOptionId: q.answer ?? null,
      acceptedAnswers: q.answers ?? [],
      tolerance: q.tolerance ?? 0.000001,
      explanationLatex: q.explanation ?? "",
      rubricLatex: "",
      solutionAssetBindings: pick(q.explanation ?? ""),
    },
  };
}
