/** Pure, storage-independent quiz domain. A future backend can reuse this module. */
export const SCHEMA_VERSION = 1;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({
  shuffleQuestions: false,
  shuffleOptions: false,
  allowBack: true,
  showSolutions: true,
  penalty: 0,
});
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const totalPoints = (quiz) =>
  quiz.questions.reduce((s, q) => s + q.points, 0);
export function validateQuiz(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("This is not a quiz file.");
  if (input.schemaVersion !== SCHEMA_VERSION)
    throw new Error(
      "Unsupported quiz version. Use a version 1 .quiz.json file.",
    );
  if (
    !Array.isArray(input.questions) ||
    !input.questions.length ||
    input.questions.length > 500
  )
    throw new Error("A quiz needs between 1 and 500 questions.");
  const str = (s, max = 30000) => String(s ?? "").slice(0, max);
  const number = (n, min, max, fallback, label) => {
    if (n === undefined) return fallback;
    if (
      n === null ||
      n === "" ||
      !Number.isFinite(Number(n)) ||
      Number(n) < min ||
      Number(n) > max
    )
      throw new Error(`${label} must be between ${min} and ${max}.`);
    return Number(n);
  };
  const assets = {};
  for (const [name, data] of Object.entries(input.assets || {})) {
    if (
      /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(
        String(data),
      ) &&
      String(data).length <= 6 * 1024 * 1024
    )
      assets[str(name, 250)] = data;
  }
  const seen = new Set();
  const questions = input.questions.map((q, i) => {
    if (!q || !["choice", "open"].includes(q.type))
      throw new Error(`Question ${i + 1}: type must be choice or open.`);
    if (!str(q.prompt).trim())
      throw new Error(`Question ${i + 1} has no problem statement.`);
    const id = str(q.id || `q${i + 1}`, 100);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) || id in Object.prototype)
      throw new Error(
        `Question ${i + 1} needs an ID made of letters, digits, underscores, or hyphens.`,
      );
    if (seen.has(id)) throw new Error(`Question ${i + 1} has a duplicate ID.`);
    seen.add(id);
    const result = {
      id,
      type: q.type,
      prompt: str(q.prompt),
      points: number(
        q.points,
        Number.MIN_VALUE,
        1000,
        1,
        `Question ${i + 1} points`,
      ),
      explanation: str(q.explanation),
      answerMode: q.answerMode === "manual" ? "manual" : "auto",
      tolerance: number(
        q.tolerance,
        0,
        1e6,
        1e-6,
        `Question ${i + 1} tolerance`,
      ),
    };
    if (q.type === "choice") {
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 12
      )
        throw new Error(`Question ${i + 1} needs 2–12 choices.`);
      const ids = new Set();
      result.options = q.options.map((o, j) => {
        const option = { id: str(o.id || `o${j + 1}`, 100), text: str(o.text) };
        if (!option.text.trim() || ids.has(option.id))
          throw new Error(`Question ${i + 1} has empty or duplicate choices.`);
        ids.add(option.id);
        return option;
      });
      result.answer = str(q.answer, 100);
      if (!ids.has(result.answer))
        throw new Error(`Question ${i + 1} needs one correct choice.`);
      result.answerMode = "auto";
    } else {
      result.answers = (Array.isArray(q.answers) ? q.answers : [])
        .map((a) => str(a, 500).trim())
        .filter(Boolean)
        .slice(0, 30);
      if (!result.answers.length && result.answerMode !== "manual")
        throw new Error(
          `Question ${i + 1} needs an answer key, or self-marking enabled.`,
        );
    }
    return result;
  });
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of [
    "shuffleQuestions",
    "shuffleOptions",
    "allowBack",
    "showSolutions",
  ])
    if (typeof input.settings?.[key] === "boolean")
      settings[key] = input.settings[key];
  settings.penalty = number(
    input.settings?.penalty,
    0,
    1000,
    0,
    "Incorrect answer penalty",
  );
  return {
    schemaVersion: 1,
    id: str(input.id || uid(), 100),
    title: str(input.title || "Untitled quiz", 150),
    description: str(input.description, 1500),
    subject: str(input.subject || "Mathematics", 60),
    difficulty: str(input.difficulty || "Mixed", 40),
    durationMinutes: number(input.durationMinutes, 0, 1440, 20, "Time limit"),
    settings,
    assets,
    questions,
  };
}

