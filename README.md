# Cost-of-Code Inline Hints

Annotate expensive code paths with what they cost at current traffic, using OpenTelemetry spans tagged with `code.filepath` / `code.lineno` and a workspace pricing table (`.costhints/pricing.json`).

1. **Connect Telemetry Source** — Honeycomb, Datadog, a generic query API, or a local fixture. Tokens go in SecretStorage.
2. **Refresh Estimates** — aggregates recent code-location-tagged spans and multiplies by your rates (clearly labeled as estimates).
3. **View Hotspots** — ranked list with jump-to-line; CodeLens shows `~$X/mo at current traffic (estimate)` on matching lines.

Instrument hot paths with `withCostSpan` (see `src/helpers/withCostSpan.ts`) so spans carry location attributes — spans without them are ignored, never guessed.

Agents can call `estimate_code_cost` (report-only).

## Development

```bash
npm install
npm run watch
npm run test:unit
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
