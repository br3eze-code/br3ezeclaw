// vscode-extension/src/extension.ts
import * as vscode from 'vscode';
import { Br3ezeAgent } from './agent';

export function activate(context: vscode.ExtensionContext) {
  const agent = new Br3ezeAgent({
    gateway: 'ws://localhost:8080',
    apiKey: vscode.workspace.getConfiguration('br3eze').get('apiKey')
  });
  
  // Command palette integration
  let disposable = vscode.commands.registerCommand('br3eze.generate', async () => {
    const prompt = await vscode.window.showInputBox({ prompt: 'What to generate?' });
    const result = await agent.execute({
      domain: 'developer',
      tool: 'codegen',
      params: { prompt, language: vscode.window.activeTextEditor?.document.languageId }
    });
    
    // Insert generated code
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, result.code);
      });
    }
  });
  
  context.subscriptions.push(disposable);
}
