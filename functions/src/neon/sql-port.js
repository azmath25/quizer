// QN11.2: server-only, default-OFF, dependency-injected PostgreSQL port.
// There is NO driver, Firebase router registration, cloud connection or
// environment read at module import. Do not use it inside Firestore transactions.
const FAILED = "Quizer SQL connection unavailable.";
function requireRestrictedRole(row) {
  if (!row || row.role_name !== "quizer_app" ||
      row.rolsuper !== false || row.rolcreatedb !== false ||
      row.rolcreaterole !== false || row.rolreplication !== false ||
      row.rolbypassrls !== false || row.inherited_neon_superuser !== false)
    throw new Error("Quizer SQL refused an elevated or unverified role.");
}
export function createQuizerSqlPort({
  enabled = false, config, createPool, attestProject,
} = {}) {
  if (enabled !== true) return Object.freeze({
    enabled:false, query:async()=>({disabled:true}),
    transaction:async()=>({disabled:true}), close:async()=>{},
  });
  if (config?.enabled !== true ||
      typeof config.getConnectionString !== "function" ||
      typeof config.projectId !== "string" ||
      !/^quizer(?:_[a-z0-9_]+)?$/.test(config.database ?? "") ||
      typeof createPool !== "function" ||
      typeof attestProject !== "function")
    throw new Error("A verified, separate Quizer project and trusted SQL factory are required.");
  let poolPromise = null;
  let closed = false;
  async function poolFor() {
    if (closed) throw new Error("Quizer SQL port has been closed.");
    if (!poolPromise) {
      poolPromise = (async () => {
        const url = config.getConnectionString();
        // quizerNeonConfig already enforces TLS, host, DB and restricted username.
        // Independently check the project-to-endpoint mapping before ANY dial.
        const host = new URL(url).hostname;
        const confirmed = await attestProject({
          projectId:config.projectId, database:config.database, hostname:host,
        });
        if (confirmed !== true) throw new Error("Quizer project identity was not verified.");
        const pool = await createPool({connectionString:url, max:3,
          connectionTimeoutMillis:5000, idleTimeoutMillis:10000});
        if (typeof pool?.connect !== "function" ||
            typeof pool?.end !== "function")
          throw new Error("Unusable Quizer SQL pool.");
        return pool;
      })().catch(() => {
        poolPromise = null;
        throw new Error(FAILED);
      });
    }
    return poolPromise;
  }
  async function transaction(fn) {
    if (typeof fn !== "function") throw new TypeError("SQL transaction callback required.");
    const pool = await poolFor();
    let client;
    try { client = await pool.connect(); }
    catch { throw new Error(FAILED); }
    if (!client || typeof client.query !== "function" ||
        typeof client.release !== "function")
      throw new Error("Invalid Quizer SQL client.");
    let begun = false;
    try {
      await client.query("BEGIN");
      begun = true;
      await client.query("SET LOCAL statement_timeout = '10000ms'");
      const role = await client.query(
        "SELECT current_user AS role_name, rolsuper, rolcreatedb, rolcreaterole, " +
        "rolreplication, rolbypassrls, EXISTS (SELECT 1 FROM pg_roles s " +
        "WHERE s.rolname='neon_superuser' AND pg_has_role(current_user,s.oid,'MEMBER')) " +
        "AS inherited_neon_superuser FROM pg_roles WHERE rolname=current_user");
      requireRestrictedRole(role?.rows?.[0]);
      const result = await fn(Object.freeze({
        query:(sql, values=[]) => {
          if (typeof sql !== "string" || !Array.isArray(values))
            throw new TypeError("Bound SQL query required.");
          return client.query(sql,values);
        },
      }));
      await client.query("COMMIT");
      begun = false;
      return result;
    } catch(error) {
      if (begun) {
        try { await client.query("ROLLBACK"); }
        catch { /* original failure remains authoritative */ }
      }
      throw error;
    } finally { client.release(); }
  }
  return Object.freeze({
    enabled:true,
    transaction,
    query:(sql, values=[]) => transaction(tx=>tx.query(sql,values)),
    async close() {
      closed = true;
      if (poolPromise) {
        try { const pool = await poolPromise; await pool.end(); }
        catch { /* a failed initialization has no active pool */ }
      }
      poolPromise = null;
    },
  });
}
