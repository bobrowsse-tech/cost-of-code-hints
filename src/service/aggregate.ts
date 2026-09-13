import type { LocationAggregate, SpanRecord } from './types';

const FILE_ATTRS = ['code.filepath', 'code.file.path', 'code.path'];
const LINE_ATTRS = ['code.lineno', 'code.line.number', 'code.line'];

function attrString(
  attrs: Record<string, string | number | boolean>,
  keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'string' && v.trim()) {
      return v;
    }
    if (typeof v === 'number') {
      return String(v);
    }
  }
  return undefined;
}

function attrNumber(
  attrs: Record<string, string | number | boolean>,
  keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/**
 * Aggregate spans that carry code-location attributes.
 * Spans without filepath + lineno are excluded (never guessed).
 */
export function aggregateByLocation(spans: SpanRecord[]): {
  aggregates: LocationAggregate[];
  skippedMissingLocation: number;
} {
  const map = new Map<string, LocationAggregate>();
  let skipped = 0;

  for (const span of spans) {
    const filepath = attrString(span.attributes, FILE_ATTRS);
    const lineno = attrNumber(span.attributes, LINE_ATTRS);
    if (!filepath || lineno == null || lineno < 1) {
      skipped++;
      continue;
    }
    const key = `${filepath}:${lineno}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        filepath,
        lineno,
        invocations: 0,
        attributeSums: {},
        attributeSamples: {},
      };
      map.set(key, agg);
    }
    agg.invocations += 1;
    for (const [k, v] of Object.entries(span.attributes)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        agg.attributeSums[k] = (agg.attributeSums[k] ?? 0) + v;
      } else if (typeof v === 'string' && !(k in agg.attributeSamples)) {
        agg.attributeSamples[k] = v;
      }
    }
  }

  return {
    aggregates: [...map.values()].sort((a, b) => b.invocations - a.invocations),
    skippedMissingLocation: skipped,
  };
}
