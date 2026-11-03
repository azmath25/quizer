// QN4: a destructive schema rehearsal on an EXPLICITLY disposable *localhost*
// PostgreSQL database only. No Neon project, Mimo project or production access.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function assertDisposableTarget(connection, approval) {
  if (approval !== "YES_LOCAL_DISPOSABLE")
    throw new Error("QN4 requires QUIZER_QN4_APPROVAL=YES_LOCAL_DISPOSABLE");
  if (typeof connection !== "string")
    throw new Error("QN4 local disposable connection URL required");
  const u = new URL(connection);
  if (!["postgresql:", "postgres:"].includes(u.protocol))
    throw new Error("QN4 requires PostgreSQL");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    throw new Error("QN4 refuses non-local database hosts");
  const database = decodeURIComponent(u.pathname.slice(1));
  if (!/^quizer_qn4_disposable_[A-Za-z0-9_]{1,40}$/.test(database))
    throw new Error("QN4 refuses non-disposable database names");
  if (u.search || u.hash)
    throw new Error("QN4 refuses URL parameters/overrides");
  if (!u.username)
    throw new Error("QN4 local database user required");
  return { host: u.hostname, port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database };
}

function psql(file, target) {
  const env = {
    ...process.env,
    PGHOST: target.host, PGPORT: target.port, PGUSER: target.user,
    PGDATABASE: target.database, PGPASSWORD: target.password,
    PGSSLMODE: "disable", PGOPTIONS: "",
  };
  const run = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1",
    "-q", "-f", file], { env, encoding: "utf8", timeout: 120000 });
  if (run.error || run.status !== 0)
    throw new Error("Local psql rehearsal failed (" +
      (run.error?.code || run.status) + "): " +
      (run.stderr || "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED]").slice(-1000));
}

export function runQn4LocalRehearsal(connection, approval) {
  const target = assertDisposableTarget(connection, approval);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const migration = path.join(root, "db/quizer/001_initial_schema.sql");
  const cases = path.join(root, "tests/sql/qn4_disposable_rehearsal.sql");
  const rollback = path.join(root, "db/quizer/001_rollback_DISPOSABLE_ONLY.sql");
  // Cleanup even if the SQL tests fail. This target must be a fresh disposable
  // database with no quizer schema before this command starts.
  let started = false;
  try {
    started = true;
    psql(migration, target);
    psql(cases, target);
    return { passed: true, databaseKind: "localhost disposable", cleanedUp: true };
  } finally {
    if (started) psql(rollback, target);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runQn4LocalRehearsal(
    process.env.QUIZER_QN4_DATABASE_URL, process.env.QUIZER_QN4_APPROVAL,
  );
  console.log(JSON.stringify(result));
}
