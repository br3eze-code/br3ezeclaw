import * as vscode from 'vscode';

export class AgentOSAPI {
  constructor(private output: vscode.OutputChannel) {}

  private getConfig() {
    const cfg = vscode.workspace.getConfiguration('agentos');
    return {
      gateway: cfg.get<string>('gatewayUrl') || '',
      token: cfg.get<string>('apiToken') || ''
    };
  }

  async setConfig() {
    const gateway = await vscode.window.showInputBox({ 
      prompt: 'AgentOS Gateway URL', 
      value: this.getConfig().gateway 
    });
    if (!gateway) return;
    const token = await vscode.window.showInputBox({ 
      prompt: 'AgentOS API Token', 
      password: true, 
      value: this.getConfig().token 
    });
    if (!token) return;
    await vscode.workspace.getConfiguration('agentos').update('gatewayUrl', gateway, true);
    await vscode.workspace.getConfiguration('agentos').update('apiToken', token, true);
    vscode.window.showInformationMessage('AgentOS config saved');
  }

  async call(endpoint: string, params: Record<string, string> = {}): Promise<any | null> {
    const { gateway, token } = this.getConfig();
    if (!gateway || !token) {
      vscode.window.showErrorMessage('Set AgentOS Gateway URL and Token in Settings');
      vscode.commands.executeCommand('workbench.action.openSettings', 'agentos');
      return null;
    }

    const url = new URL(gateway + endpoint);
    url.searchParams.set('token', token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    this.output.appendLine(`→ ${endpoint} ${JSON.stringify(params)}`);
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.output.appendLine(`← ${data.message || 'Success'}`);
      return data;
    } catch (e: any) {
      this.output.appendLine(`✗ ${e.message}`);
      vscode.window.showErrorMessage(`AgentOS error: ${e.message}`);
      return null;
    }
  }
}
