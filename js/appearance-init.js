try {
  const prefs = JSON.parse(localStorage.getItem("mathquiz.appearance") || "{}");
  document.documentElement.dataset.theme = ["light", "dark", "system"].includes(
    prefs.theme,
  )
    ? prefs.theme
    : "dark";
  document.documentElement.style.setProperty(
    "--text-scale",
    [1, 1.125, 1.25].includes(prefs.textScale) ? prefs.textScale : 1,
  );
} catch {}
