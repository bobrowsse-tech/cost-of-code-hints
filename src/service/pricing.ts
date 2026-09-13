import * as fs from 'fs';
import * as path from 'path';
import type { PricingTable } from './types';

export const PRICING_DIR = '.costhints';
export const PRICING_FILE = 'pricing.json';

export const DEFAULT_PRICING: PricingTable = {
  currency: 'USD',
  hoursPerMonth: 730,
  rates: [
    {
      id: 'default.invocation',
      unit: 'invocation',
      pricePerUnit: 0.0000002,
    },
    {
      id: 'egress.bytes',
      unit: 'byte',
      attribute: 'http.response.body.size',
      pricePerUnit: 9e-11,
    },
    {
      id: 'openai.gpt4o.request',
      unit: 'request',
      attribute: 'gen_ai.usage.total_tokens',
      matchAttribute: 'gen_ai.request.model',
      matchValue: 'gpt-4o',
      pricePerUnit: 0.00001,
    },
  ],
};

export function pricingPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PRICING_DIR, PRICING_FILE);
}

export function loadPricing(workspaceRoot: string): PricingTable {
  const file = pricingPath(workspaceRoot);
  if (!fs.existsSync(file)) {
    return structuredClone(DEFAULT_PRICING);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PricingTable>;
    return {
      currency: raw.currency ?? DEFAULT_PRICING.currency,
      hoursPerMonth: raw.hoursPerMonth ?? DEFAULT_PRICING.hoursPerMonth,
      rates: Array.isArray(raw.rates) ? raw.rates : DEFAULT_PRICING.rates,
    };
  } catch {
    return structuredClone(DEFAULT_PRICING);
  }
}

/** Writes default pricing if missing. Returns path written or existing. */
export function ensurePricingFile(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, PRICING_DIR);
  const file = pricingPath(workspaceRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_PRICING, null, 2) + '\n', 'utf8');
  }
  return file;
}
