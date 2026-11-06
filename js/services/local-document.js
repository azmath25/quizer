/**
 * Browser-only document admission for Quizer's teacher Document Desk.
 * Check the actual file signature before creating preview URLs or upload requests.
 * This is NOT server authorization or a PDF malware scanner.
 */
export const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 512 * 1024;
const PDF = [37,80,68,70,45];
const PNG = [137,80,78,71,13,10,26,10];
const JPEG = [255,216,255];
const matches = (bytes, magic, offset = 0) =>
  magic.every((byte, index) => bytes[offset + index] === byte);

export async function inspectLocalDocument(file) {
  if (!file || typeof file.name !== "string" ||
      !Number.isSafeInteger(file.size) || file.size < 1 ||
      file.size > MAX_LOCAL_FILE_BYTES || typeof file.slice !== "function")
    throw new Error("Choose one nonempty file up to 10 MB.");
  const name = file.name.trim().slice(0, 160);
  const extension = name.split(".").pop().toLowerCase();
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let kind;
  if (extension === "pdf" && matches(head, PDF)) kind = "pdf";
  else if (extension === "png" && matches(head, PNG)) kind = "image";
  else if (["jpg","jpeg"].includes(extension) && matches(head, JPEG)) kind = "image";
  else if (extension === "webp" &&
    matches(head, [82,73,70,70]) && matches(head,[87,69,66,80],8)) kind = "image";
  else if (["txt","tex"].includes(extension) && file.size <= MAX_TEXT_FILE_BYTES)
    kind = "text";
  else throw new Error("Unsupported file or mismatched signature. Use PDF, PNG, JPEG, WebP, TXT or TeX.");

  if (kind !== "text") return {kind, name, size:file.size, text:""};
  const bytes = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
  catch { throw new Error("The text file must be valid UTF-8."); }
  if (text.includes("\u0000")) throw new Error("Binary content is not a text document.");
  return {kind, name, size:file.size, text};
}

export function teacherExcerpt(text, limit = 3800) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4000)
    throw new Error("Invalid excerpt limit.");
  return String(text ?? "").replace(/\r\n?/g,"\n").trim().slice(0,limit);
}

export function makeTeacherContext(text, filename) {
  const excerpt = teacherExcerpt(text, 3700);
  if (!excerpt) throw new Error("Paste or select source text before asking AI.");
  const label = String(filename||"Local source").replace(/[\u0000-\u001f]/g," ").slice(0,120);
  return ("Teacher-selected text from " + label +
    ". This is text supplied by the teacher, not validated PDF/image OCR.\n" +
    excerpt).slice(0,4000);
}
