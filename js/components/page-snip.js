// Quizer in-page snipping. This mode uses ONLY the DOM already rendered in the
// current browser tab. No OS screenshot application, screen-share permission,
// browser extension, camera, clipboard or external network is involved.
// Visual diagrams should use the separate browser-tab pixel snip mode.
export const MAX_SNIP_TEXT = 8000;

export function intersects(a, b) {
  return !!a && !!b && a.right > b.left && a.left < b.right &&
    a.bottom > b.top && a.top < b.bottom;
}
export function normalizeSnipText(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, MAX_SNIP_TEXT);
}

// Build the selected text in DOCUMENT ORDER, not "all DOM text, then all
// equations". MathJax SVG contains rendered glyph nodes that are not TeX:
// they must be replaced by their original source, never appended after text.
const HIDDEN_SNIP = [
  "script","style","noscript","template","[hidden]","[inert]",
  "[aria-hidden='true']","details:not([open])",
  "#ai-assistant",".snip-page-layer",".snip-layer",
  "mjx-assistive-mml","header","footer","nav"
].join(", ");

export function formatSnipMath(latex, display = false) {
  if (typeof latex !== "string" || !latex.trim()) return "";
  const source = latex.trim();
  // Never truncate an equation in the middle of TeX syntax.
  if (source.length > 3800 || /[\u0000-\u0008\u000e-\u001f]/.test(source)) return "";
  return (display ? "\\[" : "\\(") + source + (display ? "\\]" : "\\)");
}

/**
 * Pure formatter for deterministic testing. A visual line/block is kept
 * together; different paragraph/list blocks remain separated. Identical
 * options are NOT deduplicated, because two questions may repeat them.
 */
export function assembleSnipFragments(fragments, max = MAX_SNIP_TEXT) {
  if (!Array.isArray(fragments) || !Number.isInteger(max) || max < 1) return "";
  const chunks = [];
  let length = 0, lastBlock = null;
  for (const fragment of fragments) {
    const value = String(fragment?.text ?? "").trim();
    if (!value) continue;
    const separator = chunks.length ? (fragment.block === lastBlock ? " " : "\n") : "";
    const remaining = max - length - separator.length;
    if (remaining <= 0) break;
    // A clipped LaTeX command is worse than an omitted one.
    if (fragment.kind === "math" && value.length > remaining) continue;
    const safe = fragment.kind === "math" ? value : value.slice(0, remaining);
    chunks.push(separator + safe);
    length += separator.length + safe.length;
    lastBlock = fragment.block;
    if (length >= max) break;
  }
  return normalizeSnipText(chunks.join(""));
}

function isSnipVisible(el) {
  if (!el || el.closest(HIDDEN_SNIP)) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility === "visible" &&
    Number(style.opacity) !== 0;
}

function snipBlock(el) {
  return el.closest("p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,tr,figcaption," +
    ".problem-card,.problem-content,.qa-message,.ai-msg") ||
    el.closest("div,section,article") || el;
}

function visibleTextIn(rect) {
  const fragments = [];
  let scanned = 0, budget = 0;
  const emit = (text,kind,el) => {
    if (!text || budget >= MAX_SNIP_TEXT) return;
    const value = kind === "math" ? text : normalizeSnipText(text);
    if (!value) return;
    fragments.push({text:value,kind,block:snipBlock(el)});
    budget += value.length + 1;
  };
  // Match the actual MathJax typeset roots and recover the TeX source.
  // A root may be an SVG under mjx-container, or the container itself.
  const mathRoots = new Map();
  const mathItems = window.MathJax?.startup?.document?.math;
  if (mathItems?.[Symbol.iterator]) {
    for (const item of mathItems) {
      const originalRoot = item?.typesetRoot;
      if (!originalRoot?.getBoundingClientRect) continue;
      const root = originalRoot.closest?.("mjx-container") || originalRoot;
      if (root?.nodeType !== 1) continue;
      mathRoots.set(root, formatSnipMath(String(item.math ?? ""),!!item.display));
    }
  }
  const walker = document.createTreeWalker(document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && scanned < 12000 && budget < MAX_SNIP_TEXT) {
    const node = walker.currentNode;
    if (node.nodeType === 1) {
      if (mathRoots.has(node)) {
        if (isSnipVisible(node) &&
            intersects(node.getBoundingClientRect(), rect)) {
          emit(mathRoots.get(node) ||
            "[Formula unavailable as LaTeX — use Visual snip]", "math", node);
        }
        continue;
      }
      if (node.tagName === "IMG" && isSnipVisible(node) &&
          intersects(node.getBoundingClientRect(),rect)) {
        const description = normalizeSnipText(node.alt || "Selected image");
        emit("[Figure: " + description + "]","image",node);
      }
      continue;
    }
    const value = node.textContent;
    if (!value?.trim()) continue;
    scanned += Math.min(value.length,1000);
    const el = node.parentElement;
    if (!isSnipVisible(el)) continue;
    // Never collect glyphs, accessibility MathML duplicates, or MathJax's
    // hidden source while also emitting the exact original TeX above.
    if (el.closest("mjx-container,.MathJax,mjx-assistive-mml,katex-mathml") ||
        [...mathRoots.keys()].some(root => root.contains?.(node))) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some(r => intersects(r,rect))) continue;
    emit(value,"text",el);
  }
  return assembleSnipFragments(fragments);
}

export function selectPageRegion() {
  return new Promise(resolve => {
    const layer = document.createElement("div");
    layer.className = "snip-page-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-label", "Select visible material to ask AI");
    layer.innerHTML =
      '<p class="snip-page-hint">Drag over a problem or formula · Esc to cancel</p>' +
      '<div class="snip-page-box" hidden></div>' +
      '<button class="snip-page-cancel" type="button" aria-label="Cancel snipping">✕</button>';
    const box = layer.querySelector(".snip-page-box");
    const cancel = layer.querySelector(".snip-page-cancel");
    let origin = null, region = null, pointer = null, finished = false;
    const teardown = value => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKey, true);
      layer.remove();
      resolve(value);
    };
    const onKey = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        teardown(null);
      }
    };
    const coord = event => ({
      x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
      y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
    });
    layer.addEventListener("pointerdown", event => {
      if (event.target.closest("button") || event.button !== 0) return;
      pointer = event.pointerId;
      origin = coord(event);
      region = null;
      layer.setPointerCapture(event.pointerId);
      box.hidden = false;
    });
    layer.addEventListener("pointermove", event => {
      if (!origin || event.pointerId !== pointer) return;
      const cur = coord(event);
      region = {
        left: Math.min(origin.x, cur.x),
        top: Math.min(origin.y, cur.y),
        right: Math.max(origin.x, cur.x),
        bottom: Math.max(origin.y, cur.y),
      };
      Object.assign(box.style, {
        left: region.left + "px", top: region.top + "px",
        width: region.right - region.left + "px",
        height: region.bottom - region.top + "px",
      });
    });
    layer.addEventListener("pointerup", event => {
      if (event.pointerId !== pointer) return;
      const selected = region && region.right - region.left >= 12 &&
        region.bottom - region.top >= 12 ? region : null;
      teardown(selected);
    });
    layer.addEventListener("pointercancel", () => teardown(null));
    cancel.onclick = () => teardown(null);
    document.addEventListener("keydown", onKey, true);
    document.body.append(layer);
  });
}

// Content mode makes no screenshot. Its text/LaTeX and visible image alt text
// are extracted strictly after the overlay is removed.
export async function snipPageContent() {
  const region = await selectPageRegion();
  if (!region) return null;
  return visibleTextIn(region) || null;
}
