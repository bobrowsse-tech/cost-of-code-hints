import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CostHintsService,
  aggregateByLocation,
  computeEstimates,
  loadPricing,
  querySpans,
} from '../service';
import type { PricingTable, SpanRecord } from '../service/types';

const fixtures = path.join(__dirname, 'fixtures');

describe('aggregateByLocation', () => {
  it('excludes spans missing code location attributes', () => {
    const spans: SpanRecord[] = [
      { attributes: { 'code.filepath': 'a.ts', 'code.lineno': 1 } },
      { attributes: { 'service.name': 'api' } },
      { attributes: { 'code.filepath': 'a.ts', 'code.lineno': 1 } },
    ];
    const { aggregates, skippedMissingLocation } = aggregateByLocation(spans);
    assert.equal(skippedMissingLocation, 1);
    assert.equal(aggregates.length, 1);
    assert.equal(aggregates[0].invocations, 2);
  });
});

describe('computeEstimates', () => {
  it('computes window and monthly cost arithmetically from fixed pricing', () => {
    const pricing: PricingTable = {
      currency: 'USD',
      hoursPerMonth: 100,
      rates: [
        { id: 'inv', unit: 'invocation', pricePerUnit: 1 },
        { id: 'bytes', unit: 'byte', attribute: 'http.response.body.size', pricePerUnit: 0.5 },
      ],
    };
    const { aggregates } = aggregateByLocation([
      {
        attributes: {
          'code.filepath': 'src/billing.ts',
          'code.lineno': 42,
          'http.response.body.size': 10,
        },
      },
      {
        attributes: {
          'code.filepath': 'src/billing.ts',
          'code.lineno': 42,
          'http.response.body.size': 10,
        },
      },
    ]);
    // 2 invocations * $1 + 20 bytes * $0.5 = $12 in window
    // month factor = 100/10 = 10 → $120/mo
    const estimates = computeEstimates(aggregates, pricing, 10);
    assert.equal(estimates.length, 1);
    assert.equal(estimates[0].costInWindow, 12);
    assert.equal(estimates[0].estimatedMonthly, 120);
  });
});

describe('fixture telemetry + service', () => {
  it('loads fixture spans and ranks hotspots with local pricing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'costhints-'));
    try {
      fs.mkdirSync(path.join(dir, '.costhints'));
      fs.copyFileSync(
        path.join(fixtures, 'pricing.json'),
        path.join(dir, '.costhints', 'pricing.json')
      );
      const spansPath = path.join(fixtures, 'spans.json');
      const service = new CostHintsService(dir);
      const report = await service.refresh(
        { kind: 'fixture', endpoint: spansPath, windowHours: 24 },
        {}
      );
      assert.equal(report.connected, true);
      // orphan span without location excluded
      assert.ok(report.notes.some((n) => /Skipped 1/i.test(n)));
      assert.ok(report.estimates.length >= 2);

      const billing = report.estimates.find(
        (e) => e.filepath === 'src/billing.ts' && e.lineno === 42
      );
      assert.ok(billing);
      // 2 inv * 0.01 + 3000 bytes * 0.001 = 0.02 + 3 = 3.02 window
      assert.ok(Math.abs(billing!.costInWindow - 3.02) < 1e-9);

      const ai = report.estimates.find((e) => e.filepath === 'src/ai.ts');
      assert.ok(ai);
      // 1 inv * 0.01 + 500 tokens * 0.002 = 0.01 + 1 = 1.01
      assert.ok(Math.abs(ai!.costInWindow - 1.01) < 1e-9);

      assert.match(service.formatReport(report), /Hotspots/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports disconnected without fabricating estimates', async () => {
    const service = new CostHintsService(fixtures);
    const report = await service.refresh(undefined);
    assert.equal(report.connected, false);
    assert.equal(report.estimates.length, 0);
    assert.ok(report.notes.some((n) => /never fabricated/i.test(n)));
  });

  it('querySpans reads fixture file', async () => {
    const spans = await querySpans({
      kind: 'fixture',
      endpoint: path.join(fixtures, 'spans.json'),
      windowHours: 24,
    });
    assert.equal(spans.length, 5);
  });

  it('loadPricing reads workspace file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'costhints-p-'));
    try {
      fs.mkdirSync(path.join(dir, '.costhints'));
      fs.copyFileSync(
        path.join(fixtures, 'pricing.json'),
        path.join(dir, '.costhints', 'pricing.json')
      );
      const p = loadPricing(dir);
      assert.equal(p.rates[0].pricePerUnit, 0.01);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
