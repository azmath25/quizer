import { writeFile } from "node:fs/promises";
const indexes = [];
function add(
  collectionGroup,
  filters,
  order = "updatedAt",
  direction = "DESCENDING",
  queryScope = "COLLECTION",
) {
  if (filters.length === 0) return;
  const fields = filters.map((f) =>
    Array.isArray(f)
      ? { fieldPath: f[0], arrayConfig: "CONTAINS" }
      : { fieldPath: f, order: "ASCENDING" },
  );
  fields.push({ fieldPath: order, order: direction });
  indexes.push({ collectionGroup, queryScope, fields });
}
for (const subject of [[], ["subject"]])
  for (const [order, dir] of [
    ["updatedAt", "DESCENDING"],
    ["searchTitle", "ASCENDING"],
  ])
    add("catalog", subject, order, dir);
for (const visibility of [[], ["visibility"]])
  for (const [order, dir] of [
    ["updatedAt", "DESCENDING"],
    ["searchTitle", "ASCENDING"],
  ])
    add("quizzes", ["ownerId", "lifecycle", ...visibility], order, dir);
for (const scope of [
  ["ownerId", "lifecycle"],
  ["bankVisibility", "lifecycle"],
])
  for (const filter of [[], ["subject"], ["difficulty"], [["tags"]]])
    for (const [order, dir] of [
      ["updatedAt", "DESCENDING"],
      ["searchTitle", "ASCENDING"],
    ])
      add("problems", [...scope, ...filter], order, dir);
for (const group of ["quizzes", "problems"])
  for (const scope of [["ownerId"], ["lifecycle"], ["ownerId", "lifecycle"]])
    add(group, scope);
for (const scope of [
  ["uid"],
  ["uid", "accessStatus"],
  ["quizOwnerId", "accessStatus"],
])
  add("participants", scope, "updatedAt", "DESCENDING", "COLLECTION_GROUP");
add("participants", ["accessStatus"]);
for (const scope of [
  ["studentId"],
  ["studentId", "quizId"],
  ["studentId", "status"],
  ["studentId", "quizId", "status"],
  ["quizOwnerId"],
  ["quizOwnerId", "gradeState"],
  ["quizId"],
  ["quizId", "quizRevisionId"],
  ["quizId", "studentId"],
  ["quizId", "status"],
]) {
  add("attempts", scope, "startedAt");
  add("attempts", scope, "startedAt", "ASCENDING");
}
add("attempts", ["status"], "deadlineAt", "ASCENDING");
for (const filter of ["actorId", "actorRoleAtTime", "quizId", "action"])
  add("auditEvents", [filter], "occurredAt");
for (const scope of [["role"], ["accountStatus"], ["role", "accountStatus"]])
  add("roles", scope);
add("joinLinks", ["quizId"], "createdAt");
add("jobs", ["status"]);
add("jobs", ["status"], "updatedAt", "ASCENDING");
add("jobs", ["status"], "leaseExpiresAt", "ASCENDING");
add("assets", ["status"], "expiresAt", "ASCENDING");
const unique = [
  ...new Map(indexes.map((i) => [JSON.stringify(i), i])).values(),
];
const fieldOverrides = [];
for (const [group, fields] of Object.entries({
  revisions: ["statementLatex", "options", "questionAssetBindings", "source"],
  items: ["statementLatex", "options", "questionAssetBindings"],
  grading: [
    "acceptedAnswers",
    "explanationLatex",
    "rubricLatex",
    "solutionAssetBindings",
  ],
  answers: ["value"],
  changes: ["value"],
  jobs: ["input", "result"],
  requests: ["result"],
  attempts: ["order", "optionOrder", "settingsSnapshot", "uiState"],
}))
  for (const field of fields)
    fieldOverrides.push({
      collectionGroup: group,
      fieldPath: field,
      indexes: [],
    });
await writeFile(
  new URL("../firebase/firestore.indexes.json", import.meta.url),
  JSON.stringify({ indexes: unique, fieldOverrides }, null, 2) + "\n",
);
console.log(`${unique.length} query indexes generated.`);
