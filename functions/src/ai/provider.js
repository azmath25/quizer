import { DomainError } from "../../shared/schema.js";

// Provider boundary. Connect a real OCR/LLM pipeline here (see the architecture
// blueprint); the worker only needs `{ title, problemCount, latex }` back.
export const AI_CONNECTED = false;

export async function extractProblems() {
  throw new DomainError(
    "AI_NOT_CONNECTED",
    "No AI provider is connected yet, so this file could not be read.",
  );
}
