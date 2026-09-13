import * as vscode from 'vscode';
import type { CostHintsService, CostReport } from './service';
import type { DashboardProvider } from './dashboardProvider';
import type { CostCodeLensProvider } from './codeLensProvider';

interface ToolInput {
  filePath?: string;
}

/**
 * Report-only LM tool — returns cost estimates; does not mutate pricing or secrets.
 */
export function registerEstimateCodeCostTool(
  context: vscode.ExtensionContext,
  getService: () => CostHintsService | undefined,
  getConfig: () => import('./service').TelemetrySourceConfig | undefined,
  getToken: () => Promise<string | undefined>,
  setReport: (report: CostReport) => void,
  dashboard: DashboardProvider,
  codeLens: CostCodeLensProvider
) {
  context.subscriptions.push(
    vscode.lm.registerTool('estimate_code_cost', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToolInput>,
        _token: vscode.CancellationToken
      ) {
        const service = getService();
        if (!service) {
          return textResult('No workspace folder is open.');
        }
        try {
          const config = getConfig();
          const token = await getToken();
          const report = await service.refresh(config, { token });
          setReport(report);
          codeLens.setEstimates(report.estimates);
          dashboard.showReport(report);
          dashboard.setSummary(
            report.connected
              ? `${report.estimates.length} hotspot(s) · ${report.sourceKind}`
              : 'Not connected'
          );
          return textResult(service.formatReport(report, options.input?.filePath));
        } catch (err) {
          return textResult(err instanceof Error ? err.message : String(err));
        }
      },
    })
  );
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}
