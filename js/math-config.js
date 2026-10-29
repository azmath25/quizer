// Pinned, locally hosted MathJax. No CDN, font fetch, or TeX autoload is needed.
window.MathJax = {
  loader: { load: [] },
  tex: {
    inlineMath: [
      ["$", "$"],
      ["\\(", "\\)"],
    ],
    displayMath: [
      ["$$", "$$"],
      ["\\[", "\\]"],
    ],
    processEscapes: true,
    packages: ["base", "ams", "newcommand", "noundefined", "configmacros"],
    maxBuffer: 10000,
    maxMacros: 1000,
    macros: {
      R: "\\mathbb{R}",
      N: "\\mathbb{N}",
      Z: "\\mathbb{Z}",
      Q: "\\mathbb{Q}",
      C: "\\mathbb{C}",
    },
  },
  svg: { fontCache: "local" },
  options: { enableMenu: false },
  startup: { typeset: false },
};
