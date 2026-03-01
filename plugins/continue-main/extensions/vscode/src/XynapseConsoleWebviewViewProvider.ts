import { LLMInteractionItem } from "core";
import { EXTENSION_NAME } from "core/control-plane/env";
import { LLMLogger } from "core/llm/logger";
import * as vscode from "vscode";

import { getExtensionUri, getNonce } from "./util/vscode";

interface FromConsoleView {
  type: "start" | "stop";
  uuid: string;
}

// Maximum interactions we retain; when we exceed this, we drop the
// oldest and also send a message to the view to do the same.
const MAX_INTERACTIONS = 50;

export class XynapseConsoleWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "xynapse.xynapseConsoleView";

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._webviewView = webviewView;
    this._webview = webviewView.webview;
    this._webviewView.onDidDispose(() => {
      this._webviewView = undefined;
      this._webview = undefined;
    });
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
    );
    this._webview.onDidReceiveMessage((message: FromConsoleView) => {
      if (message.type === "start") {
        this._currentUuid = message.uuid;
        void this._webview?.postMessage({
          type: "init",
          uuid: this._currentUuid,
          items: this.getAllItems(),
        });
      }
    });
    this._webviewView.onDidDispose(() => {
      this._webview = undefined;
      this._webviewView = undefined;
      this._currentUuid = undefined;
    });
  }

  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;
  private _currentUuid?: string;
  private _currentInteractions = new Map<string, LLMInteractionItem[]>();
  private _completedInteractions: LLMInteractionItem[][] = [];
  private _saveLog;

  constructor(
    private readonly windowId: string,
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly llmLogger: LLMLogger,
  ) {
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    this._saveLog = config.get<boolean>("enableConsole");

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${EXTENSION_NAME}.enableConsole`)) {
        const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
        this._saveLog = config.get<boolean>("enableConsole");
        if (this._saveLog === false) {
          this.clearLog();
        }
      }
    });

    llmLogger.onLogItem((item) => this.addItem(item));
  }

  private addItem(item: LLMInteractionItem) {
    if (!this._saveLog) {
      return;
    }

    let iteractionItems = this._currentInteractions.get(item.interactionId);
    if (iteractionItems === undefined) {
      iteractionItems = [];
      this._currentInteractions.set(item.interactionId, iteractionItems);
    }

    iteractionItems.push(item);
    switch (item.kind) {
      case "success":
      case "cancel":
      case "error":
        this._completedInteractions.push(iteractionItems);
        this._currentInteractions.delete(item.interactionId);
        break;
      default:
        break;
    }

    if (this._currentUuid) {
      void this._webview?.postMessage({
        type: "item",
        uuid: this._currentUuid,
        item,
      });
    }

    while (
      this._completedInteractions.length > 0 &&
      this._completedInteractions.length + this._currentInteractions.size >
        MAX_INTERACTIONS
    ) {
      let toRemove = this._completedInteractions.shift();
      void this._webview?.postMessage({
        type: "remove",
        uuid: this._currentUuid,
        interactionId: toRemove![0].interactionId,
      });
    }
  }

  private getAllItems() {
    let items = this._completedInteractions.flat();

    for (const interactionItems of this._currentInteractions.values()) {
      items.push(...interactionItems);
    }

    return items;
  }

  clearLog() {
    this._completedInteractions = [];
    this._currentInteractions = new Map();

    if (this._currentUuid) {
      void this._webview?.postMessage({
        type: "clear",
        uuid: this._currentUuid,
      });
    }
  }

  private getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
  ): string {
    const extensionUri = getExtensionUri();
    let scriptUri: string;
    let styleMainUri: string;

    // Always use bundled assets - Xynapse IDE runs from source (VSCODE_DEV=1)
    // which sets ExtensionMode.Development, but we want production GUI bundle
    const inDevelopmentMode = false;
    if (inDevelopmentMode) {
      scriptUri = "http://localhost:5173/src/console.tsx";
      styleMainUri = "http://localhost:5173/src/indexConsole.css";
    } else {
      scriptUri = panel.webview
        .asWebviewUri(
          vscode.Uri.joinPath(extensionUri, "gui/assets/indexConsole.js"),
        )
        .toString();
      styleMainUri = panel.webview
        .asWebviewUri(
          vscode.Uri.joinPath(extensionUri, "gui/assets/indexConsole.css"),
        )
        .toString();
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "gui"),
        vscode.Uri.joinPath(extensionUri, "assets"),
      ],
      enableCommandUris: true,
      portMapping: [
        {
          webviewPort: 65433,
          extensionHostPort: 65433,
        },
      ],
    };

    const nonce = getNonce();
    const cspSource = panel.webview.cspSource;
    const csp = inDevelopmentMode
      ? `default-src 'none'; img-src ${cspSource} https: data: blob:; font-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline' http://localhost:5173; script-src 'nonce-${nonce}' ${cspSource} http://localhost:5173 https://*.i.posthog.com; connect-src ${cspSource} https: http://localhost:5173 ws://localhost:5173 wss://localhost:5173; frame-src ${cspSource};`
      : `default-src 'none'; img-src ${cspSource} https: data: blob:; font-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource} https://*.i.posthog.com; connect-src ${cspSource} https:; frame-src ${cspSource};`;

    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <script nonce="${nonce}">const vscode = acquireVsCodeApi();</script>
        <link href="${styleMainUri}" rel="stylesheet">

        <title>Xynapse</title>
      </head>
      <body>
        <div id="root"></div>

        ${
          inDevelopmentMode
            ? `<script type="module" nonce="${nonce}">
          import RefreshRuntime from "http://localhost:5173/@react-refresh"
          RefreshRuntime.injectIntoGlobalHook(window)
          window.$RefreshReg$ = () => {}
          window.$RefreshSig$ = () => (type) => type
          window.__vite_plugin_react_preamble_installed__ = true
          </script>`
            : ""
        }
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}
