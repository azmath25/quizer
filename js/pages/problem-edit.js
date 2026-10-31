import { go } from "../core/router.js";
import { api } from "../services/api.js";
import {
  pageHead,
  linkButton,
  action,
  message,
  notice,
} from "../components/ui.js";
import { problemForm, blankProblem } from "../components/problem-form.js";
export async function mount(root, session) {
  const params = new URLSearchParams(location.search);
  let problemId = params.get("id"),
    data = problemId ? await api("getProblem", { problemId }) : null,
    expectedVersion = data?.problem.version;
  const own =
    !data ||
    data.problem.ownerId === session.user.uid ||
    session.capabilities.admin;
  root.innerHTML =
    pageHead(
      data ? data.problem.title : "New problem",
      "Save a reusable problem with its answer, points and images.",
      linkButton("Problem bank", "problems.html", "secondary"),
    ) +
    (!own
      ? notice(
          "This problem is shared by another teacher. Make your own copy to edit it.",
        ) +
        '<button class="button primary" id="fork">Make an editable copy</button>'
      : "") +
    '<div id="editor"></div>';
  action(root, "#fork", async () => {
    const copy = await api("forkProblem", {
      problemId,
      revisionId: data.revisionId,
    });
    go(`problem-edit.html?id=${copy.problemId}`);
  });
  const initial = data
    ? {
        problemId,
        revisionNumber: data.content.revisionNumber,
        metadata: {
          title: data.problem.title,
          subject: data.problem.subject,
          difficulty: data.problem.difficulty,
          tags: data.problem.tags,
          bankVisibility: data.problem.bankVisibility,
        },
        content: data.content,
        grading: data.grading,
      }
    : blankProblem();
  await problemForm(root.querySelector("#editor"), {
    initial,
    context: data
      ? { kind: "problem", id: problemId, revisionId: data.revisionId }
      : null,
    readOnly: !own,
    onSave: async (value) => {
      const result = await api(
        problemId ? "saveProblemRevision" : "createProblem",
        { ...value, ...(problemId ? { problemId, expectedVersion } : {}) },
      );
      problemId = result.problemId;
      expectedVersion = result.version;
      history.replaceState(null, "", `problem-edit.html?id=${problemId}`);
      if (params.get("returnTo")) {
        const banner = document.createElement("p");
        banner.className = "notice success";
        banner.textContent =
          "Problem saved. Return to the quiz editor to add it from the bank.";
        root.prepend(banner);
      }
    },
  });
}
