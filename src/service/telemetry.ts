import * as fs from 'fs';
import type { SpanRecord, TelemetrySourceConfig } from './types';

export interface TelemetryQueryOptions {
  /** API token from SecretStorage — never read from disk by this module. */
  token?: string;
  /** Optional override fetch for tests. */
  fetchImpl?: typeof fetch;
}

function windowBounds(windowHours: number): { fromMs: number; toMs: number } {
  const toMs = Date.now();
  return { fromMs: toMs - windowHours * 3600 * 1000, toMs };
}

function asSpanRecords(raw: unknown): SpanRecord[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const obj = raw as { spans?: unknown };
  if (!Array.isArray(obj.spans)) {
    return [];
  }
  return obj.spans
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      name: typeof s.name === 'string' ? s.name : undefined,
      attributes:
        s.attributes && typeof s.attributes === 'object'
          ? (s.attributes as Record<string, string | number | boolean>)
          : {},
    }));
}

async function queryFixture(config: TelemetrySourceConfig): Promise<SpanRecord[]> {
  if (!fs.existsSync(config.endpoint)) {
    throw new Error(`Fixture file not found: ${config.endpoint}`);
  }
  const raw = JSON.parse(fs.readFileSync(config.endpoint, 'utf8'));
  return asSpanRecords(raw);
}

/**
 * Generic self-hosted / collector query API.
 * Expects GET {endpoint}?from=&to= → { "spans": [ { "attributes": { "code.filepath": "...", "code.lineno": 1 } } ] }
 */
async function queryGeneric(
  config: TelemetrySourceConfig,
  options: TelemetryQueryOptions
): Promise<SpanRecord[]> {
  const fetchFn = options.fetchImpl ?? fetch;
  const { fromMs, toMs } = windowBounds(config.windowHours);
  const url = new URL(config.endpoint);
  url.searchParams.set('from', String(fromMs));
  url.searchParams.set('to', String(toMs));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Telemetry query failed (${res.status}): ${await res.text()}`);
  }
  return asSpanRecords(await res.json());
}

/**
 * Honeycomb Query API (best-effort): runs a COUNT query grouped by code location,
 * then expands into synthetic span records for aggregation.
 * Docs: https://docs.honeycomb.io/api/query-data/
 */
async function queryHoneycomb(
  config: TelemetrySourceConfig,
  options: TelemetryQueryOptions
): Promise<SpanRecord[]> {
  if (!options.token) {
    throw new Error('Honeycomb API key required (stored in SecretStorage).');
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const dataset = config.dataset || 'traces';
  const base = config.endpoint.replace(/\/$/, '');
  const { fromMs, toMs } = windowBounds(config.windowHours);

  const queryBody = {
    start_time: Math.floor(fromMs / 1000),
    end_time: Math.floor(toMs / 1000),
    calculations: [{ op: 'COUNT' }],
    breakdowns: ['code.filepath', 'code.lineno'],
    filters: [
      { column: 'code.filepath', op: 'exists' },
      { column: 'code.lineno', op: 'exists' },
    ],
  };

  const create = await fetchFn(`${base}/1/queries/${encodeURIComponent(dataset)}`, {
    method: 'POST',
    headers: {
      'X-Honeycomb-Team': options.token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(queryBody),
  });
  if (!create.ok) {
    throw new Error(`Honeycomb query create failed (${create.status}): ${await create.text()}`);
  }
  const created = (await create.json()) as { id?: string };
  if (!created.id) {
    throw new Error('Honeycomb query response missing id.');
  }

  const result = await fetchFn(
    `${base}/1/query_results/${encodeURIComponent(dataset)}/${created.id}`,
    {
      headers: {
        'X-Honeycomb-Team': options.token,
        Accept: 'application/json',
      },
    }
  );
  if (!result.ok) {
    throw new Error(`Honeycomb query result failed (${result.status}): ${await result.text()}`);
  }
  const payload = (await result.json()) as {
    data?: { results?: Array<{ data?: Record<string, unknown> }> };
  };
  const rows = payload.data?.results ?? [];
  const spans: SpanRecord[] = [];
  for (const row of rows) {
    const d = row.data ?? {};
    const filepath = d['code.filepath'];
    const lineno = d['code.lineno'];
    const count = Number(d.COUNT ?? d.count ?? 1);
    if (typeof filepath !== 'string' || lineno == null) {
      continue;
    }
    const n = Math.max(1, Math.min(10_000, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      spans.push({
        attributes: {
          'code.filepath': filepath,
          'code.lineno': Number(lineno),
        },
      });
    }
  }
  return spans;
}

/**
 * Datadog Spans API (best-effort) — filter for code-location attributes.
 */
async function queryDatadog(
  config: TelemetrySourceConfig,
  options: TelemetryQueryOptions
): Promise<SpanRecord[]> {
  if (!options.token) {
    throw new Error('Datadog API key required (stored in SecretStorage).');
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const { fromMs, toMs } = windowBounds(config.windowHours);
  const base = config.endpoint.replace(/\/$/, '');
  const url = new URL(`${base}/api/v2/spans/events`);
  url.searchParams.set('filter[from]', String(fromMs));
  url.searchParams.set('filter[to]', String(toMs));
  url.searchParams.set('filter[query]', '@code.filepath:*');
  url.searchParams.set('page[limit]', '1000');

  const res = await fetchFn(url.toString(), {
    headers: {
      'DD-API-KEY': options.token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Datadog spans query failed (${res.status}): ${await res.text()}`);
  }
  const payload = (await res.json()) as {
    data?: Array<{ attributes?: { custom?: Record<string, unknown>; tags?: string[] } }>;
  };
  const spans: SpanRecord[] = [];
  for (const item of payload.data ?? []) {
    const custom = item.attributes?.custom ?? {};
    const attrs: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(custom)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        attrs[k] = v;
      }
    }
    // Also parse @code.filepath:value style tags if present
    for (const tag of item.attributes?.tags ?? []) {
      const m = tag.match(/^@?(code\.(?:filepath|lineno)):(.+)$/);
      if (m) {
        attrs[m[1]] = m[1].includes('lineno') ? Number(m[2]) : m[2];
      }
    }
    spans.push({ attributes: attrs });
  }
  return spans;
}

export async function querySpans(
  config: TelemetrySourceConfig,
  options: TelemetryQueryOptions = {}
): Promise<SpanRecord[]> {
  switch (config.kind) {
    case 'fixture':
      return queryFixture(config);
    case 'generic':
      return queryGeneric(config, options);
    case 'honeycomb':
      return queryHoneycomb(config, options);
    case 'datadog':
      return queryDatadog(config, options);
    default:
      throw new Error(`Unknown telemetry kind: ${(config as TelemetrySourceConfig).kind}`);
  }
}
