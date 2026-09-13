export type {
  CostEstimate,
  CostReport,
  PricingTable,
  SpanRecord,
  TelemetryKind,
  TelemetrySourceConfig,
} from './types';

export { DEFAULT_PRICING, ensurePricingFile, loadPricing, pricingPath } from './pricing';
export { aggregateByLocation } from './aggregate';
export { computeEstimates, formatMoney } from './cost';
export { querySpans } from './telemetry';
export { withCostSpan } from '../helpers/withCostSpan';

import { ensurePricingFile, loadPricing } from './pricing';
import { aggregateByLocation } from './aggregate';
import { computeEstimates, formatMoney } from './cost';
import { querySpans, type TelemetryQueryOptions } from './telemetry';
import type { CostReport, TelemetrySourceConfig } from './types';

/**
 * VS Code–free cost estimation service.
 * Credentials are passed in (from SecretStorage) — never read from settings files.
 */
export class CostHintsService {
  constructor(private readonly root: string) {}

  ensurePricing(): string {
    return ensurePricingFile(this.root);
  }

  async refresh(
    config: TelemetrySourceConfig | undefined,
    options: TelemetryQueryOptions = {}
  ): Promise<CostReport> {
    const notes: string[] = [];
    if (!config) {
      return {
        connected: false,
        estimates: [],
        windowHours: 24,
        notes: [
          'No telemetry source connected. Use Connect Telemetry Source — estimates are never fabricated.',
        ],
        refreshedAt: new Date().toISOString(),
      };
    }

    ensurePricingFile(this.root);
    const pricing = loadPricing(this.root);
    const spans = await querySpans(config, options);
    const { aggregates, skippedMissingLocation } = aggregateByLocation(spans);
    if (skippedMissingLocation > 0) {
      notes.push(
        `Skipped ${skippedMissingLocation} span(s) without code.filepath/code.lineno (instrument with withCostSpan).`
      );
    }
    const estimates = computeEstimates(aggregates, pricing, config.windowHours);
    notes.push(
      `Estimates only — not billing-reconciled. Window ${config.windowHours}h → monthly via ${pricing.hoursPerMonth}h.`
    );

    return {
      connected: true,
      estimates,
      windowHours: config.windowHours,
      notes,
      refreshedAt: new Date().toISOString(),
      sourceKind: config.kind,
    };
  }

  formatReport(report: CostReport, filePath?: string): string {
    const lines = [
      `Cost-of-code report at ${report.refreshedAt}`,
      report.connected
        ? `Source: ${report.sourceKind ?? 'connected'} · window ${report.windowHours}h`
        : 'Source: not connected',
      '',
    ];
    let estimates = report.estimates;
    if (filePath) {
      const norm = filePath.replace(/\\/g, '/');
      estimates = estimates.filter(
        (e) =>
          e.filepath.replace(/\\/g, '/').endsWith(norm) ||
          norm.endsWith(e.filepath.replace(/\\/g, '/'))
      );
      lines.push(`Filtered to: ${filePath}`, '');
    }
    if (!report.connected) {
      lines.push(...report.notes);
      return lines.join('\n');
    }
    if (!estimates.length) {
      lines.push('No cost hotspots found for code-location-tagged spans.');
    } else {
      lines.push(`Hotspots (${estimates.length}):`);
      for (const e of estimates.slice(0, 25)) {
        lines.push(
          `- ${formatMoney(e.estimatedMonthly, e.currency)} · ${e.filepath}:${e.lineno} · ${e.invocations} invocations`
        );
      }
    }
    if (report.notes.length) {
      lines.push('', 'Notes:', ...report.notes.map((n) => `- ${n}`));
    }
    return lines.join('\n');
  }
}
