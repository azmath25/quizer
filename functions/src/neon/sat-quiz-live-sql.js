// Explicit SAT QUIZ -> dedicated Neon live branch adapter.
// Server-side only: NEVER import in the browser or embed the database secret
// in GitHub Pages. This file does not register Firebase endpoints by itself.
import { quizerNeonConfig } from "./project-config.js";
import { createQuizerSqlPort } from "./sql-port.js";

export const SAT_QUIZ_NEON = Object.freeze({
  firebaseProject: "sat-quiz-fd317",
  neonProject: "soft-grass-35754518",
  neonBranch: "br-lucky-lake-b9pocorx",
  database: "quizer",
  role: "quizer_app",
  // Confirmed via Neon branch-specific connection metadata, 2026-11-04.
  pooledHostname: "ep-ancient-voice-b9jua9ew-pooler.c-7.eu-central-1.aws.neon.tech",
});

const DENIED = "Quizer SAT QUIZ Neon connection not authorized.";

// Defer all access to the secret until after Functions initialization:
// Firebase secret params are only available inside bound function instances.
export function createSatQuizNeonSql({
  enabled = false,
  firebaseProject = "",
  connectionString,
  // Tests can inject an in-memory driver; production uses server-only pg.
  createPool,
} = {}) {
  if (enabled !== true) return createQuizerSqlPort();
  if (firebaseProject !== SAT_QUIZ_NEON.firebaseProject ||
      typeof connectionString !== "string" ||
      connectionString.length < 20)
    throw new Error(DENIED);
  let uri;
  try { uri = new URL(connectionString); }
  catch { throw new Error(DENIED); }
  if (uri.hostname !== SAT_QUIZ_NEON.pooledHostname ||
      !uri.password || !uri.username ||
      decodeURIComponent(uri.username) !== SAT_QUIZ_NEON.role)
    throw new Error(DENIED);

  const config = quizerNeonConfig({
    QUIZER_NEON_ENABLED: "true",
    QUIZER_NEON_PROJECT_ID: SAT_QUIZ_NEON.neonProject,
    MIMO_NEON_PROJECT_ID: "curly-morning-89314985",
    QUIZER_NEON_DATABASE_URL: connectionString,
  });
  // The base port independently verifies the actual SQL role and its
  // non-elevated grants on every transaction.
  const verifiedDriverFactory = createPool ?? (async options => {
    const imported = await import("pg");
    const Pool = imported.default?.Pool ?? imported.Pool;
    if (typeof Pool !== "function") throw new Error(DENIED);
    return new Pool({
      ...options,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
  });
  return createQuizerSqlPort({
    enabled: true,
    config,
    createPool: verifiedDriverFactory,
    // This is a pinned server-approved branch endpoint. No URL/identity
    // claim originating from user JSON can change these coordinates.
    attestProject: async ({projectId, database, hostname}) =>
      projectId === SAT_QUIZ_NEON.neonProject &&
      database === SAT_QUIZ_NEON.database &&
      hostname === SAT_QUIZ_NEON.pooledHostname,
  });
}
