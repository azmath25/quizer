// Lightweight, offline mathematical input helper. Keeps the existing answer
// element and save flow authoritative; no third-party input or AI service.
const SYMBOLS = [
  ["√", "\\sqrt{}", 6], ["a/b", "\\frac{}{}", 6],
  ["x²", "^{2}", 1], ["xⁿ", "^{}", 2], ["xₙ", "_{}", 2],
  ["π", "\\pi", 3], ["±", "\\pm", 3], ["∞", "\\infty", 6],
  ["≤", "\\le", 3], ["≥", "\\ge", 3], ["×", "\\times", 6],
  ["θ", "\\theta", 6], ["∫", "\\int", 4], ["Σ", "\\sum", 4],
  ["(", "(", 1], [")", ")", 1],
];

export function mountMathAnswerEditor(input, { attemptId, itemId, onChange } = {}) {
  if (!input || input.closest(".math-answer-editor")) return () => {};
  const wrapper = document.createElement("div");
  wrapper.className = "math-answer-editor";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.append(input);

  const description = document.createElement("p");
  description.className = "muted small";
  description.textContent = "Type normally, tap symbols, or enter LaTeX. Handwriting is an optional scratchpad; transcribe your final answer to submit.";
  const actions = document.createElement("div");
  actions.className = "math-entry-actions";
  const keyboard = document.createElement("div");
  keyboard.className = "math-entry-keyboard";
  keyboard.setAttribute("aria-label", "Mathematical symbols");
  for (const [label, latex, cursor] of SYMBOLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button ghost small math-key";
    button.textContent = label;
    button.setAttribute("aria-label", "Insert " + label);
    button.addEventListener("pointerdown", event => event.preventDefault());
    button.onclick = () => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const addition = input.value.length + latex.length - (end - start);
      if (addition > input.maxLength && input.maxLength >= 0) return;
      input.setRangeText(latex, start, end, "end");
      const pos = start + cursor;
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    };
    keyboard.append(button);
  }
  const toggle = document.createElement("button");
  toggle.className = "button secondary small";
  toggle.type = "button";
  toggle.textContent = "Handwrite / draw";
  toggle.setAttribute("aria-expanded", "false");
  const pad = document.createElement("section");
  pad.className = "math-ink-area";
  pad.hidden = true;
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 260;
  canvas.setAttribute("aria-label", "Handwriting scratchpad, use touch or stylus");
  const tools = document.createElement("div");
  tools.className = "actions";
  const clear = document.createElement("button");
  clear.className = "button ghost small";
  clear.type = "button";
  clear.textContent = "Clear drawing";
  const tip = document.createElement("p");
  tip.className = "muted small";
  tip.textContent = "Draw with a finger, mouse or stylus. Drawing is a private working area, not your submitted response. Enter the interpreted expression in the answer field above.";
  tools.append(clear);
  pad.append(tip, canvas, tools);
  actions.append(toggle);
  wrapper.append(actions, keyboard, description, pad);

  const ctx = canvas.getContext("2d");
  let drawing = false, previous = null;
  const key = "mathquiz.ink." + String(attemptId || "") + "." + String(itemId || "");
  let strokes = [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || "[]");
    if (Array.isArray(parsed)) strokes = parsed.filter(s => Array.isArray(s) && s.length <= 5000).slice(0, 150);
  } catch {}
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3.5;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = "#183b59";
    for (const stroke of strokes) {
      ctx.beginPath();
      for (let i=0; i<stroke.length; i++) {
        const [x,y] = stroke[i];
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      if (stroke.length===1) ctx.lineTo(stroke[0][0]+0.2,stroke[0][1]+0.2);
      ctx.stroke();
    }
  }
  toggle.onclick = () => {
    pad.hidden = !pad.hidden;
    toggle.setAttribute("aria-expanded", String(!pad.hidden));
    if (!pad.hidden) render();
  };
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.round((event.clientX - rect.left) * canvas.width / rect.width),
      Math.round((event.clientY - rect.top) * canvas.height / rect.height)
    ];
  }
  canvas.addEventListener("pointerdown", event => {
    if (!ctx) return;
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    previous = [point(event)];
    strokes.push(previous);
    render();
  });
  canvas.addEventListener("pointermove", event => {
    if (!drawing || !previous) return;
    if (previous.length >= 5000) return;
    previous.push(point(event));
    render();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    previous = null;
    try { sessionStorage.setItem(key, JSON.stringify(strokes.slice(-150))); } catch {}
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  clear.onclick = () => { strokes=[]; sessionStorage.removeItem(key); render(); };
  return () => { finish(); };
}
