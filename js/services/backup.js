import { unzipSync } from "../../assets/vendor/fflate.js";
export async function readBackup(file) {
  if (file.size > 20971520)
    throw new Error("Use backup ZIP files smaller than 20 MB.");
  let expanded = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      if (entry.name.endsWith("/")) return false;
      if (!entry.originalSize || entry.originalSize > 20971520)
        throw new Error("A backup entry is too large.");
      expanded += entry.originalSize;
      if (expanded > 104857600)
        throw new Error("The expanded backup exceeds 100 MB.");
      return (
        entry.name === "quiz.json" ||
        /^images\/[a-zA-Z0-9_.-]+$/.test(entry.name)
      );
    },
  });
  if (!entries["quiz.json"])
    throw new Error("The backup must contain quiz.json.");
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(entries["quiz.json"]),
  );
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "math-quiz-backup" ||
    !Array.isArray(manifest.records) ||
    manifest.records.length > 500
  )
    throw new Error("Unsupported quiz backup.");
  const files = [];
  for (const [assetId, meta] of Object.entries(manifest.assets ?? {})) {
    const bytes = entries[meta.path];
    if (!bytes) throw new Error("Missing backup image: " + meta.path);
    if (bytes.length > 4194304)
      throw new Error("A backup image exceeds the 4 MB import limit.");
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== meta.sha256)
      throw new Error("Backup image checksum mismatch: " + meta.path);
    const extension = meta.path.split(".").at(-1);
    const type = {
      png: "image/png",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    }[extension];
    if (!type) throw new Error("Unsupported backup image type.");
    files.push(new File([bytes], meta.path, { type }));
  }
  return { manifest, files };
}
export function backupQuiz(manifest) {
  const r = manifest.revision;
  return {
    schemaVersion: 1,
    id: "backup-preview",
    title: r.title,
    description: r.description,
    subject: r.subject,
    difficulty: r.difficulty,
    durationMinutes: r.settings.durationSeconds / 60,
    settings: r.settings,
    assets: {},
    questions: manifest.records.map(({ content: c, grading: g }, i) => ({
      id: "backup_" + i,
      type: c.type,
      answerMode: c.answerMode,
      prompt: c.statementLatex,
      options: c.options.map((o) => ({ id: o.id, text: o.textLatex })),
      points: c.points,
      answer: g.correctOptionId,
      answers: g.acceptedAnswers,
      tolerance: g.tolerance,
      explanation: g.explanationLatex,
    })),
  };
}
export function backupRecord(manifest, index, newAssets) {
  const { content: c, grading: g } = manifest.records[index];
  const convert = (map) =>
    Object.fromEntries(
      Object.entries(map ?? {}).map(([alias, oldId]) => {
        const file = manifest.assets[oldId]?.path;
        if (!file || !newAssets[file])
          throw new Error("Missing backup asset: " + oldId);
        return [alias, newAssets[file]];
      }),
    );
  return {
    metadata: {
      title: `${manifest.revision.title} — ${index + 1}`,
      subject: manifest.revision.subject,
      difficulty: manifest.revision.difficulty,
      tags: [],
      bankVisibility: "private",
    },
    content: {
      type: c.type,
      answerMode: c.answerMode,
      statementLatex: c.statementLatex,
      options: c.options,
      defaultPoints: c.points,
      questionAssetBindings: convert(c.questionAssetBindings),
    },
    grading: {
      correctOptionId: g.correctOptionId,
      acceptedAnswers: g.acceptedAnswers,
      tolerance: g.tolerance,
      explanationLatex: g.explanationLatex,
      rubricLatex: g.rubricLatex,
      solutionAssetBindings: convert(g.solutionAssetBindings),
    },
  };
}
