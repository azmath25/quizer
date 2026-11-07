/**
 * Deliberately small Markdown + MathJax renderer for untrusted AI replies.
 * It never parses model text as HTML. Math is added as plain-text TeX nodes
 * for the site's restricted, local MathJax configuration to typeset.
 */
const INLINE = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\x60[^\x60\n]+\x60|\[[^\]\n]+\]\([^)]+\))/g;
const UNSAFE_TEX = /\\(?:href|url|style|require|class|cssId|htmlClass|htmlStyle|htmlId|htmlData|includegraphics|input)\b/gi;

function inline(parent, input, depth = 0) {
  if (depth > 3) { parent.append(document.createTextNode(input)); return; }
  const regex = new RegExp(INLINE.source, "g");
  let last = 0;
  for (const match of input.matchAll(regex)) {
    const token = match[0];
    if (match.index > last) parent.append(document.createTextNode(input.slice(last, match.index)));
    let node;
    if (token.startsWith("$") || token.startsWith("\\(") || token.startsWith("\\[")) {
      node = document.createElement("span");
      node.className = "qa-math";
      node.textContent = token.replace(UNSAFE_TEX, "\\text");
      node.qaOriginalTex = token;
    } else if (token.charCodeAt(0) === 96) {
      node = document.createElement("code");
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      node = document.createElement("strong");
      inline(node, token.slice(2, -2), depth + 1);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      node = document.createElement("em");
      inline(node, token.slice(1, -1), depth + 1);
    } else {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const url = parts?.[2]?.trim() || "";
      if (/^https?:\/\/[^/\s]+/i.test(url)) {
        node = document.createElement("a");
        node.href = url;
        node.target = "_blank";
        node.rel = "noopener noreferrer";
        node.textContent = parts[1];
      } else {
        node = document.createTextNode(parts?.[1] || token);
      }
    }
    parent.append(node);
    last = match.index + token.length;
  }
  if (last < input.length) parent.append(document.createTextNode(input.slice(last)));
}

const isSpecial = (line) => /^(\s*$|#{1,3} |[-*] |[0-9]+\. |> |\x60{3}|\\\[|\$\$)/.test(line);

export function renderChatMarkdown(target, source) {
  // Model text is untrusted; bound DOM work and keep it entirely text-based.
  const lines = String(source || "").slice(0, 16000).replace(/\r\n?/g, "\n").split("\n");
  const output = document.createDocumentFragment();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("\x60\x60\x60")) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      i++;
      const contents = [];
      while (i < lines.length && !lines[i].startsWith("\x60\x60\x60")) contents.push(lines[i++]);
      if (i < lines.length) i++;
      code.textContent = contents.join("\n");
      pre.append(code); output.append(pre); continue;
    }
    if (line.startsWith("$$") || line.startsWith("\\[")) {
      const opener = line.startsWith("$$") ? "$$" : "\\[";
      const closer = opener === "$$" ? "$$" : "\\]";
      const chunks = [line];
      i++;
      let joined = chunks.join("\n");
      while (!joined.slice(opener.length).includes(closer) &&
          i < lines.length && lines[i].trim()) {
        chunks.push(lines[i++]);
        joined = chunks.join("\n");
      }
      if (!joined.slice(opener.length).includes(closer)) {
        const unfinished = document.createElement("pre");
        unfinished.className = "qa-tex-uncompiled";
        unfinished.textContent = "Uncompiled LaTeX (missing " + closer + "):\n" + joined;
        output.append(unfinished);
        continue;
      }
      const math = document.createElement("div");
      math.className = "qa-display-math qa-math";
      math.textContent = joined.replace(UNSAFE_TEX, "\\text");
      math.qaOriginalTex = joined;
      output.append(math); continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const node = document.createElement("h" + Math.min(heading[1].length + 2, 5));
      inline(node, heading[2]); output.append(node); i++; continue;
    }
    const unordered = /^[-*]\s+/.test(line);
    const ordered = /^\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      const itemPattern = ordered ? /^\d+\.\s+(.*)$/ : /^[-*]\s+(.*)$/;
      while (i < lines.length) {
        const match = itemPattern.exec(lines[i]);
        if (!match) break;
        const item = document.createElement("li");
        inline(item, match[1]); list.append(item); i++;
      }
      output.append(list); continue;
    }
    if (line.startsWith("> ")) {
      const quote = document.createElement("blockquote");
      const text = [];
      while (i < lines.length && lines[i].startsWith("> ")) text.push(lines[i++].slice(2));
      inline(quote, text.join("\n")); output.append(quote); continue;
    }
    const paragraph = document.createElement("p");
    const text = [lines[i++]];
    while (i < lines.length && !isSpecial(lines[i])) text.push(lines[i++]);
    inline(paragraph, text.join("\n")); output.append(paragraph);
  }
  target.replaceChildren(output);
}

/**
 * MathJax can render an unknown control sequence as an error marker.
 * Keep the original, unmodified model TeX available after typesetting,
 * and EXPAND it automatically when MathJax produced an error or failed.
 * No raw model HTML is added to the DOM.
 */
export async function typesetChatMarkdown(root, typeset) {
  const mathNodes = [...root.querySelectorAll(".qa-math")]
    .filter(node => typeof node.qaOriginalTex === "string")
    .map(node => ({node, raw:node.qaOriginalTex}));
  let failed = false;
  try { await typeset(root); } catch { failed = true; }
  for (const {node,raw} of mathNodes) {
    if (!node.isConnected || node.qaSourceAdded) continue;
    const invalid = failed || !!node.querySelector(
      "mjx-merror,.mjx-merror,.MathJax_Error,[data-mjx-error]"
    );
    const details = document.createElement("details");
    details.className = "qa-tex-source";
    details.open = invalid;
    const label = document.createElement("summary");
    label.textContent = invalid
      ? "LaTeX could not render — original source"
      : "View original LaTeX";
    const source = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = raw;
    source.append(code);
    details.append(label,source);
    node.qaSourceAdded = true;
    node.after(details);
  }
}
