/*
 * T1 browser smoke: paste this whole file into the developer console of
 * https://azmath25.github.io/quizer/ai.html while signed in as the teacher
 * who owns the PDF. It only calls Quizer's authenticated LIST, STATUS and
 * IMAGE GET callables; it never uploads a PDF or launches an AI run.
 *
 * Intended for temporary signed-in live testing without GitHub Actions.
 */
(async function t1ExistingMimoPngBrowserSmoke() {
  const TARGET_RUN = "7e8f42c3-514c-407c-b93a-4f85fe54bd71";
  const EXPECTED_SHA256 =
    "47c01a3158bdf1a84bb8b687f2cb8046bc9651f781193d6c060c2e346f5901f4";
  const EXPECTED_BYTES = 13527;

  if (location.hostname !== "azmath25.github.io" ||
      !location.pathname.endsWith("/quizer/ai.html"))
    throw Error("Open Quizer's production ai.html before testing.");

  const moduleUrl = new URL("js/services/mimo-extraction.js",
    new URL("./", location.href));
  const service = await import(moduleUrl.href);
  const listing = await service.listMimoBatches();
  if (!Array.isArray(listing?.jobs)) throw Error("Job list unavailable.");

  let match;
  // Bound status reads. One GET per job, never a new paid provider request.
  for (const summary of listing.jobs.slice(0, 20)) {
    const current = await service.readMimoBatch(summary.jobId);
    const page = current.pages?.find(p => p.runId === TARGET_RUN);
    if (page) {
      match = {jobId: summary.jobId, page, name: current.fileName};
      break;
    }
  }
  if (!match)
    throw Error("Existing Mimo run not found in your 20 newest owned Quizer jobs. " +
      "No AI calls were made. Confirm the original job is still available.");
  if (match.page.state !== "completed" || !match.page.hasReconstruction)
    throw Error("Mimo compiled the PNG, but Quizer has not marked this page " +
      "completed with a reconstructed figure. No new AI run was started.");

  const response = await service.readMimoBatchImage(match.jobId, match.page.number);
  const blob = service.decodeMimoPng(response);
  const bytes = await blob.arrayBuffer();
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    v => v.toString(16).padStart(2, "0")).join("");
  if (checksum !== EXPECTED_SHA256 || bytes.byteLength !== EXPECTED_BYTES ||
      (response.sha256 && response.sha256 !== checksum) ||
      (response.byteLength && response.byteLength !== bytes.byteLength))
    throw Error("Retrieved PNG failed the expected checksum/size test: " +
      checksum + " (" + bytes.byteLength + " bytes).");

  const parent = document.getElementById("ai-job-result") || document.body;
  const previous = document.getElementById("quizer-t1-compiled-png-smoke");
  if (previous) previous.remove();
  const panel = document.createElement("section");
  panel.id = "quizer-t1-compiled-png-smoke";
  panel.style.cssText = "padding:16px;margin:12px;border:1px solid #888;border-radius:8px";
  const header = document.createElement("h3");
  header.textContent = "T1 verified: compiled TikZ PNG — page " + match.page.number;
  const img = document.createElement("img");
  const url = URL.createObjectURL(blob);
  img.src = url;
  img.alt = "Mimo compiled graph from the teacher's original PDF";
  img.style.cssText = "display:block;max-width:100%;max-height:520px;object-fit:contain";
  const a = document.createElement("a");
  a.href = url; a.download = "page-" + match.page.number + "-tikz.png";
  a.textContent = "Download verified PNG";
  a.style.display = "inline-block";
  panel.append(header, img, a);
  parent.prepend(panel);
  console.log("T1_BROWSER_PNG_PASS", {
    sourceFile: match.name, pageNumber: match.page.number,
    mime: blob.type, bytes: bytes.byteLength, sha256: checksum,
    jobId: match.jobId, runId: TARGET_RUN,
    noPaidModelRequests: true
  });
})().catch(error => console.error("T1_BROWSER_PNG_FAIL", error.message));
