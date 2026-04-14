const vscode = require('vscode');
let outputChannel;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("AgentOS");

  const getConfig = () => {
    const cfg = vscode.workspace.getConfiguration('agentos');
    return { gateway: cfg.get('gatewayUrl'), token: cfg.get('apiToken') };
  };

  const callApi = async (endpoint, params = {}) => {
    const { gateway, token } = getConfig();
    if (!gateway ||!token) {
      vscode.window.showErrorMessage('Set AgentOS Gateway URL and Token in Settings');
      vscode.commands.executeCommand('workbench.action.openSettings', 'agentos');
      return null;
    }
    const url = new URL(gateway + endpoint);
    url.searchParams.set('token', token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    
    outputChannel.appendLine(`→ ${endpoint} ${JSON.stringify(params)}`);
    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      outputChannel.appendLine(`← ${data.message || 'Success'}`);
      return data;
    } catch (e) {
      outputChannel.appendLine(`✗ ${e.message}`);
      vscode.window.showErrorMessage(`AgentOS error: ${e.message}`);
      return null;
    }
  };

  // Set Config
  context.subscriptions.push(vscode.commands.registerCommand('agentos.setConfig', async () => {
    const gateway = await vscode.window.showInputBox({ prompt: 'AgentOS Gateway URL', value: getConfig().gateway });
    if (!gateway) return;
    const token = await vscode.window.showInputBox({ prompt: 'AgentOS API Token', password: true, value: getConfig().token });
    if (!token) return;
    await vscode.workspace.getConfiguration('agentos').update('gatewayUrl', gateway, true);
    await vscode.workspace.getConfiguration('agentos').update('apiToken', token, true);
    vscode.window.showInformationMessage('AgentOS config saved');
  }));

  // Run arbitrary skill
  context.subscriptions.push(vscode.commands.registerCommand('agentos.runSkill', async () => {
    const skill = await vscode.window.showQuickPick([
      'onboard', 'hotspot-brand', 'memory', 'rollback', 'freeze', 'ui-agent', 'ui-record'
    ], { placeHolder: 'Select skill' });
    if (!skill) return;

    let params = {};
    if (skill === 'onboard' || skill === 'hotspot-brand') {
      const target = await vscode.window.showInputBox({ prompt: 'Target', value: 'all' });
      if (target) params.target = target;
    }
    if (skill === 'ui-agent') {
      const url = await vscode.window.showInputBox({ prompt: 'URL to automate' });
      if (!url) return;
      const actions = await vscode.window.showInputBox({ prompt: 'Actions JSON', value: '[]' });
      if (!actions) return;
      params.url = url; params.actions = actions;
    }
    if (skill === 'ui-record') {
      const url = await vscode.window.showInputBox({ prompt: 'URL to record on' });
      if (!url) return;
      params.url = url;
    }

    const res = await callApi(`/api/${skill}`, params);
    if (res) vscode.window.showInformationMessage(res.message?.slice(0, 200) || 'Done');
  }));

  // Quick commands
  context.subscriptions.push(vscode.commands.registerCommand('agentos.memory', async () => {
    const res = await callApi('/api/memory');
    if (res) {
      const doc = await vscode.workspace.openTextDocument({ content: res.message, language: 'markdown' });
      vscode.window.showTextDocument(doc);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentos.onboardAll', async () => {
    const res = await callApi('/api/onboard', { target: 'all' });
    if (res) vscode.window.showInformationMessage(res.message);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentos.hotspotBrand', async () => {
    const res = await callApi('/api/hotspot-brand', { target: 'all' });
    if (res) vscode.window.showInformationMessage(res.message);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentos.recordUi', async () => {
    const url = await vscode.window.showInputBox({ prompt: 'URL to record on', value: 'https://' });
    if (!url) return;
    const res = await callApi('/api/ui-record', { url });
    if (res && res.recorder_code) {
      const doc = await vscode.workspace.openTextDocument({ content: res.recorder_code, language: 'javascript' });
      vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Paste this code into browser console on ' + url);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentos.runUiAgent', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showErrorMessage('Open a file with actions JSON');
    let actions;
    try { actions = JSON.parse(editor.document.getText()); } 
    catch { return vscode.window.showErrorMessage('Invalid JSON in active editor'); }
    const url = await vscode.window.showInputBox({ prompt: 'Target URL' });
    if (!url) return;
    const res = await callApi('/api/ui-agent', { url, actions: JSON.stringify(actions) });
    if (res) vscode.window.showInformationMessage(res.message);
  }));

  // Tree views
  const skillsProvider = new SkillsProvider();
  vscode.window.registerTreeDataProvider('agentos-skills', skillsProvider);
  
  outputChannel.appendLine('AgentOS extension activated');
}

class SkillsProvider {
  getTreeItem(element) { return element; }
  getChildren() {
    return [
      new vscode.TreeItem('onboard all', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('hotspot-brand all', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('memory', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('ui-agent', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('ui-record', vscode.TreeItemCollapsibleState.None)
    ].map(i => { i.command = { command: 'agentos.runSkill', title: i.label }; return i; });
  }
}

function deactivate() {}
module.exports = { activate, deactivate };
