import * as vscode from 'vscode';
import * as path from 'path';
import { DashboardProvider } from './dashboardProvider';
import { CostCodeLensProvider } from './codeLensProvider';
import { registerEstimateCodeCostTool } from './lmTool';
import {
  CostHintsService,
  ensurePricingFile,
  type CostReport,
  type TelemetryKind,
  type TelemetrySourceConfig,
} from './service';

const CONFIG_KEY = 'costHints.telemetryConfig';
const LAST_REPORT_KEY = 'costHints.lastReport';
const SECRET_KEY = 'costHints.telemetryToken';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function createService(): CostHintsService | undefined {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Cost-of-Code Hints needs an open workspace folder.');
    return undefined;
  }
  return new CostHintsService(root);
}

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider();
  const codeLens = new CostCodeLensProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cost-of-code-hintsView', dashboard),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens)
  );

  const getConfig = () => context.globalState.get<TelemetrySourceConfig>(CONFIG_KEY);
  const getToken = async () => context.secrets.get(SECRET_KEY);
  const setReport = (report: CostReport) => {
    void context.workspaceState.update(LAST_REPORT_KEY, report);
  };

  const cached = context.workspaceState.get<CostReport>(LAST_REPORT_KEY);
  if (cached?.connected) {
    codeLens.setEstimates(cached.estimates);
    dashboard.showReport(cached);
    dashboard.setSummary(`${cached.estimates.length} hotspot(s) (cached)`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('costHints.connectSource', async () => {
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('Open a workspace folder first.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        [
          {
            label: 'Generic / self-hosted query API',
            providerKind: 'generic' as TelemetryKind,
          },
          { label: 'Honeycomb Query API', providerKind: 'honeycomb' as TelemetryKind },
          { label: 'Datadog Spans API', providerKind: 'datadog' as TelemetryKind },
          {
            label: 'Local fixture file (demo / offline)',
            providerKind: 'fixture' as TelemetryKind,
            description: 'No credentials',
          },
        ],
        { title: 'Telemetry backend' }
      );
      if (!picked) {
        return;
      }

      const existing = getConfig();
      let endpoint = await vscode.window.showInputBox({
        title:
          picked.providerKind === 'fixture'
            ? 'Absolute path to spans fixture JSON'
            : picked.providerKind === 'honeycomb'
              ? 'Honeycomb API base URL'
              : picked.providerKind === 'datadog'
                ? 'Datadog API base URL'
                : 'Query API endpoint URL',
        value:
          existing?.endpoint ??
          (picked.providerKind === 'honeycomb'
            ? 'https://api.honeycomb.io'
            : picked.providerKind === 'datadog'
              ? 'https://api.datadoghq.com'
              : picked.providerKind === 'fixture'
                ? path.join(root, '.costhints', 'spans.fixture.json')
                : 'https://otel.example.com/v1/cost-spans'),
        ignoreFocusOut: true,
      });
      if (!endpoint) {
        return;
      }

      let dataset = existing?.dataset;
      if (picked.providerKind === 'honeycomb') {
        dataset =
          (await vscode.window.showInputBox({
            title: 'Honeycomb dataset name',
            value: dataset ?? 'traces',
            ignoreFocusOut: true,
          })) ?? undefined;
        if (!dataset) {
          return;
        }
      }

      const windowStr = await vscode.window.showInputBox({
        title: 'Lookback window (hours)',
        value: String(existing?.windowHours ?? 24),
        ignoreFocusOut: true,
      });
      const windowHours = Math.max(1, Number(windowStr) || 24);

      if (picked.providerKind !== 'fixture') {
        const token = await vscode.window.showInputBox({
          title: 'API token (SecretStorage — never workspace settings)',
          password: true,
          ignoreFocusOut: true,
        });
        if (token) {
          await context.secrets.store(SECRET_KEY, token);
        } else if (!(await getToken())) {
          vscode.window.showWarningMessage('No token stored; queries that need auth will fail.');
        }
      }

      const config: TelemetrySourceConfig = {
        kind: picked.providerKind,
        endpoint,
        dataset,
        windowHours,
      };
      await context.globalState.update(CONFIG_KEY, config);
      const pricingFile = ensurePricingFile(root);
      dashboard.setSummary(
        `Connected: ${picked.providerKind}. Pricing at ${path.relative(root, pricingFile)}`
      );
      vscode.window.showInformationMessage(
        `Telemetry source saved (${picked.providerKind}). Edit ${path.relative(root, pricingFile)} for rates.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('costHints.refresh', async () => {
      const service = createService();
      if (!service) {
        return undefined;
      }
      const config = getConfig();
      if (!config) {
        dashboard.setSummary('No telemetry connected — nothing to refresh.');
        dashboard.showReport({
          connected: false,
          estimates: [],
          windowHours: 24,
          notes: [
            'No telemetry source connected. Use Connect Telemetry Source — estimates are never fabricated.',
          ],
          refreshedAt: new Date().toISOString(),
        });
        vscode.window.showWarningMessage('Connect a telemetry source first.');
        return undefined;
      }
      dashboard.setSummary('Refreshing estimates…');
      try {
        const token = await getToken();
        const report = await service.refresh(config, { token });
        setReport(report);
        codeLens.setEstimates(report.estimates);
        dashboard.showReport(report);
        dashboard.setSummary(
          `${report.estimates.length} hotspot(s) · ${report.sourceKind} · ${report.windowHours}h`
        );
        return report;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dashboard.setSummary(`Refresh failed: ${msg}`);
        vscode.window.showErrorMessage(msg);
        return undefined;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'costHints.viewHotspots',
      async (payload?: { filepath?: string; lineno?: number }) => {
        const report = context.workspaceState.get<CostReport>(LAST_REPORT_KEY);
        if (!report?.connected || !report.estimates.length) {
          const refreshed = await vscode.commands.executeCommand('costHints.refresh');
          if (!refreshed) {
            return;
          }
        }
        const latest = context.workspaceState.get<CostReport>(LAST_REPORT_KEY);
        if (!latest?.estimates.length) {
          vscode.window.showInformationMessage('No cost hotspots found.');
          return;
        }

        if (payload?.filepath && payload.lineno) {
          await jumpTo(payload.filepath, payload.lineno);
          return;
        }

        const pick = await vscode.window.showQuickPick(
          latest.estimates.map((e) => ({
            label: formatLabel(e.estimatedMonthly, e.currency),
            description: `${e.filepath}:${e.lineno}`,
            detail: `${e.invocations} invocations in window`,
            filepath: e.filepath,
            lineno: e.lineno,
          })),
          { title: 'Cost hotspots (estimate)' }
        );
        if (pick) {
          await jumpTo(pick.filepath, pick.lineno);
        }
      }
    )
  );

  registerEstimateCodeCostTool(
    context,
    () => createService(),
    getConfig,
    getToken,
    setReport,
    dashboard,
    codeLens
  );
}

export function deactivate() {}

function formatLabel(amount: number, currency: string): string {
  if (amount >= 1) {
    return `~$${amount.toFixed(2)} ${currency}/mo`;
  }
  if (amount >= 0.01) {
    return `~$${amount.toFixed(3)} ${currency}/mo`;
  }
  return `~$${amount.toFixed(6)} ${currency}/mo`;
}

async function jumpTo(filepath: string, lineno: number): Promise<void> {
  const root = workspaceRoot();
  let uri: vscode.Uri | undefined;
  if (path.isAbsolute(filepath) && (await exists(filepath))) {
    uri = vscode.Uri.file(filepath);
  } else if (root) {
    const abs = path.join(root, filepath);
    if (await exists(abs)) {
      uri = vscode.Uri.file(abs);
    } else {
      const found = await vscode.workspace.findFiles(
        `**/${path.basename(filepath)}`,
        '**/node_modules/**',
        5
      );
      uri = found[0];
    }
  }
  if (!uri) {
    vscode.window.showWarningMessage(`Could not open ${filepath}`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.max(0, lineno - 1);
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

async function exists(p: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch {
    return false;
  }
}
