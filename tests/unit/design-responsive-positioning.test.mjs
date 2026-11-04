// Responsive positioning safeguards for the isolated AI Studio design branch.
// Source contracts supplement (but never replace) Chromium/Safari/Android QA.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const css = {
  layout: read("assets/css/layout.css"),
  account: read("assets/css/pages/account.css"),
  editor: read("assets/css/pages/editor.css"),
  admin: read("assets/css/pages/admin.css"),
  catalog: read("assets/css/pages/catalog.css"),
  home: read("assets/css/pages/home.css"),
  quiz: read("assets/css/pages/quiz.css"),
  reports: read("assets/css/pages/reports.css"),
};
const bank = read("js/pages/problems.js");
const profile = read("js/pages/profile.js");

test("responsive source CSS has balanced rule blocks and comments", () => {
  for (const [name, s] of Object.entries(css)) {
    let depth = 0, quote = null, comment = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], next = s[i + 1];
      if (comment) {
        if (ch === "*" && next === "/") { comment = false; i++; }
        continue;
      }
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && next === "*") { comment = true; i++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      assert(depth >= 0, name + ": premature closing brace");
    }
    assert.equal(depth, 0, name + ": unbalanced rules");
    assert.equal(comment, false, name + ": unfinished comment");
    assert.equal(quote, null, name + ": unfinished string");
  }
});

test("student layouts preserve safe mobile quiz and result controls", () => {
  assert.match(css.quiz, /runner-mobile-nav-clearance/);
  assert.match(css.quiz, /\.question-grid button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(css.quiz, /result-summary \.score-line\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css.quiz, /quiz-overview \.overview-body \.actions[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css.catalog, /form\.toolbar[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css.layout, /body\[data-page="activity"\] #activity-list \.list-row[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css.layout, /body\[data-page="home"\] \.workspace-grid/);
  assert.match(css.home, /body\[data-page="home"\] \.page-heading/);
});

test("desktop author/admin canvases are wider without modifying the mobile base", () => {
  for (const page of ["teaching", "quiz-manage", "quiz-editor", "problem-edit", "problems", "admin"]) {
    assert(css.layout.includes('[data-page="' + page + '"]'), page + " scoped desktop layout");
  }
  assert.match(css.layout, /@media \(min-width:\s*1101px\)[\s\S]*?max-width:\s*1440px;/);
  assert.match(css.editor, /body:is\(\[data-page="quiz-editor"\],\[data-page="problem-edit"\]\) \.editor-grid[\s\S]*?1\.35fr/);
  assert.match(css.admin, /#users-list \.list-row[\s\S]*?grid-template-columns:\s*40px minmax\(0,\s*1fr\) auto/);
  assert.match(css.reports, /body\[data-page="quiz-manage"\] #manage-panel \.workspace-grid/);
});

test("selection inspector uses side/top positioning for authors and phone-only dock", () => {
  assert.match(css.editor, /@media \(min-width:\s*900px\) and \(max-width:\s*1100px\)/);
  assert.match(css.editor, /@media \(min-width:\s*761px\) and \(max-width:\s*899px\)/);
  assert.match(css.editor, /\.selection-panel\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*70;[^}]*pointer-events:\s*auto;/s);
  assert.match(css.editor, /bottom:\s*var\(--mobile-nav-clearance,/);
  assert.match(css.editor, /\.sel-ctl \.icon-button\s*\{[^}]*min-width:\s*44px;/s);
  assert.match(bank, /let collapsed = mobileDock\.matches/);
  assert.match(bank, /tabletDock = matchMedia\("\(min-width: 761px\) and \(max-width: 899px\)"\)/);
  assert.match(bank, /panelHome\.prepend\(panel\)/);
  assert.match(bank, /panelHome\.append\(panel\)/);
  assert.match(bank, /document\.body\.append\(panel\)/);
  assert.match(bank, /compactSelection\.addEventListener\?\.\("change", syncSelectionViewport\)/);
});

test("profile sign out belongs near account identity and remains single-bound", () => {
  const first = profile.indexOf('class="profile-summary"');
  const action = profile.indexOf('id="logout"');
  const aside = profile.indexOf('<aside class="stack">');
  assert(first >= 0 && action > first && aside > action);
  assert.equal(profile.split('id="logout"').length - 1, 1);
  assert.match(profile, /action\(root,\s*"#logout",\s*logout\)/);
  assert.match(css.account, /profile-summary\s*\{[^}]*grid-template-columns:\s*60px minmax\(0,\s*1fr\)/s);
  assert.match(css.account, /@media \(max-width:\s*760px\)/);
});

test("no backend change is required by the responsive layout", () => {
  assert.match(bank, /api\("getProblem"/);
  assert.match(profile, /api\("updateProfile"/);
  assert.doesNotMatch(css.layout, /NEON_DATABASE_URL|FIREBASE_PRIVATE_KEY/);
});
