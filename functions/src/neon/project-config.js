// Server-only, disabled-by-default Neon connection configuration.
// No browser import, no network activity and no connection on module import.
// Connection URL is deliberately never included in thrown errors.
const ID = /^[a-z0-9-]{1,60}$/;
const DB = /^quizer(?:_[a-z0-9_]+)?$/;
const ROLE = /^quizer_(?:app|reader)$/;

export function quizerNeonConfig(env = process.env) {
  if (env.QUIZER_NEON_ENABLED !== "true")
    return Object.freeze({ enabled: false });

  const projectId = env.QUIZER_NEON_PROJECT_ID;
  const mimoProjectId = env.MIMO_NEON_PROJECT_ID;
  if (!ID.test(projectId ?? "") || !ID.test(mimoProjectId ?? "") ||
      projectId === mimoProjectId)
    throw new Error("Quizer requires its own approved Neon project, separate from Mimo.");

  const raw = env.QUIZER_NEON_DATABASE_URL;
  if (typeof raw !== "string" || !raw)
    throw new Error("A server-only Quizer database URL is required.");

  let url;
  try { url = new URL(raw); }
  catch { throw new Error("Invalid Quizer PostgreSQL URL."); }

  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") ||
      url.hostname === ".neon.tech" ||
      url.hash || !ROLE.test(decodeURIComponent(url.username)) ||
      !DB.test(decodeURIComponent(url.pathname.slice(1))) ||
      url.searchParams.get("sslmode") !== "require")
    throw new Error("Quizer database host, role, name, or TLS setting is unsafe.");

  const names = new Set([...url.searchParams.keys()]);
  if ([...names].some(k => k !== "sslmode"))
    throw new Error("Unexpected Quizer database URL parameters.");

  return Object.freeze({
    enabled: true,
    projectId,
    database: decodeURIComponent(url.pathname.slice(1)),
    // Keep secrets server-only; callers must never JSON-serialize the config.
    getConnectionString() { return raw; },
  });
}
