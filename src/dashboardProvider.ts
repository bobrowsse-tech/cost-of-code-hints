import * as vscode from 'vscode';
import type { CostReport } from './service';
import { formatMoney } from './service';

const BUTTONS: { label: string; command: string }[] = [
  { label: 'Connect Telemetry Source', command: 'costHints.connectSource' },
  { label: 'Refresh Estimates', command: 'costHints.refresh' },
  { label: 'View Hotspots', command: 'costHints.viewHotspots' },
];

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private summary = 'No telemetry connected — estimates are never fabricated.';
  private report?: CostReport;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'runCommand') {
        void vscode.commands.executeCommand(message.command, message.payload);
      } else if (message.type === 'jump') {
        void vscode.commands.executeCommand('costHints.viewHotspots', {
          filepath: message.filepath,
          lineno: message.lineno,
        });
      }
    });
    if (this.report) {
      this.showReport(this.report);
    }
  }

  setSummary(text: string) {
    this.summary = text;
    this.post({ type: 'summary', text });
  }

  showReport(report: CostReport) {
    this.report = report;
    this.post({
      type: 'report',
      report: {
        connected: report.connected,
        sourceKind: report.sourceKind,
        windowHours: report.windowHours,
        notes: report.notes,
        hotspots: report.estimates.slice(0, 50).map((e) => ({
          filepath: e.filepath,
          lineno: e.lineno,
          invocations: e.invocations,
          label: formatMoney(e.estimatedMonthly, e.currency),
        })),
      },
    });
  }

  private post(message: unknown) {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(): string {
    const buttonsHtml = BUTTONS.map(
      (b) => `<button data-command="${b.command}">${b.label}</button>`
    ).join('\n');
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; font-size: var(--vscode-font-size); }
    button {
      display: block; width: 100%; margin-bottom: 6px; padding: 6px 10px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; text-align: left;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    #summary { margin: 8px 0 12px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .row { border-bottom: 1px solid var(--vscode-widget-border, transparent); padding: 6px 0; cursor: pointer; }
    .meta { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
    .warn { color: var(--vscode-editorWarning-foreground); }
    .ok { color: var(--vscode-testing-iconPassed); }
  </style>
</head>
<body>
  <div id="summary">${escapeHtml(this.summary)}</div>
  ${buttonsHtml}
  <div id="list"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const listEl = document.getElementById('list');
    const summaryEl = document.getElementById('summary');
    document.querySelectorAll('button[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => vscode.postMessage({ type: 'runCommand', command: btn.dataset.command }));
    });
    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'summary') summaryEl.textContent = msg.text;
      if (msg.type === 'report') {
        listEl.innerHTML = '';
        const status = document.createElement('div');
        status.className = msg.report.connected ? 'ok meta' : 'warn meta';
        status.textContent = msg.report.connected
          ? 'Connected (' + esc(msg.report.sourceKind) + ') · window ' + msg.report.windowHours + 'h'
          : 'Not connected — no estimates shown';
        listEl.appendChild(status);
        (msg.report.hotspots || []).forEach((h) => {
          const div = document.createElement('div');
          div.className = 'row';
          div.innerHTML = '<div>' + esc(h.label) + '</div><div class="meta">' +
            esc(h.filepath) + ':' + h.lineno + ' · ' + h.invocations + ' invocations</div>';
          div.addEventListener('click', () => vscode.postMessage({
            type: 'jump', filepath: h.filepath, lineno: h.lineno
          }));
          listEl.appendChild(div);
        });
        for (const n of msg.report.notes || []) {
          const d = document.createElement('div');
          d.className = 'meta';
          d.textContent = n;
          listEl.appendChild(d);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
