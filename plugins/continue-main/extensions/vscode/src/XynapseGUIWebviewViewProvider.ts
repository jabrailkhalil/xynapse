import * as vscode from "vscode";
import * as fs from "fs";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion, getvsCodeUriScheme } from "./util/util";
import { getExtensionUri, getNonce, getUniqueId } from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type { FileEdit } from "core";
import { getConfigYamlPath } from "core/util/paths";

export type XynapseSurface = "core" | "lab";

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
    webviewView.title = this.getViewTitle();
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

  public reloadWebview(): void {
    if (this._webviewView) {
      this._webviewView.title = this.getViewTitle();
      this._webviewView.webview.html = this.getSidebarContent(
        this.extensionContext,
        this._webviewView,
      );
      this.webviewProtocol.webview = this._webviewView.webview;
    }
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
    const savedSurface = this.extensionContext.globalState.get<XynapseSurface>(
      "xynapse.surface",
      "core",
    );
    this.surface = savedSurface === "lab" ? "lab" : "core";
  }

  private surface: XynapseSurface = "core";

  private getViewTitle(): string {
    return this.surface === "lab" ? "Xynapse Lab" : "Xynapse Core";
  }

  public async openSurface(surface: XynapseSurface): Promise<void> {
    this.surface = surface;
    await this.extensionContext.globalState.update(
      "xynapse.surface",
      surface,
    );
    await vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    this.reloadWebview();
  }

  private getBootFallbackHtml(locale: string, hasWorkspace: boolean): string {
    const normalizedLocale = locale.toLowerCase().slice(0, 2);
    const labels: Record<string, { title: string; subtitle: string; action: string }> = {
      en: {
        title: hasWorkspace ? "Loading Xynapse" : "Open a project folder",
        subtitle: hasWorkspace
          ? "The assistant is starting."
          : "Choose a folder to initialize the Xynapse workspace.",
        action: "Open folder",
      },
      ru: {
        title: hasWorkspace ? "Xynapse загружается" : "Откройте папку проекта",
        subtitle: hasWorkspace
          ? "Ассистент запускается."
          : "Выберите папку, чтобы инициализировать рабочее пространство Xynapse.",
        action: "Открыть папку",
      },
      ja: {
        title: hasWorkspace ? "Xynapse を読み込み中" : "プロジェクトフォルダを開く",
        subtitle: hasWorkspace
          ? "アシスタントを起動しています。"
          : "Xynapse ワークスペースを初期化するフォルダを選択してください。",
        action: "フォルダを開く",
      },
    };
    const text = labels[normalizedLocale] || labels.en;

    return `
          <div id="xynapse-boot-fallback" style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);">
            <div style="width:100%;max-width:420px;border:1px solid var(--vscode-widget-border,rgba(255,255,255,.16));border-radius:14px;padding:24px;text-align:center;background:var(--vscode-sideBar-background);">
              <div style="font-size:18px;font-weight:650;margin-bottom:8px;">${text.title}</div>
              <div style="opacity:.72;margin-bottom:18px;">${text.subtitle}</div>
              ${
                hasWorkspace
                  ? ""
                  : `<button id="xynapse-open-folder-fallback" type="button" style="width:100%;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;font-weight:650;color:var(--vscode-button-foreground);background:var(--vscode-button-background);">${text.action}</button>`
              }
            </div>
          </div>`;
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

    // Pre-compute locale from config.yaml (not inside template IIFE to avoid esbuild require issues)
    let responseLocale = vscode.env.language || "en";
    try {
      const cfgPath = getConfigYamlPath("vscode");
      const cfgRaw = fs.readFileSync(cfgPath, "utf8");
      const langMatch = cfgRaw.match(/^responseLanguage:\s*(\S+)/m);
      if (langMatch) {
        responseLocale = langMatch[1];
      }
    } catch {
      // keep default
    }

    const currentTheme = getTheme();
    const workspacePaths =
      vscode.workspace.workspaceFolders?.map((folder) =>
        folder.uri.toString(),
      ) || [];
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
        <div id="root">${this.getBootFallbackHtml(responseLocale, workspacePaths.length > 0)}</div>

        <script nonce="${nonce}">localStorage.setItem("ide", JSON.stringify("vscode"))</script>
        <script nonce="${nonce}">localStorage.setItem("vsCodeUriScheme", JSON.stringify(${JSON.stringify(getvsCodeUriScheme())}))</script>
        <script nonce="${nonce}">localStorage.setItem("extensionVersion", JSON.stringify(${JSON.stringify(getExtensionVersion())}))</script>
        <script nonce="${nonce}">window.windowId = ${JSON.stringify(this.windowId)}</script>
        <script nonce="${nonce}">window.vscMachineId = ${JSON.stringify(getUniqueId())}</script>
        <script nonce="${nonce}">window.vscMediaUrl = ${JSON.stringify(vscMediaUrl)}</script>
        <script nonce="${nonce}">window.ide = "vscode"</script>
        <script nonce="${nonce}">window.locale = ${JSON.stringify(responseLocale)}</script>
        <script nonce="${nonce}">window.xynapseSurface = ${JSON.stringify(this.surface)}</script>
        <script nonce="${nonce}">window.fullColorTheme = ${JSON.stringify(currentTheme)}</script>
        <script nonce="${nonce}">window.colorThemeName = "dark-plus"</script>
        <script nonce="${nonce}">window.workspacePaths = ${JSON.stringify(workspacePaths)}</script>
        <script nonce="${nonce}">window.isFullScreen = ${isFullScreen}</script>
        <script nonce="${nonce}">
          (function(){
            var button = document.getElementById("xynapse-open-folder-fallback");
            if (!button) return;
            button.addEventListener("click", function(){
              vscode.postMessage({
                messageType: "openFolder",
                data: undefined,
                messageId: "boot-fallback-open-folder-" + Date.now()
              });
            });
          })();
        </script>

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

        <script nonce="${nonce}">
        (function(){
          var L=window.locale||"en";if(L==="en")return;
          var B={
            "Chat":"Chat","Agent":"Agent","Shadow":"Shadow",
            "Select Mode":"Select Mode","Select Model":"Select Model",
            "Council":"Council","BVC":"BVC",
            "Attach Image":"Attach Image","Attach Context":"Attach Context",
            "Send (\u23ce)":"Send (\u23ce)","Enter":"Enter","Retry":"Retry","Edit":"Edit","Cancel":"Cancel","Delete":"Delete","Confirm":"Confirm",
            "Apply Code":"Apply Code","Copy Code":"Copy Code","Create File with Code":"Create File with Code",
            "Insert Code":"Insert Code","Copy into terminal":"Copy into terminal",
            "Open in browser":"Open in browser","Save Chat as Markdown":"Save Chat as Markdown",
            "Delete item?":"Delete item?","Enable Shadow Mode?":"Enable Shadow Mode?","Enable Shadow Mode":"Enable Shadow Mode",
            "Show":"Show","Hide":"Hide","Collapse":"Collapse","Expand":"Expand",
            "Zoom In":"Zoom In","Zoom Out":"Zoom Out","Reset Zoom":"Reset Zoom",
            "No active file":"No active file","Active file":"Active file",
            "Disable model reasoning":"Disable model reasoning","Enable model reasoning":"Enable model reasoning",
            "Search...":"Search...","Search past sessions":"Search past sessions",
            "Edit selected code":"Edit selected code",
            "All tools disabled":"All tools disabled","All tools available":"All tools available",
            "Esc to exit Edit":"Esc to exit Edit",
            "Back":"Back","Models":"Models","Rules":"Rules","Tools":"Tools","Configs":"Configs",
            "Organizations":"Organizations","Indexing":"Indexing","Help":"Help","Log in":"Log in",
            "Autocomplete":"Autocomplete","Auto":"Auto","Multiline Autocompletions":"Multiline Autocompletions",
            "User Settings":"User Settings","Local Config":"Local Config","Config rules":"Config rules",
            "Show Session Tabs":"Show Session Tabs","Wrap Codeblocks":"Wrap Codeblocks",
            "Show Chat Scrollbar":"Show Chat Scrollbar","Text-to-Speech Output":"Text-to-Speech Output",
            "Enable Session Titles":"Enable Session Titles","Format Markdown":"Format Markdown",
            "Screen width too small":"Screen width too small",
            "Displays tabs above the chat as an alternative way to organize and access your sessions.":"Displays tabs above the chat as an alternative way to organize and access your sessions.",
            "Wraps long lines in code blocks instead of showing horizontal scroll.":"Wraps long lines in code blocks instead of showing horizontal scroll.",
            "Enables a scrollbar in the chat window.":"Enables a scrollbar in the chat window.",
            "Reads LLM responses aloud with TTS.":"Reads LLM responses aloud with TTS.",
            "Generates summary titles for each chat session after the first message, using the current Chat model.":"Generates summary titles for each chat session after the first message, using the current Chat model.",
            "If off, shows responses as raw text.":"If off, shows responses as raw text.",
            "To view settings, please expand the sidebar by dragging the left/right border":"To view settings, please expand the sidebar by dragging the left/right border",
            "Experimental":"Experimental","Show Experimental Settings":"Show Experimental Settings",
            "Add Current File by Default":"Add Current File by Default",
            "the currently open file is added as context in every new conversation.":"the currently open file is added as context in every new conversation.",
            "Enable experimental tools":"Enable experimental tools",
            "enables access to experimental tools that are still in development.":"enables access to experimental tools that are still in development.",
            "Only use system message tools":"Only use system message tools",
            "Xynapse will not attempt to use native tool calling and will only use system message tools.":"Xynapse will not attempt to use native tool calling and will only use system message tools.",
            "@Codebase: use tool calling only":"@Codebase: use tool calling only",
            "@codebase context provider will only use tool calling for code retrieval.":"@codebase context provider will only use tool calling for code retrieval.",
            "Stream after tool rejection":"Stream after tool rejection",
            "streaming will Xynapse after the tool call is rejected.":"streaming will Xynapse after the tool call is rejected."
          };
          var TR={
            "ru":{"Chat":"\u0427\u0430\u0442","Agent":"\u0410\u0433\u0435\u043d\u0442","Shadow":"\u0422\u0435\u043d\u044c",
              "Select Mode":"\u0420\u0435\u0436\u0438\u043c","Select Model":"\u041c\u043e\u0434\u0435\u043b\u044c",
              "Council":"\u0421\u043e\u0432\u0435\u0442","BVC":"BVC",
              "Attach Image":"\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435","Attach Context":"\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
              "Send (\u23ce)":"\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c (\u23ce)","Enter":"\u0412\u0432\u043e\u0434","Retry":"\u041f\u043e\u0432\u0442\u043e\u0440","Edit":"\u0420\u0435\u0434\u0430\u043a\u0442.","Cancel":"\u041e\u0442\u043c\u0435\u043d\u0430","Delete":"\u0423\u0434\u0430\u043b\u0438\u0442\u044c","Confirm":"\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c",
              "Apply Code":"\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c","Copy Code":"\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c","Create File with Code":"\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0444\u0430\u0439\u043b",
              "Insert Code":"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c","Copy into terminal":"\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0432 \u0442\u0435\u0440\u043c\u0438\u043d\u0430\u043b",
              "Open in browser":"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435","Save Chat as Markdown":"\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u0430\u043a Markdown",
              "Delete item?":"\u0423\u0434\u0430\u043b\u0438\u0442\u044c?","Enable Shadow Mode?":"\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0435\u0436\u0438\u043c \u0422\u0435\u043d\u044c?","Enable Shadow Mode":"\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0422\u0435\u043d\u044c",
              "Show":"\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c","Hide":"\u0421\u043a\u0440\u044b\u0442\u044c","Collapse":"\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c","Expand":"\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c",
              "Zoom In":"\u0423\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c","Zoom Out":"\u0423\u043c\u0435\u043d\u044c\u0448\u0438\u0442\u044c","Reset Zoom":"\u0421\u0431\u0440\u043e\u0441 \u043c\u0430\u0441\u0448\u0442\u0430\u0431\u0430",
              "No active file":"\u041d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0433\u043e \u0444\u0430\u0439\u043b\u0430","Active file":"\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0444\u0430\u0439\u043b",
              "Disable model reasoning":"\u041e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0430\u0441\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u044f","Enable model reasoning":"\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0430\u0441\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u044f",
              "Search...":"\u041f\u043e\u0438\u0441\u043a...","Search past sessions":"\u041f\u043e\u0438\u0441\u043a \u0441\u0435\u0441\u0441\u0438\u0439",
              "Edit selected code":"\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043a\u043e\u0434",
              "All tools disabled":"\u0412\u0441\u0435 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u044b","All tools available":"\u0412\u0441\u0435 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b",
              "Esc to exit Edit":"Esc \u0434\u043b\u044f \u0432\u044b\u0445\u043e\u0434\u0430",
              "Back":"\u041d\u0430\u0437\u0430\u0434","Models":"\u041c\u043e\u0434\u0435\u043b\u0438","Rules":"\u041f\u0440\u0430\u0432\u0438\u043b\u0430","Tools":"\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b","Configs":"\u041a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438",
              "Organizations":"\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438","Indexing":"\u0418\u043d\u0434\u0435\u043a\u0441\u0430\u0446\u0438\u044f","Help":"\u041f\u043e\u043c\u043e\u0449\u044c","Log in":"\u0412\u043e\u0439\u0442\u0438",
              "Autocomplete":"\u0410\u0432\u0442\u043e\u0434\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435","Auto":"\u0410\u0432\u0442\u043e","Multiline Autocompletions":"\u041c\u043d\u043e\u0433\u043e\u0441\u0442\u0440\u043e\u0447\u043d\u043e\u0435 \u0430\u0432\u0442\u043e\u0434\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435",
              "User Settings":"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f","Local Config":"\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u0430\u044f \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044f","Config rules":"\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438",
              "Show Session Tabs":"\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0432\u043a\u043b\u0430\u0434\u043a\u0438 \u0441\u0435\u0441\u0441\u0438\u0439","Wrap Codeblocks":"\u041f\u0435\u0440\u0435\u043d\u043e\u0441 \u043a\u043e\u0434\u0430",
              "Show Chat Scrollbar":"\u041f\u043e\u043b\u043e\u0441\u0430 \u043f\u0440\u043e\u043a\u0440\u0443\u0442\u043a\u0438 \u0447\u0430\u0442\u0430","Text-to-Speech Output":"\u041e\u0437\u0432\u0443\u0447\u0438\u0432\u0430\u043d\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u043e\u0432",
              "Enable Session Titles":"\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u0441\u0435\u0441\u0441\u0438\u0439","Format Markdown":"\u0424\u043e\u0440\u043c\u0430\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 Markdown",
              "Screen width too small":"\u0428\u0438\u0440\u0438\u043d\u0430 \u044d\u043a\u0440\u0430\u043d\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u0430\u043b\u0430",
              "Displays tabs above the chat as an alternative way to organize and access your sessions.":"\u041e\u0442\u043e\u0431\u0440\u0430\u0436\u0430\u0435\u0442 \u0432\u043a\u043b\u0430\u0434\u043a\u0438 \u043d\u0430\u0434 \u0447\u0430\u0442\u043e\u043c \u0434\u043b\u044f \u0443\u0434\u043e\u0431\u043d\u043e\u0433\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u0441\u0435\u0441\u0441\u0438\u044f\u043c.",
              "Wraps long lines in code blocks instead of showing horizontal scroll.":"\u041f\u0435\u0440\u0435\u043d\u043e\u0441\u0438\u0442 \u0434\u043b\u0438\u043d\u043d\u044b\u0435 \u0441\u0442\u0440\u043e\u043a\u0438 \u0432 \u0431\u043b\u043e\u043a\u0430\u0445 \u043a\u043e\u0434\u0430 \u0432\u043c\u0435\u0441\u0442\u043e \u0433\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u043e\u0439 \u043f\u0440\u043e\u043a\u0440\u0443\u0442\u043a\u0438.",
              "Enables a scrollbar in the chat window.":"\u0412\u043a\u043b\u044e\u0447\u0430\u0435\u0442 \u043f\u043e\u043b\u043e\u0441\u0443 \u043f\u0440\u043e\u043a\u0440\u0443\u0442\u043a\u0438 \u0432 \u043e\u043a\u043d\u0435 \u0447\u0430\u0442\u0430.",
              "Reads LLM responses aloud with TTS.":"\u041e\u0437\u0432\u0443\u0447\u0438\u0432\u0430\u0435\u0442 \u043e\u0442\u0432\u0435\u0442\u044b \u043c\u043e\u0434\u0435\u043b\u0438 \u0447\u0435\u0440\u0435\u0437 TTS.",
              "Generates summary titles for each chat session after the first message, using the current Chat model.":"\u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u0435\u0442 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u0441\u0435\u0441\u0441\u0438\u0439 \u043f\u043e\u0441\u043b\u0435 \u043f\u0435\u0440\u0432\u043e\u0433\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f, \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u044f \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u043c\u043e\u0434\u0435\u043b\u044c.",
              "If off, shows responses as raw text.":"\u0415\u0441\u043b\u0438 \u0432\u044b\u043a\u043b., \u043e\u0442\u0432\u0435\u0442\u044b \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0430\u044e\u0442\u0441\u044f \u043a\u0430\u043a \u043f\u0440\u043e\u0441\u0442\u043e\u0439 \u0442\u0435\u043a\u0441\u0442.",
              "To view settings, please expand the sidebar by dragging the left/right border":"\u0414\u043b\u044f \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043a \u0440\u0430\u0441\u0448\u0438\u0440\u044c\u0442\u0435 \u0431\u043e\u043a\u043e\u0432\u0443\u044e \u043f\u0430\u043d\u0435\u043b\u044c",
              "Experimental":"\u042d\u043a\u0441\u043f\u0435\u0440\u0438\u043c\u0435\u043d\u0442\u0430\u043b\u044c\u043d\u043e\u0435","Show Experimental Settings":"\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u043a\u0441\u043f\u0435\u0440\u0438\u043c\u0435\u043d\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438",
              "Add Current File by Default":"\u0414\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0444\u0430\u0439\u043b \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e",
              "the currently open file is added as context in every new conversation.":"\u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0439 \u0444\u0430\u0439\u043b \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043a\u0430\u043a \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442 \u0432 \u043a\u0430\u0436\u0434\u043e\u043c \u043d\u043e\u0432\u043e\u043c \u0440\u0430\u0437\u0433\u043e\u0432\u043e\u0440\u0435.",
              "Enable experimental tools":"\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u044d\u043a\u0441\u043f\u0435\u0440\u0438\u043c\u0435\u043d\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b",
              "enables access to experimental tools that are still in development.":"\u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u044d\u043a\u0441\u043f\u0435\u0440\u0438\u043c\u0435\u043d\u0442\u0430\u043b\u044c\u043d\u044b\u043c \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430\u043c, \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u0435\u0449\u0451 \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0435.",
              "Only use system message tools":"\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b",
              "Xynapse will not attempt to use native tool calling and will only use system message tools.":"Xynapse \u043d\u0435 \u0431\u0443\u0434\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u043d\u0430\u0442\u0438\u0432\u043d\u044b\u0435 \u0432\u044b\u0437\u043e\u0432\u044b \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432, \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435.",
              "@Codebase: use tool calling only":"@Codebase: \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u044b\u0437\u043e\u0432 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432",
              "@codebase context provider will only use tool calling for code retrieval.":"\u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440 @codebase \u0431\u0443\u0434\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u044b\u0437\u043e\u0432 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0434\u043b\u044f \u043f\u043e\u0438\u0441\u043a\u0430 \u043a\u043e\u0434\u0430.",
              "Stream after tool rejection":"\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u043f\u043e\u0441\u043b\u0435 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u044f \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430",
              "streaming will Xynapse after the tool call is rejected.":"Xynapse \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442 \u0441\u0442\u0440\u0438\u043c\u0438\u043d\u0433 \u043f\u043e\u0441\u043b\u0435 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u044f \u0432\u044b\u0437\u043e\u0432\u0430 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430."},
            "de":{"Chat":"Chat","Agent":"Agent","Shadow":"Schatten",
              "Select Mode":"Modus","Select Model":"Modell",
              "Council":"Rat","BVC":"BVC",
              "Attach Image":"Bild","Attach Context":"Kontext",
              "Send (\u23ce)":"Senden (\u23ce)","Enter":"Eingabe","Retry":"Erneut","Edit":"Bearbeiten","Cancel":"Abbrechen","Delete":"L\u00f6schen","Confirm":"Best\u00e4tigen",
              "Apply Code":"Anwenden","Copy Code":"Kopieren","Create File with Code":"Datei erstellen",
              "Insert Code":"Einf\u00fcgen","Copy into terminal":"In Terminal kopieren",
              "Open in browser":"Im Browser \u00f6ffnen","Save Chat as Markdown":"Als Markdown speichern",
              "Delete item?":"L\u00f6schen?","Enable Shadow Mode?":"Schattenmodus aktivieren?","Enable Shadow Mode":"Schattenmodus",
              "Show":"Anzeigen","Hide":"Verbergen","Collapse":"Zuklappen","Expand":"Aufklappen",
              "Zoom In":"Vergr\u00f6\u00dfern","Zoom Out":"Verkleinern","Reset Zoom":"Zoom zur\u00fccksetzen",
              "No active file":"Keine aktive Datei","Active file":"Aktive Datei",
              "Disable model reasoning":"Denken deaktivieren","Enable model reasoning":"Denken aktivieren",
              "Search...":"Suchen...","Search past sessions":"Sitzungen durchsuchen",
              "Edit selected code":"Code bearbeiten",
              "All tools disabled":"Alle Tools deaktiviert","All tools available":"Alle Tools verf\u00fcgbar",
              "Esc to exit Edit":"Esc zum Beenden",
              "Back":"Zur\u00fcck","Models":"Modelle","Rules":"Regeln","Tools":"Werkzeuge","Configs":"Konfigurationen",
              "Organizations":"Organisationen","Indexing":"Indizierung","Help":"Hilfe","Log in":"Anmelden",
              "Autocomplete":"Autovervollst\u00e4ndigung","Auto":"Auto","Multiline Autocompletions":"Mehrzeilige Vervollst\u00e4ndigung",
              "User Settings":"Benutzereinstellungen","Local Config":"Lokale Konfiguration","Config rules":"Konfigurationsregeln",
              "Show Session Tabs":"Sitzungs-Tabs","Wrap Codeblocks":"Code umbrechen","Show Chat Scrollbar":"Chat-Scrollleiste",
              "Text-to-Speech Output":"Sprachausgabe","Enable Session Titles":"Sitzungstitel","Format Markdown":"Markdown formatieren",
              "Screen width too small":"Bildschirmbreite zu klein","Experimental":"Experimentell","Show Experimental Settings":"Experimentelle Einstellungen","Add Current File by Default":"Aktuelle Datei standardmäßig hinzufügen","Enable experimental tools":"Experimentelle Tools aktivieren","Only use system message tools":"Nur Systemnachricht-Tools","Stream after tool rejection":"Nach Tool-Ablehnung streamen"},
            "fr":{"Chat":"Chat","Agent":"Agent","Shadow":"Ombre",
              "Select Mode":"Mode","Select Model":"Mod\u00e8le",
              "Council":"Conseil","BVC":"BVC",
              "Attach Image":"Image","Attach Context":"Contexte",
              "Send (\u23ce)":"Envoyer (\u23ce)","Enter":"Entr\u00e9e","Retry":"R\u00e9essayer","Edit":"Modifier","Cancel":"Annuler","Delete":"Supprimer","Confirm":"Confirmer",
              "Apply Code":"Appliquer","Copy Code":"Copier","Create File with Code":"Cr\u00e9er un fichier",
              "Insert Code":"Ins\u00e9rer","Copy into terminal":"Copier dans le terminal",
              "Open in browser":"Ouvrir dans le navigateur","Save Chat as Markdown":"Enregistrer en Markdown",
              "Delete item?":"Supprimer?","Enable Shadow Mode?":"Activer le mode Ombre?","Enable Shadow Mode":"Mode Ombre",
              "Show":"Afficher","Hide":"Masquer","Collapse":"R\u00e9duire","Expand":"D\u00e9velopper",
              "Zoom In":"Agrandir","Zoom Out":"R\u00e9duire","Reset Zoom":"R\u00e9initialiser le zoom",
              "No active file":"Aucun fichier actif","Active file":"Fichier actif",
              "Disable model reasoning":"D\u00e9sactiver le raisonnement","Enable model reasoning":"Activer le raisonnement",
              "Search...":"Rechercher...","Search past sessions":"Rechercher les sessions",
              "Edit selected code":"Modifier le code",
              "All tools disabled":"Tous les outils d\u00e9sactiv\u00e9s","All tools available":"Tous les outils disponibles",
              "Esc to exit Edit":"Echap pour quitter",
              "Back":"Retour","Models":"Mod\u00e8les","Rules":"R\u00e8gles","Tools":"Outils","Configs":"Configurations",
              "Organizations":"Organisations","Indexing":"Indexation","Help":"Aide","Log in":"Se connecter",
              "Autocomplete":"Autocompl\u00e9tion","Auto":"Auto","Multiline Autocompletions":"Autocompl\u00e9tion multiligne",
              "User Settings":"Param\u00e8tres utilisateur","Local Config":"Config locale","Config rules":"R\u00e8gles de config",
              "Show Session Tabs":"Onglets de session","Wrap Codeblocks":"Retour \u00e0 la ligne","Show Chat Scrollbar":"Barre de d\u00e9filement",
              "Text-to-Speech Output":"Synth\u00e8se vocale","Enable Session Titles":"Titres de session","Format Markdown":"Formater Markdown",
              "Screen width too small":"\u00c9cran trop \u00e9troit","Experimental":"Expérimental","Show Experimental Settings":"Paramètres expérimentaux","Add Current File by Default":"Ajouter le fichier actuel par défaut","Enable experimental tools":"Activer les outils expérimentaux","Only use system message tools":"Uniquement les outils système","Stream after tool rejection":"Continuer après rejet"},
            "es":{"Chat":"Chat","Agent":"Agente","Shadow":"Sombra",
              "Select Mode":"Modo","Select Model":"Modelo",
              "Council":"Consejo","BVC":"BVC",
              "Attach Image":"Imagen","Attach Context":"Contexto",
              "Send (\u23ce)":"Enviar (\u23ce)","Enter":"Intro","Retry":"Reintentar","Edit":"Editar","Cancel":"Cancelar","Delete":"Eliminar","Confirm":"Confirmar",
              "Apply Code":"Aplicar","Copy Code":"Copiar","Create File with Code":"Crear archivo",
              "Insert Code":"Insertar","Copy into terminal":"Copiar en terminal",
              "Open in browser":"Abrir en navegador","Save Chat as Markdown":"Guardar como Markdown",
              "Delete item?":"\u00bfEliminar?","Enable Shadow Mode?":"\u00bfActivar modo Sombra?","Enable Shadow Mode":"Modo Sombra",
              "Show":"Mostrar","Hide":"Ocultar","Collapse":"Contraer","Expand":"Expandir",
              "Zoom In":"Acercar","Zoom Out":"Alejar","Reset Zoom":"Restablecer zoom",
              "No active file":"Sin archivo activo","Active file":"Archivo activo",
              "Disable model reasoning":"Desactivar razonamiento","Enable model reasoning":"Activar razonamiento",
              "Search...":"Buscar...","Search past sessions":"Buscar sesiones",
              "Edit selected code":"Editar c\u00f3digo",
              "All tools disabled":"Herramientas desactivadas","All tools available":"Herramientas disponibles",
              "Esc to exit Edit":"Esc para salir",
              "Back":"Atr\u00e1s","Models":"Modelos","Rules":"Reglas","Tools":"Herramientas","Configs":"Configuraciones",
              "Organizations":"Organizaciones","Indexing":"Indexaci\u00f3n","Help":"Ayuda","Log in":"Iniciar sesi\u00f3n",
              "Autocomplete":"Autocompletar","Auto":"Auto","Multiline Autocompletions":"Autocompletado multil\u00ednea",
              "User Settings":"Configuraci\u00f3n de usuario","Local Config":"Config local","Config rules":"Reglas de config",
              "Show Session Tabs":"Pesta\u00f1as de sesi\u00f3n","Wrap Codeblocks":"Ajustar c\u00f3digo","Show Chat Scrollbar":"Barra de desplazamiento",
              "Text-to-Speech Output":"Salida de voz","Enable Session Titles":"T\u00edtulos de sesi\u00f3n","Format Markdown":"Formatear Markdown",
              "Screen width too small":"Pantalla demasiado estrecha","Experimental":"Experimental","Show Experimental Settings":"Configuración experimental","Add Current File by Default":"Agregar archivo actual por defecto","Enable experimental tools":"Habilitar herramientas experimentales","Only use system message tools":"Solo herramientas del sistema","Stream after tool rejection":"Continuar tras rechazo"},
            "zh":{"Chat":"\u804a\u5929","Agent":"\u4ee3\u7406","Shadow":"\u5f71\u5b50",
              "Select Mode":"\u6a21\u5f0f","Select Model":"\u6a21\u578b",
              "Council":"\u8bae\u4f1a","BVC":"BVC",
              "Attach Image":"\u56fe\u7247","Attach Context":"\u4e0a\u4e0b\u6587",
              "Send (\u23ce)":"\u53d1\u9001 (\u23ce)","Enter":"\u786e\u8ba4","Retry":"\u91cd\u8bd5","Edit":"\u7f16\u8f91","Cancel":"\u53d6\u6d88","Delete":"\u5220\u9664","Confirm":"\u786e\u8ba4",
              "Apply Code":"\u5e94\u7528","Copy Code":"\u590d\u5236","Create File with Code":"\u521b\u5efa\u6587\u4ef6",
              "Insert Code":"\u63d2\u5165","Copy into terminal":"\u590d\u5236\u5230\u7ec8\u7aef",
              "Open in browser":"\u5728\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00","Save Chat as Markdown":"\u4fdd\u5b58\u4e3aMarkdown",
              "Delete item?":"\u5220\u9664?","Enable Shadow Mode?":"\u542f\u7528\u5f71\u5b50\u6a21\u5f0f?","Enable Shadow Mode":"\u5f71\u5b50\u6a21\u5f0f",
              "Show":"\u663e\u793a","Hide":"\u9690\u85cf","Collapse":"\u6298\u53e0","Expand":"\u5c55\u5f00",
              "Zoom In":"\u653e\u5927","Zoom Out":"\u7f29\u5c0f","Reset Zoom":"\u91cd\u7f6e\u7f29\u653e",
              "No active file":"\u65e0\u6d3b\u52a8\u6587\u4ef6","Active file":"\u6d3b\u52a8\u6587\u4ef6",
              "Disable model reasoning":"\u5173\u95ed\u63a8\u7406","Enable model reasoning":"\u5f00\u542f\u63a8\u7406",
              "Search...":"\u641c\u7d22...","Search past sessions":"\u641c\u7d22\u5386\u53f2\u4f1a\u8bdd",
              "Edit selected code":"\u7f16\u8f91\u4ee3\u7801",
              "All tools disabled":"\u6240\u6709\u5de5\u5177\u5df2\u7981\u7528","All tools available":"\u6240\u6709\u5de5\u5177\u53ef\u7528",
              "Esc to exit Edit":"Esc\u9000\u51fa\u7f16\u8f91",
              "Back":"\u8fd4\u56de","Models":"\u6a21\u578b","Rules":"\u89c4\u5219","Tools":"\u5de5\u5177","Configs":"\u914d\u7f6e",
              "Organizations":"\u7ec4\u7ec7","Indexing":"\u7d22\u5f15","Help":"\u5e2e\u52a9","Log in":"\u767b\u5f55",
              "Autocomplete":"\u81ea\u52a8\u8865\u5168","Auto":"\u81ea\u52a8","Multiline Autocompletions":"\u591a\u884c\u81ea\u52a8\u8865\u5168",
              "User Settings":"\u7528\u6237\u8bbe\u7f6e","Local Config":"\u672c\u5730\u914d\u7f6e","Config rules":"\u914d\u7f6e\u89c4\u5219",
              "Show Session Tabs":"\u4f1a\u8bdd\u6807\u7b7e","Wrap Codeblocks":"\u4ee3\u7801\u6362\u884c","Show Chat Scrollbar":"\u804a\u5929\u6eda\u52a8\u6761",
              "Text-to-Speech Output":"\u8bed\u97f3\u8f93\u51fa","Enable Session Titles":"\u4f1a\u8bdd\u6807\u9898","Format Markdown":"\u683c\u5f0fMarkdown",
              "Screen width too small":"\u5c4f\u5e55\u5bbd\u5ea6\u592a\u5c0f","Experimental":"实验性","Show Experimental Settings":"显示实验性设置","Add Current File by Default":"默认添加当前文件","Enable experimental tools":"启用实验性工具","Only use system message tools":"仅使用系统消息工具","Stream after tool rejection":"工具拒绝后继续"},
            "zh-cn":{"Chat":"\u804a\u5929","Agent":"\u4ee3\u7406","Shadow":"\u5f71\u5b50",
              "Select Mode":"\u6a21\u5f0f","Select Model":"\u6a21\u578b",
              "Council":"\u8bae\u4f1a","BVC":"BVC",
              "Attach Image":"\u56fe\u7247","Attach Context":"\u4e0a\u4e0b\u6587",
              "Send (\u23ce)":"\u53d1\u9001 (\u23ce)","Enter":"\u786e\u8ba4","Retry":"\u91cd\u8bd5","Edit":"\u7f16\u8f91","Cancel":"\u53d6\u6d88","Delete":"\u5220\u9664","Confirm":"\u786e\u8ba4",
              "Apply Code":"\u5e94\u7528","Copy Code":"\u590d\u5236","Create File with Code":"\u521b\u5efa\u6587\u4ef6",
              "Insert Code":"\u63d2\u5165","Copy into terminal":"\u590d\u5236\u5230\u7ec8\u7aef",
              "Open in browser":"\u5728\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00","Save Chat as Markdown":"\u4fdd\u5b58\u4e3aMarkdown",
              "Delete item?":"\u5220\u9664?","Enable Shadow Mode?":"\u542f\u7528\u5f71\u5b50\u6a21\u5f0f?","Enable Shadow Mode":"\u5f71\u5b50\u6a21\u5f0f",
              "Show":"\u663e\u793a","Hide":"\u9690\u85cf","Collapse":"\u6298\u53e0","Expand":"\u5c55\u5f00",
              "Zoom In":"\u653e\u5927","Zoom Out":"\u7f29\u5c0f","Reset Zoom":"\u91cd\u7f6e\u7f29\u653e",
              "No active file":"\u65e0\u6d3b\u52a8\u6587\u4ef6","Active file":"\u6d3b\u52a8\u6587\u4ef6",
              "Disable model reasoning":"\u5173\u95ed\u63a8\u7406","Enable model reasoning":"\u5f00\u542f\u63a8\u7406",
              "Search...":"\u641c\u7d22...","Search past sessions":"\u641c\u7d22\u5386\u53f2\u4f1a\u8bdd",
              "Edit selected code":"\u7f16\u8f91\u4ee3\u7801",
              "All tools disabled":"\u6240\u6709\u5de5\u5177\u5df2\u7981\u7528","All tools available":"\u6240\u6709\u5de5\u5177\u53ef\u7528",
              "Esc to exit Edit":"Esc\u9000\u51fa\u7f16\u8f91",
              "Back":"\u8fd4\u56de","Models":"\u6a21\u578b","Rules":"\u89c4\u5219","Tools":"\u5de5\u5177","Configs":"\u914d\u7f6e",
              "Organizations":"\u7ec4\u7ec7","Indexing":"\u7d22\u5f15","Help":"\u5e2e\u52a9","Log in":"\u767b\u5f55",
              "Autocomplete":"\u81ea\u52a8\u8865\u5168","Auto":"\u81ea\u52a8","User Settings":"\u7528\u6237\u8bbe\u7f6e",
              "Screen width too small":"\u5c4f\u5e55\u5bbd\u5ea6\u592a\u5c0f","Experimental":"实验性","Show Experimental Settings":"显示实验性设置","Add Current File by Default":"默认添加当前文件","Enable experimental tools":"启用实验性工具","Only use system message tools":"仅使用系统消息工具","Stream after tool rejection":"工具拒绝后继续","Multiline Autocompletions":"多行自动补全","Local Config":"本地配置","Config rules":"配置规则","Show Session Tabs":"会话标签","Wrap Codeblocks":"代码换行","Show Chat Scrollbar":"聊天滚动条","Text-to-Speech Output":"语音输出","Enable Session Titles":"会话标题","Format Markdown":"格式化Markdown"},
            "zh-tw":{"Chat":"\u804a\u5929","Agent":"\u4ee3\u7406","Shadow":"\u9670\u5f71",
              "Select Mode":"\u6a21\u5f0f","Select Model":"\u6a21\u578b",
              "Council":"\u8b70\u6703","BVC":"BVC",
              "Attach Image":"\u5716\u7247","Attach Context":"\u4e0a\u4e0b\u6587",
              "Send (\u23ce)":"\u50b3\u9001 (\u23ce)","Enter":"\u78ba\u8a8d","Retry":"\u91cd\u8a66","Edit":"\u7de8\u8f2f","Cancel":"\u53d6\u6d88","Delete":"\u522a\u9664","Confirm":"\u78ba\u8a8d",
              "Apply Code":"\u5957\u7528","Copy Code":"\u8907\u88fd","Create File with Code":"\u5efa\u7acb\u6a94\u6848",
              "Insert Code":"\u63d2\u5165","Copy into terminal":"\u8907\u88fd\u5230\u7d42\u7aef",
              "Open in browser":"\u5728\u700f\u89bd\u5668\u4e2d\u958b\u555f","Save Chat as Markdown":"\u5132\u5b58\u70baMarkdown",
              "Delete item?":"\u522a\u9664?","Enable Shadow Mode?":"\u555f\u7528\u9670\u5f71\u6a21\u5f0f?","Enable Shadow Mode":"\u9670\u5f71\u6a21\u5f0f",
              "Show":"\u986f\u793a","Hide":"\u96b1\u85cf","Collapse":"\u647a\u758a","Expand":"\u5c55\u958b",
              "Zoom In":"\u653e\u5927","Zoom Out":"\u7e2e\u5c0f","Reset Zoom":"\u91cd\u8a2d\u7e2e\u653e",
              "No active file":"\u7121\u6d3b\u52d5\u6a94\u6848","Active file":"\u6d3b\u52d5\u6a94\u6848",
              "Disable model reasoning":"\u95dc\u9589\u63a8\u7406","Enable model reasoning":"\u958b\u555f\u63a8\u7406",
              "Search...":"\u641c\u5c0b...","Search past sessions":"\u641c\u5c0b\u6b77\u53f2\u5c0d\u8a71",
              "Edit selected code":"\u7de8\u8f2f\u7a0b\u5f0f\u78bc",
              "All tools disabled":"\u6240\u6709\u5de5\u5177\u5df2\u7981\u7528","All tools available":"\u6240\u6709\u5de5\u5177\u53ef\u7528",
              "Esc to exit Edit":"Esc\u9000\u51fa\u7de8\u8f2f",
              "Back":"\u8fd4\u56de","Models":"\u6a21\u578b","Rules":"\u898f\u5247","Tools":"\u5de5\u5177","Configs":"\u8a2d\u5b9a",
              "Organizations":"\u7d44\u7e54","Indexing":"\u7d22\u5f15","Help":"\u5e6b\u52a9","Log in":"\u767b\u5165",
              "Autocomplete":"\u81ea\u52d5\u5b8c\u6210","Auto":"\u81ea\u52d5","User Settings":"\u4f7f\u7528\u8005\u8a2d\u5b9a",
              "Screen width too small":"\u87a2\u5e55\u5bec\u5ea6\u592a\u5c0f","Experimental":"實驗性","Show Experimental Settings":"顯示實驗性設定","Add Current File by Default":"預設加入目前檔案","Enable experimental tools":"啟用實驗性工具","Only use system message tools":"僅使用系統訊息工具","Stream after tool rejection":"工具拒絕後繼續","Multiline Autocompletions":"多行自動完成","Local Config":"本地設定","Config rules":"設定規則","Show Session Tabs":"對話標籤","Wrap Codeblocks":"程式碼換行","Show Chat Scrollbar":"聊天捲動條","Text-to-Speech Output":"語音輸出","Enable Session Titles":"對話標題","Format Markdown":"格式化Markdown"},
            "ja":{"Chat":"\u30c1\u30e3\u30c3\u30c8","Agent":"\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8","Shadow":"\u30b7\u30e3\u30c9\u30a6",
              "Select Mode":"\u30e2\u30fc\u30c9","Select Model":"\u30e2\u30c7\u30eb",
              "Council":"\u30ab\u30a6\u30f3\u30b7\u30eb","BVC":"BVC",
              "Attach Image":"\u753b\u50cf","Attach Context":"\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8",
              "Send (\u23ce)":"\u9001\u4fe1 (\u23ce)","Enter":"\u78ba\u5b9a","Retry":"\u518d\u8a66\u884c","Edit":"\u7de8\u96c6","Cancel":"\u30ad\u30e3\u30f3\u30bb\u30eb","Delete":"\u524a\u9664","Confirm":"\u78ba\u8a8d",
              "Apply Code":"\u9069\u7528","Copy Code":"\u30b3\u30d4\u30fc","Create File with Code":"\u30d5\u30a1\u30a4\u30eb\u4f5c\u6210",
              "Insert Code":"\u633f\u5165","Copy into terminal":"\u30bf\u30fc\u30df\u30ca\u30eb\u306b\u30b3\u30d4\u30fc",
              "Open in browser":"\u30d6\u30e9\u30a6\u30b6\u3067\u958b\u304f","Save Chat as Markdown":"Markdown\u3067\u4fdd\u5b58",
              "Delete item?":"\u524a\u9664\u3057\u307e\u3059\u304b?","Enable Shadow Mode?":"\u30b7\u30e3\u30c9\u30a6\u30e2\u30fc\u30c9\u3092\u6709\u52b9\u306b?","Enable Shadow Mode":"\u30b7\u30e3\u30c9\u30a6\u30e2\u30fc\u30c9",
              "Show":"\u8868\u793a","Hide":"\u975e\u8868\u793a","Collapse":"\u6298\u308a\u305f\u305f\u307f","Expand":"\u5c55\u958b",
              "Zoom In":"\u62e1\u5927","Zoom Out":"\u7e2e\u5c0f","Reset Zoom":"\u30ba\u30fc\u30e0\u30ea\u30bb\u30c3\u30c8",
              "No active file":"\u30a2\u30af\u30c6\u30a3\u30d6\u306a\u30d5\u30a1\u30a4\u30eb\u306a\u3057","Active file":"\u30a2\u30af\u30c6\u30a3\u30d6\u30d5\u30a1\u30a4\u30eb",
              "Disable model reasoning":"\u63a8\u8ad6\u7121\u52b9","Enable model reasoning":"\u63a8\u8ad6\u6709\u52b9",
              "Search...":"\u691c\u7d22...","Search past sessions":"\u30bb\u30c3\u30b7\u30e7\u30f3\u3092\u691c\u7d22",
              "Edit selected code":"\u30b3\u30fc\u30c9\u3092\u7de8\u96c6",
              "All tools disabled":"\u5168\u30c4\u30fc\u30eb\u7121\u52b9","All tools available":"\u5168\u30c4\u30fc\u30eb\u6709\u52b9",
              "Esc to exit Edit":"Esc\u3067\u7d42\u4e86",
              "Back":"\u623b\u308b","Models":"\u30e2\u30c7\u30eb","Rules":"\u30eb\u30fc\u30eb","Tools":"\u30c4\u30fc\u30eb","Configs":"\u8a2d\u5b9a",
              "Organizations":"\u7d44\u7e54","Indexing":"\u30a4\u30f3\u30c7\u30c3\u30af\u30b9","Help":"\u30d8\u30eb\u30d7","Log in":"\u30ed\u30b0\u30a4\u30f3",
              "Autocomplete":"\u81ea\u52d5\u88dc\u5b8c","Auto":"\u81ea\u52d5","User Settings":"\u30e6\u30fc\u30b6\u30fc\u8a2d\u5b9a",
              "Screen width too small":"\u753b\u9762\u5e45\u304c\u5c0f\u3055\u3059\u304e\u307e\u3059","Experimental":"実験的","Show Experimental Settings":"実験的設定を表示","Add Current File by Default":"現在のファイルをデフォルトで追加","Enable experimental tools":"実験的ツールを有効化","Only use system message tools":"システムメッセージツールのみ","Stream after tool rejection":"ツール拒否後もストリーミング","Multiline Autocompletions":"複数行の自動補完","Local Config":"ローカル設定","Config rules":"設定ルール","Show Session Tabs":"セッションタブ","Wrap Codeblocks":"コード折り返し","Show Chat Scrollbar":"チャットスクロールバー","Text-to-Speech Output":"音声出力","Enable Session Titles":"セッションタイトル","Format Markdown":"Markdown書式"},
            "ko":{"Chat":"\ucc44\ud305","Agent":"\uc5d0\uc774\uc804\ud2b8","Shadow":"\uc250\ub3c4\uc6b0",
              "Select Mode":"\ubaa8\ub4dc","Select Model":"\ubaa8\ub378",
              "Council":"\ud68c\uc758","BVC":"BVC",
              "Attach Image":"\uc774\ubbf8\uc9c0","Attach Context":"\ucee8\ud14d\uc2a4\ud2b8",
              "Send (\u23ce)":"\ubcf4\ub0b4\uae30 (\u23ce)","Enter":"\uc785\ub825","Retry":"\uc7ac\uc2dc\ub3c4","Edit":"\ud3b8\uc9d1","Cancel":"\ucde8\uc18c","Delete":"\uc0ad\uc81c","Confirm":"\ud655\uc778",
              "Apply Code":"\uc801\uc6a9","Copy Code":"\ubcf5\uc0ac","Create File with Code":"\ud30c\uc77c \uc0dd\uc131",
              "Insert Code":"\uc0bd\uc785","Copy into terminal":"\ud130\ubbf8\ub110\uc5d0 \ubcf5\uc0ac",
              "Open in browser":"\ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \uc5f4\uae30","Save Chat as Markdown":"Markdown\uc73c\ub85c \uc800\uc7a5",
              "Delete item?":"\uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?","Enable Shadow Mode?":"\uc250\ub3c4\uc6b0 \ubaa8\ub4dc\ub97c \ud65c\uc131\ud654?","Enable Shadow Mode":"\uc250\ub3c4\uc6b0 \ubaa8\ub4dc",
              "Show":"\ud45c\uc2dc","Hide":"\uc228\uae30\uae30","Collapse":"\uc811\uae30","Expand":"\ud3bc\uce58\uae30",
              "Zoom In":"\ud655\ub300","Zoom Out":"\ucd95\uc18c","Reset Zoom":"\uc90c \ucd08\uae30\ud654",
              "No active file":"\ud65c\uc131 \ud30c\uc77c \uc5c6\uc74c","Active file":"\ud65c\uc131 \ud30c\uc77c",
              "Disable model reasoning":"\ucd94\ub860 \ube44\ud65c\uc131\ud654","Enable model reasoning":"\ucd94\ub860 \ud65c\uc131\ud654",
              "Search...":"\uac80\uc0c9...","Search past sessions":"\uc138\uc158 \uac80\uc0c9",
              "Edit selected code":"\ucf54\ub4dc \ud3b8\uc9d1",
              "All tools disabled":"\ubaa8\ub4e0 \ub3c4\uad6c \ube44\ud65c\uc131\ud654","All tools available":"\ubaa8\ub4e0 \ub3c4\uad6c \uc0ac\uc6a9 \uac00\ub2a5",
              "Esc to exit Edit":"Esc\ub85c \uc885\ub8cc",
              "Back":"\ub4a4\ub85c","Models":"\ubaa8\ub378","Rules":"\uaddc\uce59","Tools":"\ub3c4\uad6c","Configs":"\uad6c\uc131",
              "Organizations":"\uc870\uc9c1","Indexing":"\uc778\ub371\uc2f1","Help":"\ub3c4\uc6c0\ub9d0","Log in":"\ub85c\uadf8\uc778",
              "Autocomplete":"\uc790\ub3d9\uc644\uc131","Auto":"\uc790\ub3d9","User Settings":"\uc0ac\uc6a9\uc790 \uc124\uc815",
              "Screen width too small":"\ud654\uba74 \ub108\ube44\uac00 \ub108\ubb34 \uc791\uc2b5\ub2c8\ub2e4","Experimental":"실험적","Show Experimental Settings":"실험적 설정 표시","Add Current File by Default":"현재 파일 기본 추가","Enable experimental tools":"실험적 도구 활성화","Only use system message tools":"시스템 메시지 도구만 사용","Stream after tool rejection":"도구 거부 후 스트리밍","Multiline Autocompletions":"여러 줄 자동완성","Local Config":"로컬 구성","Config rules":"구성 규칙","Show Session Tabs":"세션 탭","Wrap Codeblocks":"코드 줄바꿈","Show Chat Scrollbar":"채팅 스크롤바","Text-to-Speech Output":"음성 출력","Enable Session Titles":"세션 제목","Format Markdown":"Markdown 서식"},
            "uk":{"Chat":"\u0427\u0430\u0442","Agent":"\u0410\u0433\u0435\u043d\u0442","Shadow":"\u0422\u0456\u043d\u044c",
              "Select Mode":"\u0420\u0435\u0436\u0438\u043c","Select Model":"\u041c\u043e\u0434\u0435\u043b\u044c",
              "Council":"\u0420\u0430\u0434\u0430","BVC":"BVC",
              "Attach Image":"\u0417\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u043d\u044f","Attach Context":"\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
              "Send (\u23ce)":"\u041d\u0430\u0434\u0456\u0441\u043b\u0430\u0442\u0438 (\u23ce)","Enter":"\u0412\u0432\u0435\u0434\u0435\u043d\u043d\u044f","Retry":"\u041f\u043e\u0432\u0442\u043e\u0440","Edit":"\u0420\u0435\u0434\u0430\u0433\u0443\u0432\u0430\u0442\u0438","Cancel":"\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438","Delete":"\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438","Confirm":"\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0438",
              "Apply Code":"\u0417\u0430\u0441\u0442\u043e\u0441\u0443\u0432\u0430\u0442\u0438","Copy Code":"\u041a\u043e\u043f\u0456\u044e\u0432\u0430\u0442\u0438","Create File with Code":"\u0421\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0444\u0430\u0439\u043b",
              "Insert Code":"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u0438","Copy into terminal":"\u041a\u043e\u043f\u0456\u044e\u0432\u0430\u0442\u0438 \u0432 \u0442\u0435\u0440\u043c\u0456\u043d\u0430\u043b",
              "Open in browser":"\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0456","Save Chat as Markdown":"\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u044f\u043a Markdown",
              "Delete item?":"\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438?","Enable Shadow Mode?":"\u0423\u0432\u0456\u043c\u043a\u043d\u0443\u0442\u0438 \u0440\u0435\u0436\u0438\u043c \u0422\u0456\u043d\u044c?","Enable Shadow Mode":"\u0420\u0435\u0436\u0438\u043c \u0422\u0456\u043d\u044c",
              "Show":"\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u0438","Hide":"\u0421\u0445\u043e\u0432\u0430\u0442\u0438","Collapse":"\u0417\u0433\u043e\u0440\u043d\u0443\u0442\u0438","Expand":"\u0420\u043e\u0437\u0433\u043e\u0440\u043d\u0443\u0442\u0438",
              "Zoom In":"\u0417\u0431\u0456\u043b\u044c\u0448\u0438\u0442\u0438","Zoom Out":"\u0417\u043c\u0435\u043d\u0448\u0438\u0442\u0438","Reset Zoom":"\u0421\u043a\u0438\u043d\u0443\u0442\u0438 \u043c\u0430\u0441\u0448\u0442\u0430\u0431",
              "No active file":"\u041d\u0435\u043c\u0430\u0454 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0433\u043e \u0444\u0430\u0439\u043b\u0443","Active file":"\u0410\u043a\u0442\u0438\u0432\u043d\u0438\u0439 \u0444\u0430\u0439\u043b",
              "Disable model reasoning":"\u0412\u0438\u043c\u043a\u043d\u0443\u0442\u0438 \u043c\u0456\u0440\u043a\u0443\u0432\u0430\u043d\u043d\u044f","Enable model reasoning":"\u0423\u0432\u0456\u043c\u043a\u043d\u0443\u0442\u0438 \u043c\u0456\u0440\u043a\u0443\u0432\u0430\u043d\u043d\u044f",
              "Search...":"\u041f\u043e\u0448\u0443\u043a...","Search past sessions":"\u041f\u043e\u0448\u0443\u043a \u0441\u0435\u0441\u0456\u0439",
              "Edit selected code":"\u0420\u0435\u0434\u0430\u0433\u0443\u0432\u0430\u0442\u0438 \u043a\u043e\u0434",
              "All tools disabled":"\u0412\u0441\u0456 \u0456\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0438 \u0432\u0438\u043c\u043a\u043d\u0435\u043d\u043e","All tools available":"\u0412\u0441\u0456 \u0456\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0456",
              "Esc to exit Edit":"Esc \u0434\u043b\u044f \u0432\u0438\u0445\u043e\u0434\u0443",
              "Back":"\u041d\u0430\u0437\u0430\u0434","Models":"\u041c\u043e\u0434\u0435\u043b\u0456","Rules":"\u041f\u0440\u0430\u0432\u0438\u043b\u0430","Tools":"\u0406\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0438","Configs":"\u041a\u043e\u043d\u0444\u0456\u0433\u0443\u0440\u0430\u0446\u0456\u0457",
              "Organizations":"\u041e\u0440\u0433\u0430\u043d\u0456\u0437\u0430\u0446\u0456\u0457","Indexing":"\u0406\u043d\u0434\u0435\u043a\u0441\u0430\u0446\u0456\u044f","Help":"\u0414\u043e\u043f\u043e\u043c\u043e\u0433\u0430","Log in":"\u0423\u0432\u0456\u0439\u0442\u0438",
              "Autocomplete":"\u0410\u0432\u0442\u043e\u0434\u043e\u043f\u043e\u0432\u043d\u0435\u043d\u043d\u044f","Auto":"\u0410\u0432\u0442\u043e","User Settings":"\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f \u043a\u043e\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430",
              "Screen width too small":"\u0428\u0438\u0440\u0438\u043d\u0430 \u0435\u043a\u0440\u0430\u043d\u0443 \u0437\u0430\u043d\u0430\u0434\u0442\u043e \u043c\u0430\u043b\u0430","Experimental":"Експериментальне","Show Experimental Settings":"Експериментальні налаштування","Add Current File by Default":"Додавати поточний файл","Enable experimental tools":"Увімкнути експериментальні інструменти","Only use system message tools":"Лише системні інструменти","Stream after tool rejection":"Продовжити після відхилення","Multiline Autocompletions":"Багаторядкове автодоповнення","Local Config":"Локальна конфігурація","Config rules":"Правила конфігурації","Show Session Tabs":"Вкладки сесій","Wrap Codeblocks":"Перенос коду","Show Chat Scrollbar":"Смуга прокрутки чату","Text-to-Speech Output":"Озвучування відповідей","Enable Session Titles":"Заголовки сесій","Format Markdown":"Форматування Markdown"},
            "tr":{"Chat":"Sohbet","Agent":"Ajan","Shadow":"G\u00f6lge",
              "Select Mode":"Mod","Select Model":"Model",
              "Council":"Konsey","BVC":"BVC",
              "Attach Image":"Resim","Attach Context":"Ba\u011flam",
              "Send (\u23ce)":"G\u00f6nder (\u23ce)","Enter":"Giri\u015f","Retry":"Tekrarla","Edit":"D\u00fczenle","Cancel":"\u0130ptal","Delete":"Sil","Confirm":"Onayla",
              "Apply Code":"Uygula","Copy Code":"Kopyala","Create File with Code":"Dosya olu\u015ftur",
              "Insert Code":"Ekle","Copy into terminal":"Terminale kopyala",
              "Open in browser":"Taray\u0131c\u0131da a\u00e7","Save Chat as Markdown":"Markdown olarak kaydet",
              "Delete item?":"Silinsin mi?","Enable Shadow Mode?":"G\u00f6lge modu etkinle\u015ftirilsin mi?","Enable Shadow Mode":"G\u00f6lge modu",
              "Show":"G\u00f6ster","Hide":"Gizle","Collapse":"Daralt","Expand":"Geni\u015flet",
              "Zoom In":"Yak\u0131nla\u015ft\u0131r","Zoom Out":"Uzakla\u015ft\u0131r","Reset Zoom":"Yak\u0131nla\u015ft\u0131rmay\u0131 s\u0131f\u0131rla",
              "No active file":"Aktif dosya yok","Active file":"Aktif dosya",
              "Disable model reasoning":"Ak\u0131l y\u00fcr\u00fctmeyi kapat","Enable model reasoning":"Ak\u0131l y\u00fcr\u00fctmeyi a\u00e7",
              "Search...":"Ara...","Search past sessions":"Oturumlar\u0131 ara",
              "Edit selected code":"Kodu d\u00fczenle",
              "All tools disabled":"T\u00fcm ara\u00e7lar devre d\u0131\u015f\u0131","All tools available":"T\u00fcm ara\u00e7lar kullan\u0131labilir",
              "Esc to exit Edit":"Esc ile \u00e7\u0131k",
              "Back":"Geri","Models":"Modeller","Rules":"Kurallar","Tools":"Ara\u00e7lar","Configs":"Yap\u0131land\u0131rmalar",
              "Organizations":"Organizasyonlar","Indexing":"Dizinleme","Help":"Yard\u0131m","Log in":"Giri\u015f yap",
              "Autocomplete":"Otomatik tamamlama","Auto":"Oto","User Settings":"Kullan\u0131c\u0131 Ayarlar\u0131",
              "Screen width too small":"Ekran geni\u015fli\u011fi \u00e7ok k\u00fc\u00e7\u00fck","Experimental":"Deneysel","Show Experimental Settings":"Deneysel Ayarlar","Add Current File by Default":"Mevcut dosyayı varsayılan ekle","Enable experimental tools":"Deneysel araçları etkinleştir","Only use system message tools":"Yalnızca sistem araçları","Stream after tool rejection":"Araç reddi sonrası akış","Multiline Autocompletions":"Çok satırlı tamamlama","Local Config":"Yerel Yapılandırma","Config rules":"Yapılandırma kuralları","Show Session Tabs":"Oturum Sekmeleri","Wrap Codeblocks":"Kod satır kaydırma","Show Chat Scrollbar":"Sohbet kaydırma çubuğu","Text-to-Speech Output":"Sesli çıktı","Enable Session Titles":"Oturum başlıkları","Format Markdown":"Markdown biçimlendirme"},
            "pt-br":{"Chat":"Chat","Agent":"Agente","Shadow":"Sombra",
              "Select Mode":"Modo","Select Model":"Modelo",
              "Council":"Conselho","BVC":"BVC",
              "Attach Image":"Imagem","Attach Context":"Contexto",
              "Send (\u23ce)":"Enviar (\u23ce)","Enter":"Enter","Retry":"Tentar novamente","Edit":"Editar","Cancel":"Cancelar","Delete":"Excluir","Confirm":"Confirmar",
              "Apply Code":"Aplicar","Copy Code":"Copiar","Create File with Code":"Criar arquivo",
              "Insert Code":"Inserir","Copy into terminal":"Copiar para terminal",
              "Open in browser":"Abrir no navegador","Save Chat as Markdown":"Salvar como Markdown",
              "Delete item?":"Excluir?","Enable Shadow Mode?":"Ativar modo Sombra?","Enable Shadow Mode":"Modo Sombra",
              "Show":"Mostrar","Hide":"Ocultar","Collapse":"Recolher","Expand":"Expandir",
              "Zoom In":"Ampliar","Zoom Out":"Reduzir","Reset Zoom":"Redefinir zoom",
              "No active file":"Nenhum arquivo ativo","Active file":"Arquivo ativo",
              "Disable model reasoning":"Desativar racioc\u00ednio","Enable model reasoning":"Ativar racioc\u00ednio",
              "Search...":"Pesquisar...","Search past sessions":"Pesquisar sess\u00f5es",
              "Edit selected code":"Editar c\u00f3digo",
              "All tools disabled":"Ferramentas desativadas","All tools available":"Ferramentas dispon\u00edveis",
              "Esc to exit Edit":"Esc para sair",
              "Back":"Voltar","Models":"Modelos","Rules":"Regras","Tools":"Ferramentas","Configs":"Configura\u00e7\u00f5es",
              "Organizations":"Organiza\u00e7\u00f5es","Indexing":"Indexa\u00e7\u00e3o","Help":"Ajuda","Log in":"Entrar",
              "Autocomplete":"Autocompletar","Auto":"Auto","User Settings":"Configura\u00e7\u00f5es do usu\u00e1rio",
              "Screen width too small":"Tela muito estreita","Experimental":"Experimental","Show Experimental Settings":"Configurações experimentais","Add Current File by Default":"Adicionar arquivo atual por padrão","Enable experimental tools":"Ativar ferramentas experimentais","Only use system message tools":"Apenas ferramentas de sistema","Stream after tool rejection":"Continuar após rejeição","Multiline Autocompletions":"Autocompletar multilinha","Local Config":"Config local","Config rules":"Regras de config","Show Session Tabs":"Abas de sessão","Wrap Codeblocks":"Quebrar linhas de código","Show Chat Scrollbar":"Barra de rolagem do chat","Text-to-Speech Output":"Saída de voz","Enable Session Titles":"Títulos de sessão","Format Markdown":"Formatar Markdown"},
            "pt":{"Chat":"Chat","Agent":"Agente","Shadow":"Sombra",
              "Select Mode":"Modo","Select Model":"Modelo",
              "Council":"Conselho","BVC":"BVC",
              "Attach Image":"Imagem","Attach Context":"Contexto",
              "Send (\u23ce)":"Enviar (\u23ce)","Enter":"Enter","Retry":"Tentar novamente","Edit":"Editar","Cancel":"Cancelar","Delete":"Eliminar","Confirm":"Confirmar",
              "Apply Code":"Aplicar","Copy Code":"Copiar","Create File with Code":"Criar ficheiro",
              "Insert Code":"Inserir","Copy into terminal":"Copiar para terminal",
              "Open in browser":"Abrir no navegador","Save Chat as Markdown":"Guardar como Markdown",
              "Delete item?":"Eliminar?","Enable Shadow Mode?":"Ativar modo Sombra?","Enable Shadow Mode":"Modo Sombra",
              "Show":"Mostrar","Hide":"Ocultar","Collapse":"Recolher","Expand":"Expandir",
              "Zoom In":"Ampliar","Zoom Out":"Reduzir","Reset Zoom":"Repor zoom",
              "No active file":"Nenhum ficheiro ativo","Active file":"Ficheiro ativo",
              "Disable model reasoning":"Desativar racioc\u00ednio","Enable model reasoning":"Ativar racioc\u00ednio",
              "Search...":"Pesquisar...","Search past sessions":"Pesquisar sess\u00f5es",
              "Edit selected code":"Editar c\u00f3digo",
              "All tools disabled":"Ferramentas desativadas","All tools available":"Ferramentas dispon\u00edveis",
              "Esc to exit Edit":"Esc para sair",
              "Back":"Voltar","Models":"Modelos","Rules":"Regras","Tools":"Ferramentas","Configs":"Configura\u00e7\u00f5es",
              "Organizations":"Organiza\u00e7\u00f5es","Indexing":"Indexa\u00e7\u00e3o","Help":"Ajuda","Log in":"Entrar",
              "Autocomplete":"Autocompletar","Auto":"Auto","User Settings":"Defini\u00e7\u00f5es do utilizador",
              "Screen width too small":"Ecr\u00e3 demasiado estreito","Experimental":"Experimental","Show Experimental Settings":"Definições experimentais","Add Current File by Default":"Adicionar ficheiro atual","Enable experimental tools":"Ativar ferramentas experimentais","Only use system message tools":"Apenas ferramentas de sistema","Stream after tool rejection":"Continuar após rejeição","Multiline Autocompletions":"Autocompletar multilinha","Local Config":"Config local","Config rules":"Regras de config","Show Session Tabs":"Separadores de sessão","Wrap Codeblocks":"Quebrar linhas de código","Show Chat Scrollbar":"Barra de deslocação do chat","Text-to-Speech Output":"Saída de voz","Enable Session Titles":"Títulos de sessão","Format Markdown":"Formatar Markdown"},
            "pl":{"Chat":"Czat","Agent":"Agent","Shadow":"Cie\u0144",
              "Select Mode":"Tryb","Select Model":"Model",
              "Council":"Rada","BVC":"BVC",
              "Attach Image":"Obraz","Attach Context":"Kontekst",
              "Send (\u23ce)":"Wy\u015blij (\u23ce)","Enter":"Enter","Retry":"Pon\u00f3w","Edit":"Edytuj","Cancel":"Anuluj","Delete":"Usu\u0144","Confirm":"Potwierd\u017a",
              "Apply Code":"Zastosuj","Copy Code":"Kopiuj","Create File with Code":"Utw\u00f3rz plik",
              "Insert Code":"Wstaw","Copy into terminal":"Kopiuj do terminala",
              "Open in browser":"Otw\u00f3rz w przegl\u0105darce","Save Chat as Markdown":"Zapisz jako Markdown",
              "Delete item?":"Usun\u0105\u0107?","Enable Shadow Mode?":"W\u0142\u0105czy\u0107 tryb Cie\u0144?","Enable Shadow Mode":"Tryb Cie\u0144",
              "Show":"Poka\u017c","Hide":"Ukryj","Collapse":"Zwi\u0144","Expand":"Rozwi\u0144",
              "Zoom In":"Powi\u0119ksz","Zoom Out":"Pomniejsz","Reset Zoom":"Resetuj zoom",
              "No active file":"Brak aktywnego pliku","Active file":"Aktywny plik",
              "Disable model reasoning":"Wy\u0142\u0105cz rozumowanie","Enable model reasoning":"W\u0142\u0105cz rozumowanie",
              "Search...":"Szukaj...","Search past sessions":"Szukaj sesji",
              "Edit selected code":"Edytuj kod",
              "All tools disabled":"Narz\u0119dzia wy\u0142\u0105czone","All tools available":"Narz\u0119dzia dost\u0119pne",
              "Esc to exit Edit":"Esc aby wyj\u015b\u0107",
              "Back":"Wstecz","Models":"Modele","Rules":"Regu\u0142y","Tools":"Narz\u0119dzia","Configs":"Konfiguracje",
              "Organizations":"Organizacje","Indexing":"Indeksowanie","Help":"Pomoc","Log in":"Zaloguj si\u0119",
              "Autocomplete":"Autouzupe\u0142nianie","Auto":"Auto","User Settings":"Ustawienia u\u017cytkownika",
              "Screen width too small":"Ekran zbyt w\u0105ski","Experimental":"Eksperymentalne","Show Experimental Settings":"Eksperymentalne ustawienia","Add Current File by Default":"Dodaj bieżący plik","Enable experimental tools":"Włącz eksperymentalne narzędzia","Only use system message tools":"Tylko narzędzia systemowe","Stream after tool rejection":"Kontynuuj po odrzuceniu","Multiline Autocompletions":"Wielowierszowe uzupełnianie","Local Config":"Konfiguracja lokalna","Config rules":"Reguły konfiguracji","Show Session Tabs":"Karty sesji","Wrap Codeblocks":"Zawijanie kodu","Show Chat Scrollbar":"Pasek przewijania czatu","Text-to-Speech Output":"Wyjście głosowe","Enable Session Titles":"Tytuły sesji","Format Markdown":"Formatuj Markdown"},
            "it":{"Chat":"Chat","Agent":"Agente","Shadow":"Ombra",
              "Select Mode":"Modalit\u00e0","Select Model":"Modello",
              "Council":"Consiglio","BVC":"BVC",
              "Attach Image":"Immagine","Attach Context":"Contesto",
              "Send (\u23ce)":"Invia (\u23ce)","Enter":"Invio","Retry":"Riprova","Edit":"Modifica","Cancel":"Annulla","Delete":"Elimina","Confirm":"Conferma",
              "Apply Code":"Applica","Copy Code":"Copia","Create File with Code":"Crea file",
              "Insert Code":"Inserisci","Copy into terminal":"Copia nel terminale",
              "Open in browser":"Apri nel browser","Save Chat as Markdown":"Salva come Markdown",
              "Delete item?":"Eliminare?","Enable Shadow Mode?":"Attivare modalit\u00e0 Ombra?","Enable Shadow Mode":"Modalit\u00e0 Ombra",
              "Show":"Mostra","Hide":"Nascondi","Collapse":"Comprimi","Expand":"Espandi",
              "Zoom In":"Ingrandisci","Zoom Out":"Riduci","Reset Zoom":"Reimposta zoom",
              "No active file":"Nessun file attivo","Active file":"File attivo",
              "Disable model reasoning":"Disattiva ragionamento","Enable model reasoning":"Attiva ragionamento",
              "Search...":"Cerca...","Search past sessions":"Cerca sessioni",
              "Edit selected code":"Modifica codice",
              "All tools disabled":"Strumenti disattivati","All tools available":"Strumenti disponibili",
              "Esc to exit Edit":"Esc per uscire",
              "Back":"Indietro","Models":"Modelli","Rules":"Regole","Tools":"Strumenti","Configs":"Configurazioni",
              "Organizations":"Organizzazioni","Indexing":"Indicizzazione","Help":"Aiuto","Log in":"Accedi",
              "Autocomplete":"Completamento automatico","Auto":"Auto","User Settings":"Impostazioni utente",
              "Screen width too small":"Schermo troppo stretto","Experimental":"Sperimentale","Show Experimental Settings":"Impostazioni sperimentali","Add Current File by Default":"Aggiungi file corrente","Enable experimental tools":"Attiva strumenti sperimentali","Only use system message tools":"Solo strumenti di sistema","Stream after tool rejection":"Continua dopo rifiuto","Multiline Autocompletions":"Completamento multilinea","Local Config":"Config locale","Config rules":"Regole di config","Show Session Tabs":"Schede sessione","Wrap Codeblocks":"A capo codice","Show Chat Scrollbar":"Barra di scorrimento chat","Text-to-Speech Output":"Output vocale","Enable Session Titles":"Titoli sessione","Format Markdown":"Formatta Markdown"},
            "cs":{"Chat":"Chat","Agent":"Agent","Shadow":"St\u00edn",
              "Select Mode":"Re\u017eim","Select Model":"Model",
              "Council":"Rada","BVC":"BVC",
              "Attach Image":"Obr\u00e1zek","Attach Context":"Kontext",
              "Send (\u23ce)":"Odeslat (\u23ce)","Enter":"Enter","Retry":"Znovu","Edit":"Upravit","Cancel":"Zru\u0161it","Delete":"Smazat","Confirm":"Potvrdit",
              "Apply Code":"Pou\u017e\u00edt","Copy Code":"Kop\u00edrovat","Create File with Code":"Vytvo\u0159it soubor",
              "Insert Code":"Vlo\u017eit","Copy into terminal":"Kop\u00edrovat do termin\u00e1lu",
              "Open in browser":"Otev\u0159\u00edt v prohl\u00ed\u017ee\u010di","Save Chat as Markdown":"Ulo\u017eit jako Markdown",
              "Delete item?":"Smazat?","Enable Shadow Mode?":"Zapnout re\u017eim St\u00edn?","Enable Shadow Mode":"Re\u017eim St\u00edn",
              "Show":"Zobrazit","Hide":"Skr\u00fdt","Collapse":"Sbalit","Expand":"Rozbalit",
              "Zoom In":"P\u0159ibl\u00ed\u017eit","Zoom Out":"Odd\u00e1lit","Reset Zoom":"Obnovit p\u0159ibl\u00ed\u017een\u00ed",
              "No active file":"\u017d\u00e1dn\u00fd aktivn\u00ed soubor","Active file":"Aktivn\u00ed soubor",
              "Disable model reasoning":"Vypnout uva\u017eov\u00e1n\u00ed","Enable model reasoning":"Zapnout uva\u017eov\u00e1n\u00ed",
              "Search...":"Hledat...","Search past sessions":"Hledat relace",
              "Edit selected code":"Upravit k\u00f3d",
              "All tools disabled":"N\u00e1stroje vypnuty","All tools available":"N\u00e1stroje dostupn\u00e9",
              "Esc to exit Edit":"Esc pro ukon\u010den\u00ed",
              "Back":"Zp\u011bt","Models":"Modely","Rules":"Pravidla","Tools":"N\u00e1stroje","Configs":"Konfigurace",
              "Organizations":"Organizace","Indexing":"Indexov\u00e1n\u00ed","Help":"N\u00e1pov\u011bda","Log in":"P\u0159ihl\u00e1sit",
              "Autocomplete":"Automatick\u00e9 dopl\u0148ov\u00e1n\u00ed","Auto":"Auto","User Settings":"U\u017eivatelsk\u00e1 nastaven\u00ed",
              "Screen width too small":"Obrazovka je p\u0159\u00edli\u0161 \u00fazk\u00e1","Experimental":"Experimentální","Show Experimental Settings":"Experimentální nastavení","Add Current File by Default":"Přidat aktuální soubor","Enable experimental tools":"Povolit experimentální nástroje","Only use system message tools":"Pouze systémové nástroje","Stream after tool rejection":"Pokračovat po odmítnutí","Multiline Autocompletions":"Víceřádkové doplňování","Local Config":"Místní konfigurace","Config rules":"Pravidla konfigurace","Show Session Tabs":"Záložky relací","Wrap Codeblocks":"Zalamování kódu","Show Chat Scrollbar":"Posuvník chatu","Text-to-Speech Output":"Hlasový výstup","Enable Session Titles":"Názvy relací","Format Markdown":"Formátovat Markdown"},
            "hu":{"Chat":"Chat","Agent":"\u00dcgyn\u00f6k","Shadow":"\u00c1rny\u00e9k",
              "Select Mode":"M\u00f3d","Select Model":"Modell",
              "Council":"Tan\u00e1cs","BVC":"BVC",
              "Attach Image":"K\u00e9p","Attach Context":"Kontextus",
              "Send (\u23ce)":"K\u00fcld\u00e9s (\u23ce)","Enter":"Enter","Retry":"\u00dajra","Edit":"Szerkeszt\u00e9s","Cancel":"M\u00e9gse","Delete":"T\u00f6rl\u00e9s","Confirm":"Meger\u0151s\u00edt\u00e9s",
              "Apply Code":"Alkalmaz\u00e1s","Copy Code":"M\u00e1sol\u00e1s","Create File with Code":"F\u00e1jl l\u00e9trehoz\u00e1sa",
              "Insert Code":"Besz\u00far\u00e1s","Copy into terminal":"M\u00e1sol\u00e1s termin\u00e1lba",
              "Open in browser":"Megnyit\u00e1s b\u00f6ng\u00e9sz\u0151ben","Save Chat as Markdown":"Ment\u00e9s Markdownk\u00e9nt",
              "Delete item?":"T\u00f6rl\u00e9s?","Enable Shadow Mode?":"\u00c1rny\u00e9k m\u00f3d aktiv\u00e1l\u00e1sa?","Enable Shadow Mode":"\u00c1rny\u00e9k m\u00f3d",
              "Show":"Mutat","Hide":"Elrejt","Collapse":"\u00d6sszecsuk","Expand":"Kinyit",
              "Zoom In":"Nagy\u00edt\u00e1s","Zoom Out":"Kicsiny\u00edt\u00e9s","Reset Zoom":"Zoom vissza\u00e1ll\u00edt\u00e1sa",
              "No active file":"Nincs akt\u00edv f\u00e1jl","Active file":"Akt\u00edv f\u00e1jl",
              "Disable model reasoning":"Gondolkod\u00e1s ki","Enable model reasoning":"Gondolkod\u00e1s be",
              "Search...":"Keres\u00e9s...","Search past sessions":"Munkamenetek keres\u00e9se",
              "Edit selected code":"K\u00f3d szerkeszt\u00e9se",
              "All tools disabled":"Eszk\u00f6z\u00f6k kikapcsolva","All tools available":"Eszk\u00f6z\u00f6k el\u00e9rhet\u0151ek",
              "Esc to exit Edit":"Esc a kil\u00e9p\u00e9shez",
              "Back":"Vissza","Models":"Modellek","Rules":"Szab\u00e1lyok","Tools":"Eszk\u00f6z\u00f6k","Configs":"Konfigur\u00e1ci\u00f3k",
              "Organizations":"Szervezetek","Indexing":"Indexel\u00e9s","Help":"S\u00fag\u00f3","Log in":"Bel\u00e9p\u00e9s",
              "Autocomplete":"Automatikus kieg\u00e9sz\u00edt\u00e9s","Auto":"Auto","User Settings":"Felhaszn\u00e1l\u00f3i be\u00e1ll\u00edt\u00e1sok",
              "Screen width too small":"A k\u00e9perny\u0151 t\u00fal sz\u0171k","Experimental":"Kísérleti","Show Experimental Settings":"Kísérleti beállítások","Add Current File by Default":"Jelenlegi fájl hozzáadása","Enable experimental tools":"Kísérleti eszközök engedélyezése","Only use system message tools":"Csak rendszereszközök","Stream after tool rejection":"Folytatás elutasítás után","Multiline Autocompletions":"Többsoros kiegészítés","Local Config":"Helyi konfiguráció","Config rules":"Konfigurációs szabályok","Show Session Tabs":"Munkamenet fülek","Wrap Codeblocks":"Kód tördelése","Show Chat Scrollbar":"Chat görgetősáv","Text-to-Speech Output":"Hangkimenet","Enable Session Titles":"Munkamenet címek","Format Markdown":"Markdown formázás"}
          };
          var T={"zh":{
            "Ask anything, '@' to add context":"\u8bf7\u63d0\u95ee\uff0c'@' \u6dfb\u52a0\u4e0a\u4e0b\u6587",
            "Ask a follow-up":"\u8ffd\u95ee","New Session":"\u65b0\u4f1a\u8bdd",
            "No models configured":"\u672a\u914d\u7f6e\u6a21\u578b","No models":"\u65e0\u6a21\u578b",
            "Select model":"\u9009\u62e9\u6a21\u578b","Loading models...":"\u52a0\u8f7d\u6a21\u578b\u4e2d...",
            "Loading config":"\u52a0\u8f7d\u914d\u7f6e\u4e2d","Loading...":"\u52a0\u8f7d\u4e2d...",
            "Loading":"\u52a0\u8f7d","Thinking":"\u601d\u8003\u4e2d...","Settings":"\u8bbe\u7f6e",
            "Clear chats":"\u6e05\u9664\u804a\u5929","Send":"\u53d1\u9001","Stop":"\u505c\u6b62","History":"\u5386\u53f2"
          },"ru":{
            "Ask anything, '@' to add context":"\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u0447\u0442\u043e \u0443\u0433\u043e\u0434\u043d\u043e, '@' \u0434\u043b\u044f \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0430",
            "Ask a follow-up":"\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0443\u0442\u043e\u0447\u043d\u044f\u044e\u0449\u0438\u0439 \u0432\u043e\u043f\u0440\u043e\u0441","New Session":"\u041d\u043e\u0432\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f",
            "No models configured":"\u041c\u043e\u0434\u0435\u043b\u0438 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u044b","No models":"\u041d\u0435\u0442 \u043c\u043e\u0434\u0435\u043b\u0435\u0439",
            "Select model":"\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043c\u043e\u0434\u0435\u043b\u044c","Loading models...":"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043c\u043e\u0434\u0435\u043b\u0435\u0439...",
            "Loading config":"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438","Loading...":"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...",
            "Loading":"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430","Thinking":"\u0414\u0443\u043c\u0430\u044e...","Settings":"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438",
            "Clear chats":"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0447\u0430\u0442\u044b","Send":"\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c","Stop":"\u0421\u0442\u043e\u043f","History":"\u0418\u0441\u0442\u043e\u0440\u0438\u044f"
          },"de":{
            "Ask anything, '@' to add context":"Fragen Sie etwas, '@' f\u00fcr Kontext",
            "Ask a follow-up":"Folgefrage stellen","New Session":"Neue Sitzung",
            "No models configured":"Keine Modelle konfiguriert","No models":"Keine Modelle",
            "Select model":"Modell ausw\u00e4hlen","Loading models...":"Modelle werden geladen...",
            "Loading config":"Konfiguration wird geladen","Loading...":"Wird geladen...",
            "Loading":"Laden","Thinking":"Denke nach...","Settings":"Einstellungen",
            "Clear chats":"Chats l\u00f6schen","Send":"Senden","Stop":"Stopp","History":"Verlauf"
          },"fr":{
            "Ask anything, '@' to add context":"Posez une question, '@' pour le contexte",
            "Ask a follow-up":"Posez une question compl\u00e9mentaire","New Session":"Nouvelle session",
            "No models configured":"Aucun mod\u00e8le configur\u00e9","No models":"Aucun mod\u00e8le",
            "Select model":"Choisir le mod\u00e8le","Loading models...":"Chargement des mod\u00e8les...",
            "Loading config":"Chargement de la configuration","Loading...":"Chargement...",
            "Loading":"Chargement","Thinking":"R\u00e9flexion...","Settings":"Param\u00e8tres",
            "Clear chats":"Effacer les chats","Send":"Envoyer","Stop":"Arr\u00eater","History":"Historique"
          },"es":{
            "Ask anything, '@' to add context":"Pregunte lo que sea, '@' para contexto",
            "Ask a follow-up":"Haga una pregunta adicional","New Session":"Nueva sesi\u00f3n",
            "No models configured":"No hay modelos configurados","No models":"Sin modelos",
            "Select model":"Seleccionar modelo","Loading models...":"Cargando modelos...",
            "Loading config":"Cargando configuraci\u00f3n","Loading...":"Cargando...",
            "Loading":"Cargando","Thinking":"Pensando...","Settings":"Configuraci\u00f3n",
            "Clear chats":"Borrar chats","Send":"Enviar","Stop":"Detener","History":"Historial"
          },"zh-cn":{
            "Ask anything, '@' to add context":"\u8bf7\u63d0\u95ee\uff0c'@' \u6dfb\u52a0\u4e0a\u4e0b\u6587",
            "Ask a follow-up":"\u8ffd\u95ee","New Session":"\u65b0\u4f1a\u8bdd",
            "No models configured":"\u672a\u914d\u7f6e\u6a21\u578b","No models":"\u65e0\u6a21\u578b",
            "Select model":"\u9009\u62e9\u6a21\u578b","Loading models...":"\u52a0\u8f7d\u6a21\u578b\u4e2d...",
            "Loading config":"\u52a0\u8f7d\u914d\u7f6e\u4e2d","Loading...":"\u52a0\u8f7d\u4e2d...",
            "Loading":"\u52a0\u8f7d","Thinking":"\u601d\u8003\u4e2d...","Settings":"\u8bbe\u7f6e",
            "Clear chats":"\u6e05\u9664\u804a\u5929","Send":"\u53d1\u9001","Stop":"\u505c\u6b62","History":"\u5386\u53f2"
          },"zh-tw":{
            "Ask anything, '@' to add context":"\u8acb\u63d0\u554f\uff0c'@' \u65b0\u589e\u4e0a\u4e0b\u6587",
            "Ask a follow-up":"\u8ffd\u554f","New Session":"\u65b0\u5c0d\u8a71",
            "No models configured":"\u672a\u8a2d\u5b9a\u6a21\u578b","No models":"\u7121\u6a21\u578b",
            "Select model":"\u9078\u64c7\u6a21\u578b","Loading models...":"\u8f09\u5165\u6a21\u578b\u4e2d...",
            "Loading config":"\u8f09\u5165\u8a2d\u5b9a\u4e2d","Loading...":"\u8f09\u5165\u4e2d...",
            "Loading":"\u8f09\u5165","Thinking":"\u601d\u8003\u4e2d...","Settings":"\u8a2d\u5b9a",
            "Clear chats":"\u6e05\u9664\u804a\u5929","Send":"\u50b3\u9001","Stop":"\u505c\u6b62","History":"\u6b77\u53f2"
          },"ja":{
            "Ask anything, '@' to add context":"\u4f55\u3067\u3082\u805e\u3044\u3066\u304f\u3060\u3055\u3044\u3002'@'\u3067\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8\u8ffd\u52a0",
            "Ask a follow-up":"\u30d5\u30a9\u30ed\u30fc\u30a2\u30c3\u30d7\u8cea\u554f","New Session":"\u65b0\u3057\u3044\u30bb\u30c3\u30b7\u30e7\u30f3",
            "No models configured":"\u30e2\u30c7\u30eb\u672a\u8a2d\u5b9a","No models":"\u30e2\u30c7\u30eb\u306a\u3057",
            "Select model":"\u30e2\u30c7\u30eb\u3092\u9078\u629e","Loading models...":"\u30e2\u30c7\u30eb\u8aad\u307f\u8fbc\u307f\u4e2d...",
            "Loading config":"\u8a2d\u5b9a\u8aad\u307f\u8fbc\u307f\u4e2d","Loading...":"\u8aad\u307f\u8fbc\u307f\u4e2d...",
            "Loading":"\u8aad\u307f\u8fbc\u307f","Thinking":"\u8003\u3048\u4e2d...","Settings":"\u8a2d\u5b9a",
            "Clear chats":"\u30c1\u30e3\u30c3\u30c8\u3092\u6d88\u53bb","Send":"\u9001\u4fe1","Stop":"\u505c\u6b62","History":"\u5c65\u6b74"
          },"ko":{
            "Ask anything, '@' to add context":"\ubb34\uc5c7\uc774\ub4e0 \ubb3c\uc5b4\ubcf4\uc138\uc694. '@'\ub85c \ucee8\ud14d\uc2a4\ud2b8 \ucd94\uac00",
            "Ask a follow-up":"\ud6c4\uc18d \uc9c8\ubb38","New Session":"\uc0c8 \uc138\uc158",
            "No models configured":"\uad6c\uc131\ub41c \ubaa8\ub378 \uc5c6\uc74c","No models":"\ubaa8\ub378 \uc5c6\uc74c",
            "Select model":"\ubaa8\ub378 \uc120\ud0dd","Loading models...":"\ubaa8\ub378 \ub85c\ub529 \uc911...",
            "Loading config":"\uad6c\uc131 \ub85c\ub529 \uc911","Loading...":"\ub85c\ub529 \uc911...",
            "Loading":"\ub85c\ub529","Thinking":"\uc0dd\uac01 \uc911...","Settings":"\uc124\uc815",
            "Clear chats":"\ucc44\ud305 \uc0ad\uc81c","Send":"\ubcf4\ub0b4\uae30","Stop":"\uc911\uc9c0","History":"\uae30\ub85d"
          },"uk":{
            "Ask anything, '@' to add context":"\u0417\u0430\u043f\u0438\u0442\u0430\u0439\u0442\u0435 \u0431\u0443\u0434\u044c-\u0449\u043e, '@' \u0434\u043b\u044f \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0443",
            "Ask a follow-up":"\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0443\u0442\u043e\u0447\u043d\u044e\u044e\u0447\u0435 \u043f\u0438\u0442\u0430\u043d\u043d\u044f","New Session":"\u041d\u043e\u0432\u0430 \u0441\u0435\u0441\u0456\u044f",
            "No models configured":"\u041c\u043e\u0434\u0435\u043b\u0456 \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u0456","No models":"\u041d\u0435\u043c\u0430\u0454 \u043c\u043e\u0434\u0435\u043b\u0435\u0439",
            "Select model":"\u041e\u0431\u0440\u0430\u0442\u0438 \u043c\u043e\u0434\u0435\u043b\u044c","Loading models...":"\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u043c\u043e\u0434\u0435\u043b\u0435\u0439...",
            "Loading config":"\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u043a\u043e\u043d\u0444\u0456\u0433\u0443\u0440\u0430\u0446\u0456\u0457","Loading...":"\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f...",
            "Loading":"\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f","Thinking":"\u0414\u0443\u043c\u0430\u044e...","Settings":"\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f",
            "Clear chats":"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u0438 \u0447\u0430\u0442\u0438","Send":"\u041d\u0430\u0434\u0456\u0441\u043b\u0430\u0442\u0438","Stop":"\u0417\u0443\u043f\u0438\u043d\u0438\u0442\u0438","History":"\u0406\u0441\u0442\u043e\u0440\u0456\u044f"
          },"tr":{
            "Ask anything, '@' to add context":"Bir \u015fey sorun, '@' ile ba\u011flam ekleyin",
            "Ask a follow-up":"Takip sorusu sorun","New Session":"Yeni Oturum",
            "No models configured":"Yap\u0131land\u0131r\u0131lm\u0131\u015f model yok","No models":"Model yok",
            "Select model":"Model se\u00e7in","Loading models...":"Modeller y\u00fckleniyor...",
            "Loading config":"Yap\u0131land\u0131rma y\u00fckleniyor","Loading...":"Y\u00fckleniyor...",
            "Loading":"Y\u00fckleniyor","Thinking":"D\u00fc\u015f\u00fcn\u00fcyor...","Settings":"Ayarlar",
            "Clear chats":"Sohbetleri temizle","Send":"G\u00f6nder","Stop":"Durdur","History":"Ge\u00e7mi\u015f"
          },"pt-br":{
            "Ask anything, '@' to add context":"Pergunte qualquer coisa, '@' para contexto",
            "Ask a follow-up":"Fa\u00e7a uma pergunta complementar","New Session":"Nova Sess\u00e3o",
            "No models configured":"Nenhum modelo configurado","No models":"Sem modelos",
            "Select model":"Selecionar modelo","Loading models...":"Carregando modelos...",
            "Loading config":"Carregando configura\u00e7\u00e3o","Loading...":"Carregando...",
            "Loading":"Carregando","Thinking":"Pensando...","Settings":"Configura\u00e7\u00f5es",
            "Clear chats":"Limpar chats","Send":"Enviar","Stop":"Parar","History":"Hist\u00f3rico"
          },"pt":{
            "Ask anything, '@' to add context":"Pergunte qualquer coisa, '@' para contexto",
            "Ask a follow-up":"Fa\u00e7a uma pergunta complementar","New Session":"Nova Sess\u00e3o",
            "No models configured":"Nenhum modelo configurado","No models":"Sem modelos",
            "Select model":"Selecionar modelo","Loading models...":"Carregando modelos...",
            "Loading config":"Carregando configura\u00e7\u00e3o","Loading...":"Carregando...",
            "Loading":"Carregando","Thinking":"Pensando...","Settings":"Configura\u00e7\u00f5es",
            "Clear chats":"Limpar chats","Send":"Enviar","Stop":"Parar","History":"Hist\u00f3rico"
          },"pl":{
            "Ask anything, '@' to add context":"Zapytaj o cokolwiek, '@' aby doda\u0107 kontekst",
            "Ask a follow-up":"Zadaj pytanie uzupe\u0142niaj\u0105ce","New Session":"Nowa sesja",
            "No models configured":"Brak skonfigurowanych modeli","No models":"Brak modeli",
            "Select model":"Wybierz model","Loading models...":"\u0141adowanie modeli...",
            "Loading config":"\u0141adowanie konfiguracji","Loading...":"\u0141adowanie...",
            "Loading":"\u0141adowanie","Thinking":"My\u015bl\u0119...","Settings":"Ustawienia",
            "Clear chats":"Wyczy\u015b\u0107 czaty","Send":"Wy\u015blij","Stop":"Zatrzymaj","History":"Historia"
          },"it":{
            "Ask anything, '@' to add context":"Chiedi qualsiasi cosa, '@' per aggiungere contesto",
            "Ask a follow-up":"Fai una domanda di approfondimento","New Session":"Nuova sessione",
            "No models configured":"Nessun modello configurato","No models":"Nessun modello",
            "Select model":"Seleziona modello","Loading models...":"Caricamento modelli...",
            "Loading config":"Caricamento configurazione","Loading...":"Caricamento...",
            "Loading":"Caricamento","Thinking":"Sto pensando...","Settings":"Impostazioni",
            "Clear chats":"Cancella chat","Send":"Invia","Stop":"Ferma","History":"Cronologia"
          },"cs":{
            "Ask anything, '@' to add context":"Zeptejte se na cokoliv, '@' pro kontext",
            "Ask a follow-up":"Polo\u017ete dopl\u0148uj\u00edc\u00ed ot\u00e1zku","New Session":"Nov\u00e1 relace",
            "No models configured":"\u017d\u00e1dn\u00e9 modely nejsou nakonfigurov\u00e1ny","No models":"\u017d\u00e1dn\u00e9 modely",
            "Select model":"Vybrat model","Loading models...":"Na\u010d\u00edt\u00e1n\u00ed model\u016f...",
            "Loading config":"Na\u010d\u00edt\u00e1n\u00ed konfigurace","Loading...":"Na\u010d\u00edt\u00e1n\u00ed...",
            "Loading":"Na\u010d\u00edt\u00e1n\u00ed","Thinking":"P\u0159em\u00fd\u0161l\u00edm...","Settings":"Nastaven\u00ed",
            "Clear chats":"Smazat chaty","Send":"Odeslat","Stop":"Zastavit","History":"Historie"
          },"hu":{
            "Ask anything, '@' to add context":"K\u00e9rdezzen b\u00e1rmit, '@' kontextus hozz\u00e1ad\u00e1s\u00e1hoz",
            "Ask a follow-up":"Tegyen fel k\u00f6vet\u0151 k\u00e9rd\u00e9st","New Session":"\u00daj munkamenet",
            "No models configured":"Nincsenek be\u00e1ll\u00edtott modellek","No models":"Nincsenek modellek",
            "Select model":"Modell kiv\u00e1laszt\u00e1sa","Loading models...":"Modellek bet\u00f6lt\u00e9se...",
            "Loading config":"Konfigur\u00e1ci\u00f3 bet\u00f6lt\u00e9se","Loading...":"Bet\u00f6lt\u00e9s...",
            "Loading":"Bet\u00f6lt\u00e9s","Thinking":"Gondolkodom...","Settings":"Be\u00e1ll\u00edt\u00e1sok",
            "Clear chats":"Cseveg\u00e9sek t\u00f6rl\u00e9se","Send":"K\u00fcld\u00e9s","Stop":"Le\u00e1ll\u00edt\u00e1s","History":"El\u0151zm\u00e9nyek"
          }};
          // Merge extra translations into base table
          for(var lang in T){if(TR[lang]){for(var s in TR[lang])T[lang][s]=TR[lang][s];}}
          // Add extra translations for languages only in TR
          for(var lang2 in TR){if(!T[lang2])T[lang2]=TR[lang2];}
          var dict=T[L]||T[L.split("-")[0]]||null;if(!dict){var base=L.split("-")[0];for(var k in T){if(k.split("-")[0]===base){dict=T[k];break;}}}if(!dict)return;
          var keys=Object.keys(dict);
          function norm(s){return (s||"").replace(/\s+/g," ").trim();}
          var lmap={};for(var ki=0;ki<keys.length;ki++)lmap[norm(keys[ki]).toLowerCase()]=dict[keys[ki]];
          function tv(raw){var t=norm(raw);return dict[t]||lmap[t.toLowerCase()]||null;}
          function ta(node,name){var raw=node.getAttribute&&node.getAttribute(name);var v=raw&&tv(raw);if(v&&v!==raw)node.setAttribute(name,v);}
          function tr(node){
            if(node.nodeType===3){var raw=node.textContent;var v=raw&&tv(raw);if(v&&v!==norm(raw)&&node.textContent!==v){node.textContent=v;return;}}
            if(node.nodeType===1){
              ta(node,"placeholder");
              ta(node,"title");
              ta(node,"aria-label");
              ta(node,"data-tooltip-content");
              ta(node,"content");
            }
          }
          function walk(root){var tw=document.createTreeWalker(root,5);while(tw.nextNode())tr(tw.currentNode);}
          var obs=new MutationObserver(function(muts){for(var m of muts){for(var n of m.addedNodes){if(n.nodeType===1)walk(n);if(n.nodeType===3)tr(n);}if(m.type==="characterData")tr(m.target);if(m.type==="attributes"&&m.target.nodeType===1)tr(m.target);}});
          document.addEventListener("DOMContentLoaded",function(){
            walk(document.body);
            obs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["placeholder","title","aria-label","data-tooltip-content","content"]});
            setInterval(function(){walk(document.body);},2000);
          });
        })();
        </script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}
