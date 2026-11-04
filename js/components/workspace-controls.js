import { onLeave } from "../core/router.js";

/**
 * Client-only productivity controls shared by both teacher editors.
 * Submits the existing validated form; never bypasses its save/diff logic.
 */
export function installEditorWorkspace({ root, form }) {
  const grid = form?.querySelector(".editor-grid");
  const inspector = grid?.querySelector(".editor-preview");
  const actions = form?.querySelector(".editor-actions .actions");
  const submit = form?.querySelector('button[type="submit"]');
  if (!grid || !inspector || !actions || !submit) return () => {};

  if (!inspector.id) inspector.id = "workspace-inspector";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button ghost small inspector-toggle";
  toggle.setAttribute("aria-controls", inspector.id);
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "Hide preview";
  const changeInspector = () => {
    const closed = grid.dataset.inspector !== "closed";
    grid.dataset.inspector = closed ? "closed" : "open";
    toggle.setAttribute("aria-expanded", String(!closed));
    toggle.textContent = closed ? "Show preview" : "Hide preview";
  };
  toggle.addEventListener("click", changeInspector);
  actions.prepend(toggle);

  const hint = document.createElement("span");
  hint.className = "editor-keyboard-hint";
  hint.textContent = "Ctrl / ⌘ + S to save";
  form.querySelector(".save-state")?.after(hint);

  const saveKey = (event) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.shiftKey ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== "s" ||
      !form.contains(document.activeElement) ||
      submit.disabled
    ) return;
    event.preventDefault();
    // requestSubmit preserves constraint validation and bindForm callbacks.
    if (typeof form.requestSubmit === "function") form.requestSubmit(submit);
    else submit.click();
  };
  document.addEventListener("keydown", saveKey);
  const dispose = () => {
    document.removeEventListener("keydown", saveKey);
    toggle.removeEventListener("click", changeInspector);
  };
  onLeave(dispose);
  return dispose;
}

/**
 * Focuses the existing bank filter; the form's Apply button remains in charge
 * of retrieving data. Never changes selection, revisions, or API requests.
 */
export function installBankSearchShortcut(root) {
  const input = root.querySelector('form.toolbar input[name="q"]');
  if (!input) return () => {};
  input.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
  const toolbar = input.closest("form");
  const hint = document.createElement("p");
  hint.className = "bank-search-hint muted small";
  hint.textContent = "Tip: Ctrl / ⌘ + K focuses search · Apply to filter";
  toolbar?.after(hint);
  const searchKey = (event) => {
    if (
      event.defaultPrevented || event.repeat || event.altKey ||
      event.shiftKey || !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== "k"
    ) return;
    const active = document.activeElement;
    if (active !== input && active?.matches?.("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    input.focus();
    input.select();
  };
  document.addEventListener("keydown", searchKey);
  const dispose = () => document.removeEventListener("keydown", searchKey);
  onLeave(dispose);
  return dispose;
}