function stripOuterMath(value) {
  return String(value)
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .trim();
}
export function normalizeAnswer(value) {
  return stripOuterMath(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:text|mathrm|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/[\s{}]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/\\[,;! ]/g, "");
}

/** A bounded recursive descent arithmetic evaluator. Never executes input as JS. */
export function numericValue(value) {
  let s = stripOuterMath(value)
    .toLowerCase()
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π|\\pi/g, "pi")
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:cdot|times)/g, "*")
    .replace(/\\[,;! ]/g, "");
  if (s.length > 300) return null;
  // Expand nested LaTeX fractions and radicals, innermost first.
  for (let k = 0; k < 12; k++) {
    const old = s;
    s = s
      .replace(
        /\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
        "(($1)/($2))",
      )
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
    if (s === old) break;
  }
  s = s
    .replace(/[{}]/g, (m) => (m === "{" ? "(" : ")"))
    .replace(/\\sqrt/g, "sqrt")
    .replace(/\s+/g, "");
  if (!s || /[^0-9a-z.+\-*/^(),]/.test(s)) return null;
  // Numeric implicit multiplication, e.g. 2pi, 2(3+1), (1+1)(2+2).
  s = s
    .replace(/(\d|\))(?=pi|sqrt|abs|sin|cos|tan|ln|log|\()/g, "$1*")
    .replace(/\)(?=\d)/g, ")*");
  let pos = 0,
    depth = 0,
    operations = 0;
  const fail = () => {
    throw new Error("Invalid expression");
  };
  const peek = () => s[pos];
  function atom() {
    if (++depth > 40 || ++operations > 250) fail();
    let n;
    if (peek() === "(") {
      pos++;
      n = add();
      if (peek() !== ")") fail();
      pos++;
    } else {
      const num = s.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/);
      if (num) {
        pos += num[0].length;
        n = Number(num[0]);
      } else {
        const name = s.slice(pos).match(/^[a-z]+/);
        if (!name) fail();
        pos += name[0].length;
        if (name[0] === "pi") n = Math.PI;
        else if (name[0] === "e") n = Math.E;
        else {
          const fn = {
            sqrt: Math.sqrt,
            abs: Math.abs,
            sin: Math.sin,
            cos: Math.cos,
            tan: Math.tan,
            ln: Math.log,
            log: Math.log10,
          }[name[0]];
          if (!fn || peek() !== "(") fail();
          pos++;
          const x = add();
          if (peek() !== ")") fail();
          pos++;
          n = fn(x);
        }
      }
    }
    depth--;
    return n;
  }
  function power() {
    let n = atom();
    if (peek() === "^") {
      pos++;
      n = n ** unary();
    }
    return n;
  }
  function unary() {
    if (peek() === "+") {
      pos++;
      return unary();
    }
    if (peek() === "-") {
      pos++;
      return -unary();
    }
    return power();
  }
  function mul() {
    let n = unary();
    while (peek() === "*" || peek() === "/") {
      const op = s[pos++],
        v = unary();
      n = op === "*" ? n * v : n / v;
    }
    return n;
  }
  function add() {
    let n = mul();
    while (peek() === "+" || peek() === "-") {
      const op = s[pos++],
        v = mul();
      n = op === "+" ? n + v : n - v;
    }
    return n;
  }
  try {
    const n = add();
    return pos === s.length && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function gradeQuestion(question, answer, manualPoints) {
  if (answer == null || String(answer).trim() === "")
    return { status: "skipped", awarded: 0 };
  if (question.answerMode === "manual") {
    if (manualPoints == null) return { status: "pending", awarded: 0 };
    const awarded = Math.min(
      question.points,
      Math.max(0, Number(manualPoints) || 0),
    );
    return {
      status:
        awarded === question.points
          ? "correct"
          : awarded === 0
            ? "incorrect"
            : "partial",
      awarded,
    };
  }
  let correct;
  if (question.type === "choice") correct = answer === question.answer;
  else {
    const actual = numericValue(answer);
    correct = question.answers.some((expected) => {
      const target = numericValue(expected);
      // Numeric equivalence is checked first; textual normalization must not erase math braces.
      if (actual !== null && target !== null)
        return (
          Math.abs(actual - target) <=
          question.tolerance * Math.max(1, Math.abs(target))
        );
      if (actual !== null || target !== null) return false;
      return normalizeAnswer(answer) === normalizeAnswer(expected);
    });
  }
  return {
    status: correct ? "correct" : "incorrect",
    awarded: correct ? question.points : 0,
  };
}
export function gradeAttempt(quiz, attempt) {
  const counts = {
    correct: 0,
    incorrect: 0,
    skipped: 0,
    pending: 0,
    partial: 0,
  };
  let score = 0;
  const results = quiz.questions.map((q) => {
    const result = gradeQuestion(
      q,
      attempt.answers?.[q.id],
      attempt.manualScores?.[q.id],
    );
    if (result.status === "incorrect") result.awarded = -quiz.settings.penalty;
    counts[result.status]++;
    score += result.awarded;
    return { questionId: q.id, ...result };
  });
  return {
    ...counts,
    score: Math.round(score * 1e8) / 1e8,
    possible: totalPoints(quiz),
    results,
  };
}
export function makeAttempt(
  quiz,
  options = {},
  now = Date.now(),
  random = Math.random,
) {
  const shuffle = (items) => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const minutes = Number(options.durationMinutes ?? quiz.durationMinutes);
  return {
    id: uid(),
    quizId: quiz.id,
    quizSnapshot: quiz,
    startedAt: now,
    deadline: minutes > 0 ? now + minutes * 60000 : null,
    submittedAt: null,
    timedOut: false,
    current: 0,
    furthest: 0,
    answers: {},
    flags: [],
    manualScores: {},
    order: quiz.settings.shuffleQuestions
      ? shuffle(quiz.questions.map((q) => q.id))
      : quiz.questions.map((q) => q.id),
    optionOrder: Object.fromEntries(
      quiz.questions
        .filter((q) => q.type === "choice")
        .map((q) => [
          q.id,
          quiz.settings.shuffleOptions
            ? shuffle(q.options.map((o) => o.id))
            : q.options.map((o) => o.id),
        ]),
    ),
  };
}
export const remainingSeconds = (attempt, now = Date.now()) =>
  attempt.deadline == null
    ? null
    : Math.max(0, Math.ceil((attempt.deadline - now) / 1000));
export const elapsedSeconds = (attempt) =>
  Math.max(
    0,
    Math.round(
      ((attempt.submittedAt || Date.now()) - attempt.startedAt) / 1000,
    ),
  );
export function imageReferences(quiz) {
  const refs = new Set();
  for (const q of quiz.questions)
    for (const part of [
      q.prompt,
      q.explanation,
      ...(q.options || []).map((o) => o.text),
    ]) {
      for (const m of String(part).matchAll(
        /\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
      ))
        refs.add(m[1]);
    }
  return [...refs];
}
export function resolveAsset(assets, name) {
  if (Object.hasOwn(assets, name)) return assets[name];
  const basename = name.replace(/\\/g, "/").split("/").pop();
  return Object.entries(assets).find(
    ([key]) => key === basename || key.replace(/\.[^.]+$/, "") === basename,
  )?.[1];
}
