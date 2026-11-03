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

function visibleTextIn(rect) {
  const out = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let scanned = 0;
  while (walker.nextNode() && scanned < 12000 && out.join("").length < MAX_SNIP_TEXT) {
    const node = walker.currentNode, value = node.textContent;
    if (!value?.trim()) continue;
    scanned += Math.min(value.length, 1000);
    const el = node.parentElement;
    if (!el || el.closest(
      "script, style, noscript, template, [hidden], [inert], " +
      "[aria-hidden='true'], details:not([open]), " +
      "#ai-assistant, .snip-page-layer, .snip-layer, header, footer, nav"
    )) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility !== "visible" ||
      Number(style.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some(r => intersects(r, rect))) continue;
    const normalized = normalizeSnipText(value);
    if (normalized && !seen.has(normalized)) {
      out.push(normalized);
      seen.add(normalized);
    }
  }
  // MathJax's rendered SVG may contain no readable DOM text. Extract ONLY
  // visible MathJax math items whose displayed rectangle intersects the snip.
  const mathItems = window.MathJax?.startup?.document?.math;
  if (mathItems?.[Symbol.iterator]) {
    for (const item of mathItems) {
      const r = item?.typesetRoot?.getBoundingClientRect?.();
      if (!intersects(r, rect)) continue;
      const latex = String(item.math ?? "").trim();
      if (latex && !seen.has(latex)) {
        out.push((item.display ? "\\[" : "\\(") + latex +
          (item.display ? "\\]" : "\\)"));
        seen.add(latex);
      }
      if (out.join("").length >= MAX_SNIP_TEXT) break;
    }
  }
  // Image descriptions help identify figures but don't leak signed URLs,
  // unreleased answer assets, or arbitrary image binary outside the selection.
  for (const img of document.querySelectorAll("img")) {
    if (img.closest("[hidden], [inert], [aria-hidden='true'], " +
      "details:not([open]), #ai-assistant, .snip-page-layer")) continue;
    if (!intersects(img.getBoundingClientRect(), rect)) continue;
    const description = normalizeSnipText(img.alt || "Selected diagram or image");
    if (description && !seen.has(description)) {
      out.push("[Figure: " + description + "]");
      seen.add(description);
    }
    if (out.join("").length >= MAX_SNIP_TEXT) break;
  }
  return normalizeSnipText(out.join("\n"));
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
