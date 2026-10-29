import { DEFAULT_SETTINGS, uid, validateQuiz } from "./legacy-core.js";

export function stripComments(source) {
  return source
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++)
        if (line[i] === "%") {
          let backslashes = 0;
          for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
          if (backslashes % 2 === 0) return line.slice(0, i);
        }
      return line;
    })
    .join("\n");
}
export function readGroup(text, start, open = "{", close = "}") {
  while (/\s/.test(text[start] || "") && start < text.length) start++;
  if (text[start] !== open) return null;
  let depth = 1,
    i = start + 1;
  for (; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) break;
  }
  if (depth !== 0) return null;
  return { value: text.slice(start + 1, i), start, end: i + 1 };
}
function command(text, name) {
  const re = new RegExp("\\\\" + name + "(?![A-Za-z])", "g"),
    m = re.exec(text);
  if (!m) return null;
  let at = re.lastIndex,
    option = readGroup(text, at, "[", "]");
  if (option) at = option.end;
  const group = readGroup(text, at);
  return group ? { ...group, start: m.index, option: option?.value } : null;
}
function takeCommand(text, name) {
  const found = command(text, name);
  return found
    ? {
        value: found.value,
        text: text.slice(0, found.start) + text.slice(found.end),
      }
    : { value: null, text };
}
function envBlocks(text, names) {
  const re = new RegExp("\\\\(begin|end)\\{(" + names.join("|") + ")\\}", "g");
  const blocks = [];
  let depth = 0,
    start = 0,
    bodyStart = 0,
    options = "";
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === "begin") {
      if (depth === 0) {
        start = m.index;
        bodyStart = re.lastIndex;
        const opt = readGroup(text, bodyStart, "[", "]");
        if (opt) {
          options = opt.value;
          bodyStart = opt.end;
        } else options = "";
      }
      depth++;
    } else if (depth > 0 && --depth === 0)
      blocks.push({
        start,
        end: re.lastIndex,
        body: text.slice(bodyStart, m.index),
        options,
      });
  }
  if (depth)
    throw new Error(
      "An environment is not closed. Check \\end{problem} or \\end{question}.",
    );
  return blocks;
}
/** Split top-level commands while ignoring nested environments and braced expressions. */
function splitTopLevel(text, commands) {
  const re = /\\(?:begin\{([^}]+)\}|end\{([^}]+)\}|([A-Za-z]+)\b)|[{}]/g;
  let env = 0,
    braces = 0,
    m;
  const marks = [];
  while ((m = re.exec(text))) {
    if (m[0] === "{") braces++;
    else if (m[0] === "}") braces = Math.max(0, braces - 1);
    else if (m[1]) env++;
    else if (m[2]) env = Math.max(0, env - 1);
    else if (!env && !braces && commands.includes(m[3]))
      marks.push({ start: m.index, end: re.lastIndex, name: m[3] });
  }
  return marks.map((mark, i) => ({
    ...mark,
    body: text.slice(mark.end, marks[i + 1]?.start ?? text.length),
  }));
}
function optionsFrom(value) {
  const result = {};
  if (/^\s*\d+(?:\.\d+)?\s*$/.test(value)) result.points = Number(value);
  for (const part of value.split(",")) {
    const [key, ...values] = part.split("=");
    if (values.length) result[key.trim()] = values.join("=").trim();
  }
  return result;
}
function cleanPrompt(text) {
  return text
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(?:vspace|hspace)\*?(?:\[[^\]]*\])?\s*\{[^}]*\}/g, "")
    .replace(
      /\\(?:newpage|clearpage|noindent|smallskip|medskip|bigskip)\b/g,
      "",
    )
    .trim();
}
export function parseLatex(source, { filename = "Untitled quiz" } = {}) {
  if (typeof source !== "string" || source.length > 2 * 1024 * 1024)
    throw new Error(
      "Use a LaTeX source file smaller than 2 MB. Add images separately.",
    );
  const text = stripComments(source.replace(/^\uFEFF/, ""));
  const warnings = [];
  let body = text;
  const document = text.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (document) body = document[1];
  let blocks = envBlocks(body, ["problem", "exercise", "question"]);
  if (!blocks.length) {
    // exam class: \begin{questions}\question[3] ...
    const exam = envBlocks(body, ["questions"])[0];
    if (exam)
      blocks = splitTopLevel(exam.body, ["question"]).map((p) => {
        const opt = readGroup(p.body, 0, "[", "]");
        return {
          body: opt ? p.body.slice(opt.end) : p.body,
          options: opt?.value || "",
        };
      });
  }
  if (!blocks.length) {
    const list = envBlocks(body, ["enumerate"])[0];
    if (list) {
      blocks = splitTopLevel(list.body, ["item"]).map((p) => ({
        body: p.body.replace(/^\s*\[[^\]]*\]/, ""),
        options: "",
      }));
      warnings.push(
        "Imported the first enumerate list as questions. Add \\answer{...} to each open problem.",
      );
    }
  }
  if (!blocks.length)
    throw new Error(
      "No problems found. Use problem/exercise environments, exam-class questions, or an enumerate list. Open the LaTeX guide for examples.",
    );
  if (blocks.length > 500)
    throw new Error(
      "Please split the file into quizzes of 500 questions or fewer.",
    );
  const questions = blocks.map((block, i) => {
    const opts = optionsFrom(block.options || "");
    let content = block.body;
    let answer = takeCommand(content, "answer");
    content = answer.text;
    const accepted = takeCommand(content, "accepted");
    content = accepted.text;
    let explanation = takeCommand(content, "explanation");
    content = explanation.text;
    const solutions = envBlocks(content, ["solution"]);
    if (solutions.length) {
      explanation.value = solutions[0].body;
      content =
        content.slice(0, solutions[0].start) + content.slice(solutions[0].end);
    }
    const pointCommand = takeCommand(content, "points");
    content = pointCommand.text;
    const p = Number(opts.points ?? pointCommand.value ?? 1);
    if (!Number.isFinite(p) || p <= 0 || p > 1000)
      throw new Error(
        `Question ${i + 1}: points must be greater than 0 and at most 1000.`,
      );
    const question = {
      id: `q${i + 1}`,
      type: "open",
      prompt: "",
      points: p,
      explanation: explanation.value || "",
      answers: [],
      answerMode: opts.mode === "manual" ? "manual" : "auto",
      tolerance: Number(opts.tolerance ?? 1e-6),
    };
    const choices = envBlocks(content, [
      "choices",
      "oneparchoices",
      "checkboxes",
    ])[0];
    if (choices) {
      const parts = splitTopLevel(choices.body, [
        "choice",
        "correctchoice",
        "CorrectChoice",
        "item",
      ]);
      if (parts.length < 2 || parts.length > 12)
        throw new Error(`Question ${i + 1}: use 2–12 choices.`);
      question.type = "choice";
      question.options = parts.map((part, j) => ({
        id: `o${j + 1}`,
        text: cleanPrompt(part.body),
      }));
      const corrects = parts
        .map((part, j) => (/correctchoice/i.test(part.name) ? j : -1))
        .filter((j) => j >= 0);
      if (corrects.length > 1)
        throw new Error(
          `Question ${i + 1}: this version supports one correct choice per question.`,
        );
      const index = corrects.length
        ? corrects[0]
        : /^[A-La-l]$/.test(answer.value?.trim() || "")
          ? answer.value.trim().toUpperCase().charCodeAt(0) - 65
          : Number(answer.value) - 1;
      if (!Number.isInteger(index) || !question.options[index])
        throw new Error(
          `Question ${i + 1}: mark one \\correctchoice, or use \\answer{B}.`,
        );
      question.answer = question.options[index].id;
      content = content.slice(0, choices.start) + content.slice(choices.end);
    } else {
      question.answers = [answer.value, accepted.value]
        .filter((v) => v != null)
        .flatMap((v) => v.split("|"))
        .map((v) => v.trim())
        .filter(Boolean);
      if (!question.answers.length) {
        question.answerMode = "manual";
        warnings.push(
          `Question ${i + 1} has no answer key. It will be marked by the teacher after submission.`,
        );
      }
    }
    question.prompt = cleanPrompt(content);
    if (!question.prompt)
      throw new Error(`Question ${i + 1} has an empty statement.`);
    return question;
  });
  if (
    /\\(?:begin\{tikzpicture\}|input\b|include\b|newcommand\b|def\b)/.test(text)
  )
    warnings.push(
      "TikZ, external TeX files, and custom macro definitions are not compiled. Export diagrams as images; use standard MathJax commands.",
    );
  const meta = (name, fallback) => command(text, name)?.value || fallback;
  const quiz = {
    schemaVersion: 1,
    id: uid(),
    title: meta("quiztitle", meta("title", filename.replace(/\.tex$/i, ""))),
    description: meta("quizdescription", ""),
    subject: meta("quizsubject", "Mathematics"),
    difficulty: meta("quizdifficulty", "Mixed"),
    durationMinutes: Number(meta("quiztime", "20")),
    settings: { ...DEFAULT_SETTINGS },
    assets: {},
    questions,
  };
  if (
    !Number.isFinite(quiz.durationMinutes) ||
    quiz.durationMinutes < 0 ||
    quiz.durationMinutes > 1440
  )
    throw new Error("Quiz time must be between 0 and 1440 minutes.");
  for (const [index, question] of quiz.questions.entries()) {
    if (
      question.prompt.length > 30000 ||
      question.explanation.length > 30000 ||
      (question.options || []).some((o) => o.text.length > 10000)
    )
      throw new Error(
        `Question ${index + 1}: statement, solution or choice exceeds the text limit.`,
      );
  }
  return { quiz: validateQuiz(quiz), warnings };
}
