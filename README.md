# Cost-of-Code Inline Hints

Annotates expensive code paths with what they cost at current traffic, using OpenTelemetry spans tagged with `code.filepath` / `code.lineno` and a workspace pricing table (`.costhints/pricing.json`).

## Install

```bash
git clone https://github.com/bobrowsse-tech/cost-of-code-hints.git
cd cost-of-code-hints
npm install
npm run package
npx @vscode/vsce package --no-dependencies
code --install-extension cost-of-code-hints-0.1.0.vsix
```

Or press **F5** after `npm install`.

## Use

| Action | What it does |
|---|---|
| **Connect Telemetry Source** | Honeycomb, Datadog, generic query API, or local fixture (tokens → SecretStorage) |
| **Refresh Estimates** | Aggregates recent code-location-tagged spans × your rates (labeled as estimates) |
| **View Hotspots** | Ranked list with jump-to-line; CodeLens shows `~$X/mo at current traffic (estimate)` |

Instrument hot paths with `withCostSpan` (see `src/helpers/withCostSpan.ts`). Spans without location attributes are ignored — never guessed. With no telemetry connected, the UI shows nothing fabricated.

Agents can call `estimate_code_cost` (report-only).

## How it’s built

`@opentelemetry/api` for the helper; Node built-in `fetch` for telemetry HTTP; TypeScript + esbuild.

```bash
npm run watch
npm run test:unit
npm run package
```

## License

MIT

## Contributing

Changes to `main` must go through a pull request. See [CONTRIBUTING.md](./CONTRIBUTING.md).
