// Provider boundary for the teacher assistant. Replace `askAssistant` with a
// call to a Cloud Function that talks to a free AI provider; the UI only
// depends on the `{ reply, problems }` shape it returns.
export const AI_CONNECTED = false;

const DEMO = [
  {
    type: "short",
    statement: "Solve $3x-7=14$.",
    answer: "7",
    solution: "Add $7$ and divide by $3$: $x=21/3=7$.",
    points: 2,
  },
  {
    type: "choice",
    statement: "Which expression equals $(a+b)^2$?",
    options: [
      { text: "$a^2+b^2$" },
      { text: "$a^2+2ab+b^2$", correct: true },
      { text: "$a^2+ab+b^2$" },
      { text: "$2a^2+2b^2$" },
    ],
    solution: "Multiply $(a+b)(a+b)$ and collect like terms.",
    points: 2,
  },
  {
    type: "short",
    statement: "If $f(x)=2x^2-1$, find $f(3)$.",
    answer: "17",
    solution: "$f(3)=2\\cdot 9-1=17$.",
    points: 3,
  },
];

export async function askAssistant({ prompt = "", files = [], demo = false }) {
  if (demo) {
    await new Promise((r) => setTimeout(r, 900));
    return {
      reply:
        "Here is a sample extraction so you can try the actions. Real PDF reading arrives when a provider is connected.",
      problems: DEMO.map((p) => ({ ...p })),
      title: "Sample extraction",
    };
  }
  await new Promise((r) => setTimeout(r, 500));
  return {
    reply: files.length
      ? `I received ${files.length} file${files.length === 1 ? "" : "s"}, but no AI provider is connected yet, so nothing was extracted. Try the demo to explore the actions.`
      : "No AI provider is connected yet. Attach a PDF to see how it will work, or try the demo.",
    problems: [],
    notConnected: !AI_CONNECTED,
    prompt,
  };
}

// Builds the quiz LaTeX dialect understood by the importer.
export function toLatex(problems, title = "AI import") {
  const body = problems
    .map((p) => {
      const head = `\\begin{problem}[points=${p.points ?? 1}]\n${p.statement}`;
      const answer =
        p.type === "choice"
          ? `\n\\begin{choices}\n${(p.options ?? []).map((o) => (o.correct ? "\\correctchoice " : "\\choice ") + o.text).join("\n")}\n\\end{choices}`
          : p.answer
            ? `\n\\answer{${p.answer}}`
            : "";
      const solution = p.solution
        ? `\n\\begin{solution}${p.solution}\\end{solution}`
        : "";
      return `${head}${answer}${solution}\n\\end{problem}`;
    })
    .join("\n");
  return `\\quiztitle{${title}}\n${body}\n`;
}
