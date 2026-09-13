import * as vscode from 'vscode';
import type { CostEstimate } from './service';
import { formatMoney } from './service';

/**
 * Shows "~$X/mo at current traffic (estimate)" above lines with matching span data.
 * Data comes from the last refresh — not recomputed on every keystroke.
 */
export class CostCodeLensProvider implements vscode.CodeLensProvider {
  private estimates: CostEstimate[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  setEstimates(estimates: CostEstimate[]) {
    this.estimates = estimates;
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const docPath = document.uri.fsPath.replace(/\\/g, '/');
    for (const e of this.estimates) {
      const fp = e.filepath.replace(/\\/g, '/');
      if (!docPath.endsWith(fp) && !fp.endsWith(docPath) && docPath !== fp) {
        // also allow basename-only matches from relative instrumentation paths
        const base = fp.split('/').pop();
        if (!base || !docPath.endsWith('/' + base)) {
          continue;
        }
      }
      const line = Math.max(0, e.lineno - 1);
      if (line >= document.lineCount) {
        continue;
      }
      const range = new vscode.Range(line, 0, line, 0);
      const title = `${formatMoney(e.estimatedMonthly, e.currency)} at current traffic (estimate)`;
      lenses.push(
        new vscode.CodeLens(range, {
          title,
          command: 'costHints.viewHotspots',
          arguments: [{ filepath: e.filepath, lineno: e.lineno }],
        })
      );
    }
    return lenses;
  }
}
