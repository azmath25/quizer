import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../js/components/workspace-controls.js", import.meta.url),
  "utf8",
).replace(/^import \{ onLeave \} from "[^"]+";?\s*$/m, "")
 .replace(/export function/g, "function");

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.disabled = false;
    this.id = "";
  }
  setAttribute(k, value) { this.attributes[k] = value; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  removeEventListener(k, fn) { if (this.listeners[k] === fn) delete this.listeners[k]; }
  prepend(x) { this.children.unshift(x); }
  after(x) { this.afterNode = x; }
  contains(x) { return x === this || x === this.field; }
  querySelector(selector) { return this.map?.[selector] ?? null; }
  closest() { return this.parent; }
  matches() { return this.tag === "input"; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}
function fixture() {
  const listeners = new Map();
  const cleanups = [];
  const document = {
    activeElement: null,
    createElement: (type) => new Element(type),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {
      if (listeners.get(name) === fn) listeners.delete(name);
    },
  };
  const load = new Function(
    "onLeave", "document",
    source + "\nreturn { installEditorWorkspace, installBankSearchShortcut };",
  );
  return { ...load((cleanup) => cleanups.push(cleanup), document),
    listeners, cleanups, document };
}
function key(k, overrides = {}) {
  let prevented = false;
  const event = { key: k, ctrlKey: true, metaKey: false,
    altKey: false, shiftKey: false, defaultPrevented: false,
    repeat: false, preventDefault() { prevented = true; }, ...overrides };
  return { event, prevented: () => prevented };
}

test("Ctrl/Cmd+S reuses the form submission without bypassing disabled or unfocused controls", () => {
  const fx = fixture();
  const grid = new Element(), inspector = new Element("aside");
  const actions = new Element(), submit = new Element("button");
  const saveState = new Element(), form = new Element("form");
  const field = new Element("input");
  form.field = field;
  form.map = { ".editor-grid": grid, ".editor-actions .actions": actions,
    'button[type="submit"]': submit, ".save-state": saveState };
  grid.map = { ".editor-preview": inspector };
  let submissions = 0;
  form.requestSubmit = (button) => { assert.equal(button, submit); submissions++; };
  fx.document.activeElement = field;
  fx.installEditorWorkspace({ root: new Element(), form });

  const a = key("s");
  fx.listeners.get("keydown")(a.event);
  assert.equal(a.prevented(), true);
  assert.equal(submissions, 1);

  submit.disabled = true;
  fx.listeners.get("keydown")(key("s").event);
  assert.equal(submissions, 1);
  submit.disabled = false;
  fx.document.activeElement = new Element();
  fx.listeners.get("keydown")(key("s").event);
  assert.equal(submissions, 1);

  const cmd = key("S", { ctrlKey: false, metaKey: true });
  fx.document.activeElement = field;
  fx.listeners.get("keydown")(cmd.event);
  assert.equal(submissions, 2);
  fx.cleanups[0]();
  assert.equal(fx.listeners.has("keydown"), false);
});

test("desktop inspector button preserves preview identity and ARIA state", () => {
  const fx = fixture();
  const grid = new Element(), inspector = new Element("aside");
  inspector.id = "quiz-preview-panel";
  const actions = new Element(), submit = new Element("button");
  const form = new Element("form");
  form.map = { ".editor-grid": grid, ".editor-actions .actions": actions,
    'button[type="submit"]': submit };
  grid.map = { ".editor-preview": inspector };
  fx.installEditorWorkspace({ root: new Element(), form });
  const toggle = actions.children[0];
  assert.equal(toggle.attributes["aria-controls"], "quiz-preview-panel");
  toggle.listeners.click();
  assert.equal(grid.dataset.inspector, "closed");
  assert.equal(toggle.attributes["aria-expanded"], "false");
  toggle.listeners.click();
  assert.equal(grid.dataset.inspector, "open");
  assert.equal(toggle.attributes["aria-expanded"], "true");
});

test("Ctrl/Cmd+K focuses existing search, not backend or another editor", () => {
  const fx = fixture();
  const search = new Element("input");
  const toolbar = new Element("form");
  const root = new Element();
  search.parent = toolbar;
  root.map = { 'form.toolbar input[name="q"]': search };
  fx.document.activeElement = new Element();
  fx.installBankSearchShortcut(root);
  fx.listeners.get("keydown")(key("k").event);
  assert.equal(search.focused, true);
  assert.equal(search.selected, true);
  assert.match(search.attributes["aria-keyshortcuts"], /Meta\+K/);
  search.focused = false;
  fx.document.activeElement = new Element("input");
  fx.listeners.get("keydown")(key("k").event);
  assert.equal(search.focused, false);
  fx.cleanups[0]();
  assert.equal(fx.listeners.has("keydown"), false);
});
