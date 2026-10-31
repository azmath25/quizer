// Local autosave for unsaved editor state; cleared once the server save succeeds.
const prefix = "mathquiz.draft.";
export function drafts(key, { delay = 800 } = {}) {
  const name = prefix + key;
  let timer;
  const read = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(name));
      return raw && raw.value ? raw : null;
    } catch {
      return null;
    }
  };
  return {
    read,
    save(getValue) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(
            name,
            JSON.stringify({ at: Date.now(), value: getValue() }),
          );
        } catch {}
      }, delay);
    },
    clear() {
      clearTimeout(timer);
      localStorage.removeItem(name);
    },
  };
}
export function draftBanner(root, saved, { onRestore, onDiscard }) {
  const node = document.createElement("div");
  node.className = "notice info draft-banner";
  node.setAttribute("role", "status");
  node.innerHTML = `<span>Unsaved draft from ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(saved.at)}.</span><span class="actions"><button type="button" class="button primary small" data-restore>Restore</button><button type="button" class="button ghost small" data-discard>Discard</button></span>`;
  node.querySelector("[data-restore]").onclick = () => {
    onRestore(saved.value);
    node.remove();
  };
  node.querySelector("[data-discard]").onclick = () => {
    onDiscard();
    node.remove();
  };
  root.prepend(node);
}
