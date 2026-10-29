import { pageHead, linkButton, e } from "../components/ui.js";
export async function mount(root) {
  const sample = String.raw`\quiztitle{Algebra practice}
\quizdescription{Equations and short proofs}
\quizsubject{Algebra}
\quizdifficulty{Intermediate}
\quiztime{20}

\begin{problem}[points=2]
What is $2^3$?
\begin{choices}
\choice $6$
\correctchoice $8$
\choice $9$
\end{choices}
\begin{solution}
$2^3 = 2\cdot2\cdot2 = 8$.
\end{solution}
\end{problem}

\begin{problem}[points=3,tolerance=0.000001]
Solve $2x=3$.
\answer{3/2}
\accepted{1.5}
\end{problem}

\begin{problem}[points=5]
Prove that the sum of two odd integers is even.
\begin{solution}
Write the integers as $2a+1$ and $2b+1$.
\end{solution}
\end{problem}`;
  root.innerHTML =
    pageHead(
      "LaTeX guide",
      "For teachers and administrators.",
      linkButton("Import a quiz", "upload.html", "primary", "upload"),
    ) +
    `<div class="workspace-grid"><div class="stack"><section class="panel"><h2>Supported quiz format</h2><p class="muted small">You do not need to compile your file. Upload .tex source, preview the problems, then import a private draft.</p><pre><code>${e(sample)}</code></pre></section><section class="panel"><h2>Images</h2><p>Upload raster images alongside the source and refer to their exact filenames:</p><pre><code>\\includegraphics{triangle.png}</code></pre><p class="muted small">PNG, JPEG, WebP and GIF · up to 4 MB and 16 megapixels per image. GIFs use their first frame. Export TikZ diagrams as images before importing. Image bytes are saved in Firebase Storage; problems contain references.</p></section><section class="panel"><h2>Other supported structures</h2><p><code>exercise</code> environments, exam-class <code>questions / \\question</code>, and a top-level <code>enumerate / \\item</code> list are supported. Nested lists stay within their parent problem.</p><p class="muted small">External TeX files, package execution, shell commands and custom macro definitions are not compiled. Unsupported markup is reported in the preview.</p></section></div><aside class="stack"><section class="panel"><h2>Marking</h2><ul class="small muted"><li>Use one <code>\\correctchoice</code> for a multiple-choice answer.</li><li><code>\\answer</code> gives an automatic short-answer key.</li><li>Use <code>\\accepted</code> for alternative answers.</li><li>Open problems without a key are teacher marked.</li><li>Arithmetic equivalence supports fractions and common numeric expressions. It is not a symbolic proof checker.</li></ul></section><section class="panel"><h2>Math notation</h2><p class="small muted">Use <code>$...$</code> or <code>\\(...\\)</code> for inline math and <code>\\[...\\]</code> for display math. MathJax renders both previews and student problems.</p></section><section class="panel"><h2>Examples</h2><div class="stack">${linkButton("Algebra source", "examples/algebra.tex", "secondary")}${linkButton("Mixed source", "examples/starter.tex", "secondary")}${linkButton("Triangle image", "examples/triangle.png", "secondary")}${linkButton("Exam-class source", "examples/exam-format.tex", "secondary")}</div></section></aside></div>`;
}
