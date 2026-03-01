import * as vscode from "vscode";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion, getvsCodeUriScheme } from "./util/util";
import { getExtensionUri, getNonce, getUniqueId } from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type { FileEdit } from "core";

export class XynapseGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "xynapse.xynapseGUIView";
  public webviewProtocol: VsCodeWebviewProtocol;

  public get isReady(): boolean {
    return !!this.webview;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.webviewProtocol.webview = webviewView.webview;
    this._webviewView = webviewView;
    this._webview = webviewView.webview;
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
    );
  }

  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;

  get isVisible() {
    return this._webviewView?.visible;
  }

  get webview() {
    return this._webview;
  }

  public resetWebviewProtocolWebview(): void {
    if (!this._webview) {
      console.warn("no webview found during reset");
      return;
    }
    this.webviewProtocol.webview = this._webview;
  }

  sendMainUserInput(input: string) {
    this.webview?.postMessage({
      type: "userInput",
      input,
    });
  }

  constructor(
    private readonly windowId: string,
    private readonly extensionContext: vscode.ExtensionContext,
  ) {
    this.webviewProtocol = new VsCodeWebviewProtocol();
  }

  getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
    edits: FileEdit[] | undefined = undefined,
    isFullScreen = false,
  ): string {
    const extensionUri = getExtensionUri();
    let scriptUri: string;
    let styleMainUri: string;
    const vscMediaUrl: string = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui"))
      .toString();

    // Always use bundled assets - Xynapse IDE runs from source (VSCODE_DEV=1)
    // which sets ExtensionMode.Development, but we want production GUI bundle
    const inDevelopmentMode = false;
    if (inDevelopmentMode) {
      scriptUri = "http://localhost:5173/src/main.tsx";
      styleMainUri = "http://localhost:5173/src/index.css";
    } else {
      scriptUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.js"))
        .toString();
      styleMainUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.css"))
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

    const currentTheme = getTheme();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("window.autoDetectColorScheme") ||
        e.affectsConfiguration("window.autoDetectHighContrast") ||
        e.affectsConfiguration("workbench.preferredDarkColorTheme") ||
        e.affectsConfiguration("workbench.preferredLightColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastLightColorTheme")
      ) {
        // Send new theme to GUI to update embedded Monaco themes
        void this.webviewProtocol?.request("setTheme", { theme: getTheme() });
      }
    });

    this.webviewProtocol.webview = panel.webview;

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

        <script nonce="${nonce}">localStorage.setItem("ide", JSON.stringify("vscode"))</script>
        <script nonce="${nonce}">localStorage.setItem("vsCodeUriScheme", JSON.stringify(${JSON.stringify(getvsCodeUriScheme())}))</script>
        <script nonce="${nonce}">localStorage.setItem("extensionVersion", JSON.stringify(${JSON.stringify(getExtensionVersion())}))</script>
        <script nonce="${nonce}">window.windowId = ${JSON.stringify(this.windowId)}</script>
        <script nonce="${nonce}">window.vscMachineId = ${JSON.stringify(getUniqueId())}</script>
        <script nonce="${nonce}">window.vscMediaUrl = ${JSON.stringify(vscMediaUrl)}</script>
        <script nonce="${nonce}">window.ide = "vscode"</script>
        <script nonce="${nonce}">window.fullColorTheme = ${JSON.stringify(currentTheme)}</script>
        <script nonce="${nonce}">window.colorThemeName = "dark-plus"</script>
        <script nonce="${nonce}">window.workspacePaths = ${JSON.stringify(
          vscode.workspace.workspaceFolders?.map((folder) =>
            folder.uri.toString(),
          ) || [],
        )}</script>
        <script nonce="${nonce}">window.isFullScreen = ${isFullScreen}</script>

        ${
          edits
            ? `<script nonce="${nonce}">window.edits = ${JSON.stringify(edits)}</script>`
            : ""
        }
        ${
          page
            ? `<script nonce="${nonce}">window.location.pathname = ${JSON.stringify(page)}</script>`
            : ""
        }

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
