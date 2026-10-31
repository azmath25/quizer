import { latexHTML, typeset, clearMath } from "../render.js";
import { resolveImages } from "../services/assets.js";
import { e, points
} from "./ui.js";
export { latexHTML, typeset, clearMath };
export function problemPreview(
  content,
  grading = null,
  images = {},
  index = null,
  slotPoints = null,
) {
  return `<article class="preview-question"><div class="preview-meta"><span>${index === null ? "Problem" : "Problem " + (index + 1)} · ${content.type === "choice" ? "Multiple choice" : content.answerMode === "manual" ? "Written response" : "Short answer"}</span><span>${points(slotPoints ?? content.defaultPoints ?? content.points)} points</span></div><div class="math-content">${latexHTML(content.statementLatex, images)}</div>${content.options?.length ? `<ol class="preview-options">${content.options.map((o, i) => `<li><span class="option-letter">${String.fromCharCode(65 + i)}.</span><div class="math-content">${latexHTML(o.textLatex, images)}</div></li>`).join("")}</ol>` : ""}${grading ? `<details class="answer-key"><summary>Answer and solution</summary><p>${content.answerMode === "manual" ? "Teacher marked" : content.type === "choice" ? e(String.fromCharCode(65 + content.options.findIndex((o) => o.id === grading.correctOptionId))) : e(grading.acceptedAnswers.join(" or "))}</p><div class="math-content">${latexHTML(grading.explanationLatex || "", images)}</div>${grading.rubricLatex ? `<p class="small">Marking rubric</p><div class="math-content">${latexHTML(grading.rubricLatex, images)}</div>` : ""}</details>` : ""}</article>`;
}
export async function displayProblem(
  node,
  content,
  grading,
  context,
  index = null,
  slotPoints = null,
) {
  const images = await resolveImages(
    { ...content.questionAssetBindings, ...grading?.solutionAssetBindings },
    context,
  );
  clearMath(node);
  node.innerHTML = problemPreview(content, grading, images, index, slotPoints);
  await typeset(node);
}
