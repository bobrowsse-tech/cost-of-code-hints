import type {
  CostEstimate,
  LocationAggregate,
  PricingRate,
  PricingTable,
} from './types';

function rateApplies(rate: PricingRate, agg: LocationAggregate): boolean {
  if (!rate.matchAttribute || rate.matchValue === undefined) {
    return true;
  }
  return agg.attributeSamples[rate.matchAttribute] === rate.matchValue;
}

function unitsForRate(rate: PricingRate, agg: LocationAggregate): number {
  if (rate.unit === 'invocation') {
    return agg.invocations;
  }
  const attr = rate.attribute;
  if (!attr) {
    return 0;
  }
  return agg.attributeSums[attr] ?? 0;
}

/**
 * Multiply aggregated usage by the pricing table.
 * Extrapolates the observation window to a rough monthly estimate.
 * Label results as estimates — not billing-reconciled.
 */
export function computeEstimates(
  aggregates: LocationAggregate[],
  pricing: PricingTable,
  windowHours: number
): CostEstimate[] {
  const hours = Math.max(1, windowHours);
  const monthFactor = pricing.hoursPerMonth / hours;

  return aggregates
    .map((agg) => {
      const breakdown: { rateId: string; amount: number }[] = [];
      let costInWindow = 0;
      for (const rate of pricing.rates) {
        if (!rateApplies(rate, agg)) {
          continue;
        }
        const units = unitsForRate(rate, agg);
        if (units <= 0) {
          continue;
        }
        const amount = units * rate.pricePerUnit;
        costInWindow += amount;
        breakdown.push({ rateId: rate.id, amount });
      }
      return {
        filepath: agg.filepath,
        lineno: agg.lineno,
        invocations: agg.invocations,
        costInWindow,
        estimatedMonthly: costInWindow * monthFactor,
        currency: pricing.currency,
        breakdown,
      };
    })
    .filter((e) => e.estimatedMonthly > 0 || e.invocations > 0)
    .sort((a, b) => b.estimatedMonthly - a.estimatedMonthly);
}

export function formatMoney(amount: number, currency: string): string {
  if (amount >= 1) {
    return `~$${amount.toFixed(2)} ${currency}/mo`;
  }
  if (amount >= 0.01) {
    return `~$${amount.toFixed(3)} ${currency}/mo`;
  }
  return `~$${amount.toFixed(6)} ${currency}/mo`;
}
