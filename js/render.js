import { escapeHTML } from "./common.js";
import { readGroup } from "./parser.js";
import { resolveAsset } from "./core.js";
let mathQueue = Promise.resolve();
export function typeset(root) {
  mathQueue = mathQueue
    .catch(() => {})
    .then(async () => {
      if (!window.MathJax?.startup?.promise) return;
      await MathJax.startup.promise;
      if (root.isConnected) await MathJax.typesetPromise([root]);
    })
    .catch(() => {});
  return mathQueue;
}
export function clearMath(root) {
  try {
    window.MathJax?.typesetClear?.([root]);
  } catch {}
}
// All source text is escaped. Only these explicit document commands become HTML.
export function latexHTML(source, assets = {}, depth = 0) {
  if (depth > 30) return escapeHTML(source);
  let result = "",
    i = 0,
    text = String(source || "");
  const mathStart = (pos) =>
    text.startsWith("$$", pos)
      ? ["$$", "$$"]
      : text.startsWith("\\[", pos)
        ? ["\\[", "\\]"]
        : text.startsWith("\\(", pos)
          ? ["\\(", "\\)"]
          : text[pos] === "$"
            ? ["$", "$"]
            : null;
  while (i < text.length) {
    const math = mathStart(i);
    if (math) {
      let end = i + math[0].length;
      while ((end = text.indexOf(math[1], end)) >= 0 && text[end - 1] === "\\")
        end += math[1].length;
      if (end >= 0) {
        // URL, CSS and extension-loading commands are excluded from imported math.
        let raw = text
          .slice(i, end + math[1].length)
          .replace(
            /\\(?:href|url|class|cssId|style|htmlClass|htmlStyle|htmlId|htmlData|require)\b/g,
            "\\text",
          );
        result += `<span class="${math[0] === "$$" || math[0] === "\\[" ? "display-math" : "inline-math"}">${escapeHTML(raw)}</span>`;
        i = end + math[1].length;
        continue;
      }
    }
    if (text[i] === "\\") {
      const cmd = text
        .slice(i)
        .match(
          /^\\(includegraphics|textbf|textit|emph|underline|texttt)(?![a-zA-Z])/,
        );
      if (cmd) {
        let at = i + cmd[0].length;
        const option = readGroup(text, at, "[", "]");
        if (option) at = option.end;
        const group = readGroup(text, at);
        if (group) {
          if (cmd[1] === "includegraphics") {
            const src = resolveAsset(assets, group.value.trim());
            result += src
              ? `<figure class="problem-image"><img src="${escapeHTML(src)}" alt="${escapeHTML(group.value)}" loading="lazy" referrerpolicy="no-referrer"></figure>`
              : `<span class="missing-image">Image needed: ${escapeHTML(group.value)}</span>`;
          } else {
            const tag = {
              textbf: "strong",
              textit: "em",
              emph: "em",
              underline: "u",
              texttt: "code",
            }[cmd[1]];
            result += `<${tag}>${latexHTML(group.value, assets, depth + 1)}</${tag}>`;
          }
          i = group.end;
          continue;
        }
      }
      const wrapper = text
        .slice(i)
        .match(
          /^\\(begin|end)\{(center|figure|enumerate|itemize)\}(?:\[[^\]]*\])?/,
        );
      if (wrapper) {
        result +=
          wrapper[2] === "enumerate" || wrapper[2] === "itemize"
            ? wrapper[1] === "begin"
              ? '<div class="latex-list">'
              : "</div>"
            : "";
        i += wrapper[0].length;
        continue;
      }
      if (text.startsWith("\\item", i)) {
        result += '<br><span class="list-bullet">•</span> ';
        i += 5;
        continue;
      }
      if (text.startsWith("\\\\", i)) {
        result += "<br>";
        i += 2;
        continue;
      }
      const escaped = text.slice(i).match(/^\\([%&#_$])/);
      if (escaped) {
        result += escapeHTML(escaped[1]);
        i += 2;
        continue;
      }
    }
    if (text[i] === "\n") {
      if (text[i + 1] === "\n") {
        result += "<br><br>";
        while (text[i + 1] === "\n") i++;
      } else result += " ";
    } else if (text[i] === "~") result += "&nbsp;";
    else result += escapeHTML(text[i]);
    i++;
  }
  return result;
}
