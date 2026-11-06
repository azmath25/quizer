/**
 * Server-only Quizer -> Mimo Execution API transport.
 * This module does not authenticate Quizer callers or authorize access to run IDs.
 * Its caller MUST enforce Firebase identity/role and per-user run ownership.
 * Do not import it into Quizer's public browser bundle.
 */
import { createHash } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JSON_BYTES = 65_536;

export class MimoTransportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MimoTransportError';
    this.code = code;
  }
}

function config({ origin, projectKey, workflowId, version, costLimitUsd }) {
  let url;
  try { url = new URL(origin); } catch { throw new MimoTransportError('MIMO_NOT_CONFIGURED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^mimo-execution-[a-z0-9-]+(?:\.a|\.europe-west1)\.run\.app$/.test(url.hostname)) {
    throw new MimoTransportError('MIMO_NOT_CONFIGURED');
  }
  if (typeof projectKey !== 'string' || projectKey.length < 24 || /[\r\n]/.test(projectKey) ||
      !SAFE_ID.test(workflowId) ||
      (version != null && (!Number.isSafeInteger(version) || version <= 0)) ||
      !Number.isFinite(costLimitUsd) || costLimitUsd < 0 || costLimitUsd > 1) {
    throw new MimoTransportError('MIMO_NOT_CONFIGURED');
  }
  return { origin: url.origin, projectKey, workflowId, version, costLimitUsd };
}

async function limitedJson(response) {
  if (!(response.headers?.get('content-type') ?? '').toLowerCase().includes('application/json'))
    throw new MimoTransportError('MIMO_INVALID_RESPONSE');
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength > MAX_JSON_BYTES)
    throw new MimoTransportError('MIMO_INVALID_RESPONSE');
  const reader = response.body?.getReader();
  if (!reader) throw new MimoTransportError('MIMO_INVALID_RESPONSE');
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_BYTES) throw new MimoTransportError('MIMO_INVALID_RESPONSE');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks.map((v) => Buffer.from(v)));
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new MimoTransportError('MIMO_INVALID_RESPONSE'); }
}

export function createMimoClient({
  origin, projectKey, workflowId, version = null, costLimitUsd = 0.10,
  fetchImpl = globalThis.fetch, timeoutMs = 25000,
} = {}) {
  const cfg = config({ origin, projectKey, workflowId, version, costLimitUsd });
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 110000)
    throw new MimoTransportError('MIMO_NOT_CONFIGURED');

  async function request(method, path, { body, idempotencyKey } = {}) {
    let response;
    try {
      response = await fetchImpl(cfg.origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.projectKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The POST may have reached Mimo. Do not automatically create a new run.
      throw new MimoTransportError('MIMO_OUTCOME_UNKNOWN');
    }
    if (response.status === 401 || response.status === 403)
      throw new MimoTransportError('MIMO_PROJECT_NOT_AUTHORIZED');
    if (response.status === 404) throw new MimoTransportError('MIMO_WORKFLOW_OR_RUN_NOT_FOUND');
    if (response.status === 409) throw new MimoTransportError('MIMO_CONFLICT');
    if (response.status === 429) throw new MimoTransportError('MIMO_RATE_LIMITED');
    if (response.status >= 500) throw new MimoTransportError('MIMO_UPSTREAM_UNAVAILABLE');
    if (!response.ok) throw new MimoTransportError('MIMO_REQUEST_REJECTED');
    const value = await limitedJson(response);
    if (!value || typeof value !== 'object' || !RUN_ID.test(value.id) ||
        typeof value.status !== 'string')
      throw new MimoTransportError('MIMO_INVALID_RESPONSE');
    return { runId: value.id, status: value.status, output: value.output ?? null, version: value.version ?? null };
  }

  return Object.freeze({
    /** Use the SAME requestId on ambiguous retries, otherwise charges can duplicate. */
    start({ uid, requestId, input, background = true }) {
      if (typeof uid !== 'string' || !uid || uid.length > 128 ||
          typeof requestId !== 'string' || !REQUEST_ID.test(requestId) ||
          typeof input !== 'string' || !input.trim() ||
          Buffer.byteLength(input, 'utf8') > 12000 || typeof background !== 'boolean') {
        throw new MimoTransportError('MIMO_INVALID_INPUT');
      }
      const digest = createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
      return request('POST', `/v1/workflows/${encodeURIComponent(cfg.workflowId)}/runs`, {
        body: { input, version: cfg.version, background,
                cost_limit_usd: cfg.costLimitUsd, cost_mode: 'hard' },
        idempotencyKey: `quizer-${digest}`,
      });
    },
    /** Caller must verify runId belongs to this Firebase user before invoking. */
    getRun({ runId }) {
      if (typeof runId !== 'string' || !RUN_ID.test(runId))
        throw new MimoTransportError('MIMO_INVALID_INPUT');
      return request('GET', `/v1/runs/${runId}`);
    },
  });
}
