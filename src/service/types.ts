export type TelemetryKind = 'honeycomb' | 'datadog' | 'generic' | 'fixture';

export interface TelemetrySourceConfig {
  kind: TelemetryKind;
  /** API base URL, or absolute path to a fixture JSON file when kind is fixture. */
  endpoint: string;
  dataset?: string;
  windowHours: number;
}

export interface PricingRate {
  id: string;
  /** What to multiply: span count, or a numeric attribute sum. */
  unit: 'invocation' | 'byte' | 'request';
  pricePerUnit: number;
  /** Span attribute to sum when unit is byte/request; ignored for invocation. */
  attribute?: string;
  /** Optional exact match on another attribute (e.g. model name). */
  matchAttribute?: string;
  matchValue?: string;
}

export interface PricingTable {
  currency: string;
  /** Assumed hours in a billing month for extrapolation. */
  hoursPerMonth: number;
  rates: PricingRate[];
}

export interface SpanRecord {
  name?: string;
  attributes: Record<string, string | number | boolean>;
}

export interface LocationAggregate {
  filepath: string;
  lineno: number;
  invocations: number;
  /** Sum of numeric attributes across matching spans. */
  attributeSums: Record<string, number>;
  /** First-seen string attribute values (for match filters). */
  attributeSamples: Record<string, string>;
}

export interface CostBreakdownLine {
  rateId: string;
  amount: number;
}

export interface CostEstimate {
  filepath: string;
  lineno: number;
  invocations: number;
  costInWindow: number;
  estimatedMonthly: number;
  currency: string;
  breakdown: CostBreakdownLine[];
}

export interface CostReport {
  connected: boolean;
  estimates: CostEstimate[];
  windowHours: number;
  notes: string[];
  refreshedAt: string;
  sourceKind?: TelemetryKind;
}
