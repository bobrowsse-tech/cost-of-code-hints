import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

export interface CostSpanLocation {
  file: string;
  line: number;
}

/**
 * Opt-in helper: wrap a hot path so the active span carries OpenTelemetry
 * semantic conventions `code.filepath` + `code.lineno`. Cost-of-Code Hints
 * only sees spans that already include these attributes.
 *
 * Copy this helper into your app (or depend on `@opentelemetry/api` and
 * paste this function) around expensive call sites:
 *
 *   await withCostSpan('chargeCustomer', { file: __filename, line: 42 }, () => charge());
 */
export async function withCostSpan<T>(
  name: string,
  loc: CostSpanLocation,
  fn: () => Promise<T> | T,
  extraAttributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = trace.getTracer('cost-of-code-hints');
  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      span.setAttribute('code.filepath', loc.file);
      span.setAttribute('code.lineno', loc.line);
      if (extraAttributes) {
        for (const [k, v] of Object.entries(extraAttributes)) {
          span.setAttribute(k, v);
        }
      }
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
