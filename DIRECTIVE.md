
# Build Directive — Cost-of-Code Inline Hints

> Rank **#9** in the Unbuilt VS Code Tools roadmap. This directive is written for an AI coding agent (Claude Code, Copilot agent mode, or a human following along) to execute directly. This repository already contains a working scaffold — activation, side-panel dashboard, command registration, and a Language Model Tool stub — following the suite conventions (TypeScript strict, esbuild bundle, WebviewView dashboard, shared VS Code–free service module, Language Model Tool). Everything marked `TODO` below is the real remaining work.

## 1. Objective

Join OpenTelemetry trace spans (tagged with code location via standard span attributes) to a per-call cost model (API pricing, bytes processed, invocation count) and surface the estimate as an inline CodeLens on the relevant line — the most infrastructure-dependent idea in the suite, scoped deliberately as a longer-horizon build.

## 2. Why this doesn't already exist

Billing dashboards (AWS Cost Explorer, Datadog) report cost by service or tag, never by source line. Connecting a specific code path to what it costs means joining trace data to git blame, which nobody does today.

## 3. VS Code surfaces this extension uses

- **Activity bar view container**: `cost-of-code-hintsContainer` (icon: `graph-line`)
- **Side panel dashboard**: `cost-of-code-hintsView`, a `WebviewViewProvider` — see `src/dashboardProvider.ts`
- **Commands**: `costHints.connectSource`, `costHints.refresh`, `costHints.viewHotspots`
- **Language Model Tool**: `estimate_code_cost` — see `src/lmTool.ts` and `contributes.languageModelTools` in `package.json`. This is what lets Copilot Chat, Claude Code, or any other MCP/agent-aware surface invoke this extension's core action conversationally instead of the user hunting for the right command.

## 4. Dashboard (side panel) spec

The sidebar webview is the primary UI. It must show, at minimum, the buttons below plus a status/summary area above them (current scan state, last-run timestamp, or a short result summary — specifics depend on the feature, see phase notes).

| Button | Command | Behavior |
|---|---|---|
| **Connect Telemetry Source** | `costHints.connectSource` | Configures the OpenTelemetry backend endpoint (Honeycomb/Datadog/self-hosted collector query API) and stores credentials in vscode.SecretStorage. |
| **Refresh Estimates** | `costHints.refresh` | Re-queries recent span data for code-location-tagged spans and recomputes cost estimates against the configured pricing table. |
| **View Hotspots** | `costHints.viewHotspots` | Lists the highest-estimated-cost code locations workspace-wide, ranked, with jump links. |

Buttons call `vscode.commands.executeCommand`, not the tool logic directly — keep exactly one implementation of the core logic (a plain TypeScript service module with no VS Code imports) called from three places: the command handler, the dashboard's message handler, and the Language Model Tool's `invoke`. Do not fork the logic across these three entry points.

## 5. Implementation phases

1. **Prerequisite: code-location-tagged spans** — This tool only works if spans already carry a code-location attribute (`code.filepath`, `code.lineno` — part of OpenTelemetry semantic conventions) or an equivalent custom tag. Ship a short instrumentation helper (`withCostSpan(fn, {file, line})`) teams can wrap around hot paths as an opt-in first step, since most existing instrumentation won't have this by default.
2. **Telemetry query** — Query the configured backend's API (Honeycomb's Query API, Datadog's Spans API, or a raw OTLP-compatible collector) for spans matching the tagged attribute over a recent window (last 24h/7d, configurable), aggregating invocation count and any cost-relevant span attributes (bytes processed, downstream API calls made) per code location.
3. **Cost model** — Maintain a small, user-editable pricing table (`.costhints/pricing.json`): per-unit costs for known downstream calls (e.g. a specific paid API's price per request, cloud function invocation cost, egress per GB). Multiply aggregated usage by the relevant rate to produce a rough monthly estimate per code location — label it clearly as an estimate, not a billing-reconciled figure.
4. **CodeLens rendering** — Register a `vscode.languages.registerCodeLensProvider` that shows `~$X/mo at current traffic` above any function with a matching code-location tag in recent span data, refreshed on the configured interval rather than on every keystroke.
5. **Dashboard wiring** — WebviewView hotspot list workspace-wide, sorted by estimated cost, each row jumping to the CodeLens location; telemetry-source connection status at the top.
6. **Language Model Tool** — Register `estimate_code_cost` so an agent doing a performance/cost pass can ask what's expensive and get a real-data-backed answer instead of guessing from code shape alone.
7. **Tests** — Mock telemetry backend responses fixture plus a fixed pricing table, asserting the cost computation is arithmetically correct and that missing-attribute spans are excluded rather than mis-estimated.

## 6. Suggested dependencies

`@opentelemetry/api` (for the `withCostSpan` helper). Use Node's built-in `fetch` for telemetry HTTP — no `node-fetch`.

Pin resolved versions in `package.json`.

## 7. Edge cases & safety notes

- No telemetry connected — the dashboard must say so plainly and not show fabricated estimates; this feature should visibly do nothing until wired up, never guess.
- Spans without the code-location attribute are invisible to this tool by design — the instrumentation-helper phase exists specifically to make that gap fixable, not silently worked around.
- Treat this as the suite's enterprise/longer-horizon build: it depends on infrastructure most teams haven't wired up yet, unlike the other eight ideas which work from day one against just the repo.

## 8. Definition of done

- [ ] Core logic lives in a VS Code-free service module, unit-tested against fixtures (see phase notes above for what fixtures to build).
- [ ] All buttons in the dashboard spec are wired to real behavior, not the placeholder `showInformationMessage` stub.
- [ ] The Language Model Tool calls the same service module and returns a concise, agent-readable text result (not raw JSON dumped as text).
- [ ] No destructive or external-write action (file rewrite, PR post, process kill) runs without an explicit user-initiated click — the LM tool path in particular must stay read/report-only unless the directive above says otherwise.
- [ ] `npm run package` produces a `dist/extension.js` with no bundling warnings; `vsce package` produces a `.vsix` that installs cleanly via `code --install-extension`.
- [ ] README.md (user-facing, not this directive) documents what the extension does in plain language, per `AGENTS.md`'s copy conventions.
    