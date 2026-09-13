import * as vscode from 'vscode';
import { DashboardProvider } from './dashboardProvider';
import { registerEstimateCodeCostTool } from './lmTool';

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cost-of-code-hintsView", dashboard)
  );

  context.subscriptions.push(vscode.commands.registerCommand("costHints.connectSource", () => {
    // TODO (Connect Telemetry Source): Configures the OpenTelemetry backend endpoint (Honeycomb/Datadog/self-hosted collector query API) and stores credentials in vscode.SecretStorage.
    vscode.window.showInformationMessage("Connect Telemetry Source \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("costHints.refresh", () => {
    // TODO (Refresh Estimates): Re-queries recent span data for code-location-tagged spans and recomputes cost estimates against the configured pricing table.
    vscode.window.showInformationMessage("Refresh Estimates \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("costHints.viewHotspots", () => {
    // TODO (View Hotspots): Lists the highest-estimated-cost code locations workspace-wide, ranked, with jump links.
    vscode.window.showInformationMessage("View Hotspots \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  // Exposes the same capability to Copilot Chat / Claude Code / any MCP-aware
  // agent via the Language Model Tool API — see contributes.languageModelTools
  // in package.json and DIRECTIVE.md, section "Language Model Tool".
  registerEstimateCodeCostTool(context);
}

export function deactivate() {}
