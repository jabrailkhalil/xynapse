/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "node:fs";

import { ContextMenuConfig, ILLM, ModelInstaller } from "core";
import { CompletionProvider } from "core/autocomplete/CompletionProvider";
import { ConfigHandler } from "core/config/ConfigHandler";
import { EXTENSION_NAME } from "core/control-plane/env";
import { Core } from "core/core";
import { walkDirAsync } from "core/indexing/walkDir";
import { isModelInstaller } from "core/llm";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { startLocalLemonade } from "core/util/lemonadeHelper";
import { startLocalOllama } from "core/util/ollamaHelper";
import {
  getConfigJsonPath,
  getConfigYamlPath,
  setConfigFilePermissions,
} from "core/util/paths";
import { Telemetry } from "core/util/posthog";
import * as vscode from "vscode";
import * as YAML from "yaml";

import { convertJsonToYamlConfig } from "../../../packages/config-yaml/dist";

import {
  getAutocompleteStatusBarDescription,
  getAutocompleteStatusBarTitle,
  getNextEditMenuItems,
  getStatusBarStatus,
  getStatusBarStatusFromQuickPickItemLabel,
  handleNextEditToggle,
  isNextEditToggleLabel,
  quickPickStatusText,
  setupStatusBar,
  StatusBarStatus,
} from "./autocomplete/statusBar";
import { XynapseConsoleWebviewViewProvider } from "./XynapseConsoleWebviewViewProvider";
import { XynapseGUIWebviewViewProvider } from "./XynapseGUIWebviewViewProvider";
import { processDiff } from "./diff/processDiff";
import { VerticalDiffManager } from "./diff/vertical/manager";
import EditDecorationManager from "./quickEdit/EditDecorationManager";
import { QuickEdit, QuickEditShowParams } from "./quickEdit/QuickEditQuickPick";
import {
  addCodeToContextFromRange,
  addEntireFileToContext,
  addHighlightedCodeToContext,
} from "./util/addCode";
import { Battery } from "./util/battery";
import { getMetaKeyLabel } from "./util/util";
import { openEditorAndRevealRange } from "./util/vscode";
import { VsCodeIde } from "./VsCodeIde";

let fullScreenPanel: vscode.WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("xynapse.xynapseGUIView"),
  );
}

type TelemetryCaptureParams = Parameters<typeof Telemetry.capture>;

/**
 * Helper method to add the `isCommandEvent` to all telemetry captures
 */
function captureCommandTelemetry(
  commandName: TelemetryCaptureParams[0],
  properties: TelemetryCaptureParams[1] = {},
) {
  Telemetry.capture(commandName, { isCommandEvent: true, ...properties });
}

function focusGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.reveal();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    // vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
  }
}

function hideGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.dispose();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    // vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
  }
}

function waitForSidebarReady(
  sidebar: XynapseGUIWebviewViewProvider,
  timeout: number,
  interval: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkReadyState = () => {
      if (sidebar.isReady) {
        resolve(true);
      } else if (Date.now() - startTime >= timeout) {
        resolve(false); // Timed out
      } else {
        setTimeout(checkReadyState, interval);
      }
    };

    checkReadyState();
  });
}

// Copy everything over from extension.ts
const getCommandsMap: (
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: XynapseGUIWebviewViewProvider,
  consoleView: XynapseConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) => { [command: string]: (...args: any) => any } = (
  ide,
  extensionContext,
  sidebar,
  consoleView,
  configHandler,
  verticalDiffManager,
  battery,
  quickEdit,
  core,
  editDecorationManager,
) => {
  /**
   * Streams an inline edit to the vertical diff manager.
   *
   * This function retrieves the configuration, determines the appropriate model title,
   * increments the FTC count, and then streams an edit to the
   * vertical diff manager.
   *
   * @param  promptName - The key for the prompt in the context menu configuration.
   * @param  fallbackPrompt - The prompt to use if the configured prompt is not available.
   * @param  [range] - Optional. The range to edit if provided.
   * @returns
   */
  async function streamInlineEdit(
    promptName: keyof ContextMenuConfig,
    fallbackPrompt: string,
    range?: vscode.Range,
  ) {
    const { config } = await configHandler.loadConfig();
    if (!config) {
      throw new Error("Config not loaded");
    }

    const llm =
      config.selectedModelByRole.edit ?? config.selectedModelByRole.chat;

    if (!llm) {
      throw new Error("No edit or chat model selected");
    }

    void sidebar.webviewProtocol.request("incrementFtc", undefined);

    await verticalDiffManager.streamEdit({
      input:
        config.experimental?.contextMenuPrompts?.[promptName] ?? fallbackPrompt,
      llm,
      range,
      rulesToInclude: config.rules,
      isApply: false,
    });
  }

  return {
    "xynapse.acceptDiff": async (newFileUri?: string, streamId?: string) => {
      captureCommandTelemetry("acceptDiff");
      void processDiff(
        "accept",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },

    "xynapse.rejectDiff": async (newFileUri?: string, streamId?: string) => {
      captureCommandTelemetry("rejectDiff");
      void processDiff(
        "reject",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },
    "xynapse.acceptVerticalDiffBlock": (fileUri?: string, index?: number) => {
      captureCommandTelemetry("acceptVerticalDiffBlock");
      verticalDiffManager.acceptRejectVerticalDiffBlock(true, fileUri, index);
    },
    "xynapse.rejectVerticalDiffBlock": (fileUri?: string, index?: number) => {
      captureCommandTelemetry("rejectVerticalDiffBlock");
      verticalDiffManager.acceptRejectVerticalDiffBlock(false, fileUri, index);
    },
    "xynapse.quickFix": async (
      range: vscode.Range,
      diagnosticMessage: string,
    ) => {
      captureCommandTelemetry("quickFix");

      const prompt = `Please explain the cause of this error and how to solve it: ${diagnosticMessage}`;

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    },
    // Passthrough for telemetry purposes
    "xynapse.defaultQuickAction": async (args: QuickEditShowParams) => {
      captureCommandTelemetry("defaultQuickAction");
      vscode.commands.executeCommand("xynapse.focusEdit", args);
    },
    "xynapse.customQuickActionSendToChat": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      captureCommandTelemetry("customQuickActionSendToChat");

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
    },
    "xynapse.customQuickActionStreamInlineEdit": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      captureCommandTelemetry("customQuickActionStreamInlineEdit");

      streamInlineEdit("docstring", prompt, range);
    },
    "xynapse.codebaseForceReIndex": async () => {
      core.invoke("index/forceReIndex", undefined);
    },
    "xynapse.rebuildCodebaseIndex": async () => {
      core.invoke("index/forceReIndex", { shouldClearIndexes: true });
    },
    "xynapse.docsIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: false });
    },
    "xynapse.docsReIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: true });
    },
    "xynapse.focusInput": async () => {
      const isXynapseInputFocused = await sidebar.webviewProtocol.request(
        "isXynapseInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      const historyLength = await sidebar.webviewProtocol.request(
        "getWebviewHistoryLength",
        undefined,
        false,
      );

      if (isXynapseInputFocused) {
        if (historyLength === 0) {
          hideGUI();
        } else {
          void sidebar.webviewProtocol?.request(
            "focusInputWithNewSession",
            undefined,
            false,
          );
        }
      } else {
        focusGUI();
        sidebar.webviewProtocol?.request(
          "focusInputWithNewSession",
          undefined,
          false,
        );
        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    "xynapse.focusInputWithoutClear": async () => {
      const isXynapseInputFocused = await sidebar.webviewProtocol.request(
        "isXynapseInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      if (isXynapseInputFocused) {
        hideGUI();
      } else {
        focusGUI();

        sidebar.webviewProtocol?.request(
          "focusInputWithoutClear",
          undefined,
        );

        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    // QuickEditShowParams are passed from CodeLens, temp fix
    // until we update to new params specific to Edit
    "xynapse.focusEdit": async (args?: QuickEditShowParams) => {
      captureCommandTelemetry("focusEdit");
      focusGUI();
      sidebar.webviewProtocol?.request("focusEdit", undefined);
    },
    "xynapse.exitEditMode": async () => {
      captureCommandTelemetry("exitEditMode");
      editDecorationManager.clear();
      void sidebar.webviewProtocol?.request("exitEditMode", undefined);
    },
    "xynapse.generateRule": async () => {
      captureCommandTelemetry("generateRule");
      focusGUI();
      void sidebar.webviewProtocol?.request("generateRule", undefined);
    },
    "xynapse.writeCommentsForCode": async () => {
      captureCommandTelemetry("writeCommentsForCode");

      streamInlineEdit(
        "comment",
        "Write comments for this code. Do not change anything about the code itself.",
      );
    },
    "xynapse.writeDocstringForCode": async () => {
      captureCommandTelemetry("writeDocstringForCode");

      void streamInlineEdit(
        "docstring",
        "Write a docstring for this code. Do not change anything about the code itself.",
      );
    },
    "xynapse.fixCode": async () => {
      captureCommandTelemetry("fixCode");

      streamInlineEdit(
        "fix",
        "Fix this code. If it is already 100% correct, simply rewrite the code.",
      );
    },
    "xynapse.optimizeCode": async () => {
      captureCommandTelemetry("optimizeCode");
      streamInlineEdit("optimize", "Optimize this code");
    },
    "xynapse.fixGrammar": async () => {
      captureCommandTelemetry("fixGrammar");
      streamInlineEdit(
        "fixGrammar",
        "If there are any grammar or spelling mistakes in this writing, fix them. Do not make other large changes to the writing.",
      );
    },
    "xynapse.clearConsole": async () => {
      consoleView.clearLog();
    },
    "xynapse.viewLogs": async () => {
      captureCommandTelemetry("viewLogs");
      vscode.commands.executeCommand("workbench.action.toggleDevTools");
    },
    "xynapse.debugTerminal": async () => {
      captureCommandTelemetry("debugTerminal");

      const terminalContents = await ide.getTerminalContents();

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");

      sidebar.webviewProtocol?.request("userInput", {
        input: `I got the following error, can you please help explain how to fix it?\n\n${terminalContents.trim()}`,
      });
    },
    "xynapse.hideInlineTip": () => {
      vscode.workspace
        .getConfiguration(EXTENSION_NAME)
        .update("showInlineTip", false, vscode.ConfigurationTarget.Global);
    },

    // Commands without keyboard shortcuts
    "xynapse.addModel": () => {
      captureCommandTelemetry("addModel");

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");
      sidebar.webviewProtocol?.request("addModel", undefined);
    },
    "xynapse.newSession": () => {
      sidebar.webviewProtocol?.request("newSession", undefined);
    },

    "xynapse.shareSession": async (sessionId: string | undefined) => {
      if (!sessionId) {
        sessionId = await sidebar.webviewProtocol?.request(
          "getCurrentSessionId",
          undefined,
        );
      }
      if (!sessionId) {
        void vscode.window.showErrorMessage(
          "No session ID found. Please start a new session first.",
        );
        return;
      }
      //let user select the destination folder
      const destinationFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Destination Folder",
      });
      if (!destinationFolder || destinationFolder.length === 0) {
        return;
      }

      try {
        // despite core.invoke not being async, we still need to await it, because the 'history/share' command is async
        // if not awaited, then errors will not be caught.
        await core.invoke("history/share", {
          id: sessionId,
          outputDir: destinationFolder[0].fsPath,
        });
      } catch (error) {
        const errorMessage = `Failed to save session: ${error instanceof Error ? error.message : String(error)}`;
        void vscode.window.showErrorMessage(errorMessage);
      }
    },
    "xynapse.viewHistory": () => {
      vscode.commands.executeCommand("xynapse.navigateTo", "/history", true);
    },
    "xynapse.focusXynapseSessionId": async (
      sessionId: string | undefined,
    ) => {
      if (!sessionId) {
        sessionId = await vscode.window.showInputBox({
          prompt: "Enter the Session ID",
        });
      }
      void sidebar.webviewProtocol?.request("focusXynapseSessionId", {
        sessionId,
      });
    },
    "xynapse.applyCodeFromChat": () => {
      void sidebar.webviewProtocol.request("applyCodeFromChat", undefined);
    },
    "xynapse.openConfigPage": () => {
      vscode.commands.executeCommand("xynapse.navigateTo", "/config", false);
    },
    "xynapse.selectFilesAsContext": async (
      firstUri: vscode.Uri,
      uris: vscode.Uri[],
    ) => {
      if (uris === undefined) {
        throw new Error("No files were selected");
      }

      vscode.commands.executeCommand("xynapse.xynapseGUIView.focus");

      for (const uri of uris) {
        // If it's a folder, add the entire folder contents recursively by using walkDir (to ignore ignored files)
        const isDirectory = await vscode.workspace.fs
          .stat(uri)
          ?.then((stat) => stat.type === vscode.FileType.Directory);
        if (isDirectory) {
          for await (const fileUri of walkDirAsync(uri.toString(), ide, {
            source: "vscode continue.selectFilesAsContext command",
          })) {
            await addEntireFileToContext(
              vscode.Uri.parse(fileUri),
              sidebar.webviewProtocol,
              ide.ideUtils,
            );
          }
        } else {
          await addEntireFileToContext(
            uri,
            sidebar.webviewProtocol,
            ide.ideUtils,
          );
        }
      }
    },
    "xynapse.logAutocompleteOutcome": (
      completionId: string,
      completionProvider: CompletionProvider,
    ) => {
      completionProvider.accept(completionId);
    },
    "xynapse.logNextEditOutcomeAccept": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.accept(completionId);
    },
    "xynapse.logNextEditOutcomeReject": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.reject(completionId);
    },
    "xynapse.toggleTabAutocompleteEnabled": () => {
      captureCommandTelemetry("toggleTabAutocompleteEnabled");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const enabled = config.get("enableTabAutocomplete");
      const pauseOnBattery = config.get<boolean>(
        "pauseTabAutocompleteOnBattery",
      );
      if (!pauseOnBattery || battery.isACConnected()) {
        config.update(
          "enableTabAutocomplete",
          !enabled,
          vscode.ConfigurationTarget.Global,
        );
      } else {
        if (enabled) {
          const paused = getStatusBarStatus() === StatusBarStatus.Paused;
          if (paused) {
            setupStatusBar(StatusBarStatus.Enabled);
          } else {
            config.update(
              "enableTabAutocomplete",
              false,
              vscode.ConfigurationTarget.Global,
            );
          }
        } else {
          setupStatusBar(StatusBarStatus.Paused);
          config.update(
            "enableTabAutocomplete",
            true,
            vscode.ConfigurationTarget.Global,
          );
        }
      }
    },
    "xynapse.forceAutocomplete": async () => {
      captureCommandTelemetry("forceAutocomplete");

      // 1. Explicitly hide any existing suggestion. This clears VS Code's cache for the current position.
      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      // 2. Now trigger a new one. VS Code has no cached suggestion, so it's forced to call our provider.
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },

    "xynapse.openTabAutocompleteConfigMenu": async () => {
      captureCommandTelemetry("openTabAutocompleteConfigMenu");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const quickPick = vscode.window.createQuickPick();

      const { config: xynapseConfig } = await configHandler.loadConfig();
      const autocompleteModels =
        xynapseConfig?.modelsByRole.autocomplete ?? [];
      const selected =
        xynapseConfig?.selectedModelByRole?.autocomplete?.title ?? undefined;

      // Toggle between Disabled, Paused, and Enabled
      const pauseOnBattery =
        config.get<boolean>("pauseTabAutocompleteOnBattery") &&
        !battery.isACConnected();
      const currentStatus = getStatusBarStatus();

      let targetStatus: StatusBarStatus | undefined;
      if (pauseOnBattery) {
        // Cycle from Disabled -> Paused -> Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Paused
            ? StatusBarStatus.Enabled
            : currentStatus === StatusBarStatus.Disabled
              ? StatusBarStatus.Paused
              : StatusBarStatus.Disabled;
      } else {
        // Toggle between Disabled and Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Disabled
            ? StatusBarStatus.Enabled
            : StatusBarStatus.Disabled;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      quickPick.items = [
        {
          label: "$(gear) Open settings",
        },
        {
          label: "$(comment) Open chat",
          description: getMetaKeyLabel() + " + L",
        },
        {
          label: "$(screen-full) Open full screen chat",
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + M",
        },
        {
          label: quickPickStatusText(targetStatus),
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + A",
        },
        ...getNextEditMenuItems(currentStatus, nextEditEnabled),
        {
          kind: vscode.QuickPickItemKind.Separator,
          label: "Switch model",
        },
        ...autocompleteModels.map((model) => ({
          label: getAutocompleteStatusBarTitle(selected, model),
          description: getAutocompleteStatusBarDescription(selected, model),
        })),
      ];
      quickPick.onDidAccept(() => {
        const selectedOption = quickPick.selectedItems[0].label;
        const targetStatus =
          getStatusBarStatusFromQuickPickItemLabel(selectedOption);

        if (targetStatus !== undefined) {
          setupStatusBar(targetStatus);
          config.update(
            "enableTabAutocomplete",
            targetStatus === StatusBarStatus.Enabled,
            vscode.ConfigurationTarget.Global,
          );
        } else if (isNextEditToggleLabel(selectedOption)) {
          handleNextEditToggle(selectedOption, config);
        } else if (
          autocompleteModels.some((model) => model.title === selectedOption)
        ) {
          if (core.configHandler.currentProfile?.profileDescription.id) {
            core.invoke("config/updateSelectedModel", {
              profileId:
                core.configHandler.currentProfile?.profileDescription.id,
              role: "autocomplete",
              title: selectedOption,
            });
          }
        } else if (selectedOption === "$(comment) Open chat") {
          vscode.commands.executeCommand("xynapse.focusInput");
        } else if (selectedOption === "$(screen-full) Open full screen chat") {
          vscode.commands.executeCommand("xynapse.openInNewWindow");
        } else if (selectedOption === "$(gear) Open settings") {
          vscode.commands.executeCommand("xynapse.navigateTo", "/config");
        }

        quickPick.dispose();
      });
      quickPick.show();
    },
    "xynapse.navigateTo": (path: string, toggle: boolean) => {
      sidebar.webviewProtocol?.request("navigateTo", { path, toggle });
      focusGUI();
    },
    "xynapse.startLocalOllama": () => {
      startLocalOllama(ide);
    },
    "xynapse.startLocalLemonade": () => {
      startLocalLemonade(ide);
    },
    "xynapse.installModel": async (
      modelName: string,
      llmProvider: ILLM | undefined,
    ) => {
      try {
        if (!isModelInstaller(llmProvider)) {
          const msg = llmProvider
            ? `LLM provider '${llmProvider.providerName}' does not support installing models`
            : "Missing LLM Provider";
          throw new Error(msg);
        }
        await installModelWithProgress(modelName, llmProvider);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(
          `Failed to install '${modelName}': ${message}`,
        );
      }
    },
    "xynapse.convertConfigJsonToConfigYaml": async () => {
      const configJson = fs.readFileSync(getConfigJsonPath(), "utf-8");
      const parsed = JSON.parse(configJson);
      const configYaml = convertJsonToYamlConfig(parsed);

      const configYamlPath = getConfigYamlPath();
      fs.writeFileSync(configYamlPath, YAML.stringify(configYaml));
      setConfigFilePermissions(configYamlPath);

      // Open config.yaml
      await openEditorAndRevealRange(
        vscode.Uri.file(configYamlPath),
        undefined,
        undefined,
        false,
      );

      void vscode.window
        .showInformationMessage(
          "Your config.json has been converted to the new config.yaml format. If you need to switch back to config.json, you can delete or rename config.yaml.",
          "Read the docs",
        )
        .then(async (selection) => {
          if (selection === "Read the docs") {
            await vscode.env.openExternal(
              vscode.Uri.parse("https://docs.xynapse.dev/yaml-migration"),
            );
          }
        });
    },
    "xynapse.enterEnterpriseLicenseKey": async () => {
      captureCommandTelemetry("enterEnterpriseLicenseKey");

      const licenseKey = await vscode.window.showInputBox({
        prompt: "Enter your enterprise license key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "License key",
      });

      if (!licenseKey) {
        return;
      }

      try {
        const isValid = core.invoke("mdm/setLicenseKey", {
          licenseKey,
        });

        if (isValid) {
          void vscode.window.showInformationMessage(
            "Enterprise license key successfully validated and saved. Reloading window.",
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          void vscode.window.showErrorMessage(
            "Invalid license key. Please check your license key and try again.",
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to set enterprise license key: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    "xynapse.toggleNextEditEnabled": async () => {
      captureCommandTelemetry("toggleNextEditEnabled");

      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const tabAutocompleteEnabled = config.get<boolean>(
        "enableTabAutocomplete",
      );

      if (!tabAutocompleteEnabled) {
        vscode.window.showInformationMessage(
          "Please enable tab autocomplete first to use Next Edit",
        );
        return;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      // updateNextEditState in VsCodeExtension.ts will handle the validation.
      config.update(
        "enableNextEdit",
        !nextEditEnabled,
        vscode.ConfigurationTarget.Global,
      );
    },
    "xynapse.openInNewWindow": async () => {
      focusGUI();

      const sessionId = await sidebar.webviewProtocol.request(
        "getCurrentSessionId",
        undefined,
      );
      // Check if full screen is already open by checking open tabs
      const fullScreenTab = getFullScreenTab();

      if (fullScreenTab && fullScreenPanel) {
        // Full screen open, but not focused - focus it
        fullScreenPanel.reveal();
        return;
      }

      // Clear the sidebar to prevent overwriting changes made in fullscreen
      vscode.commands.executeCommand("xynapse.newSession");

      // Full screen not open - open it
      captureCommandTelemetry("openInNewWindow");

      // Create the full screen panel
      let panel = vscode.window.createWebviewPanel(
        "xynapse.xynapseGUIView",
        "Xynapse",
        vscode.ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
        },
      );
      fullScreenPanel = panel;

      // Add content to the panel
      panel.webview.html = sidebar.getSidebarContent(
        extensionContext,
        panel,
        undefined,
        undefined,
        true,
      );

      const sessionLoader = panel.onDidChangeViewState(() => {
        vscode.commands.executeCommand("xynapse.newSession");
        if (sessionId) {
          vscode.commands.executeCommand(
            "xynapse.focusXynapseSessionId",
            sessionId,
          );
        }
        panel.reveal();
        sessionLoader.dispose();
      });

      // When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          sidebar.resetWebviewProtocolWebview();
          vscode.commands.executeCommand("xynapse.focusInput");
        },
        null,
        extensionContext.subscriptions,
      );

      vscode.commands.executeCommand("workbench.action.copyEditorToNewWindow");
      vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    },
    "xynapse.forceNextEdit": async () => {
      captureCommandTelemetry("forceNextEdit");

      // This is basically the same logic as forceAutocomplete.
      // I'm writing a new command KV pair here in case we diverge in features.

      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },
  };
};

async function installModelWithProgress(
  modelName: string,
  modelInstaller: ModelInstaller,
) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing model '${modelName}'`,
      cancellable: true,
    },
    async (windowProgress, token) => {
      let currentProgress: number = 0;
      const progressWrapper = (
        details: string,
        worked?: number,
        total?: number,
      ) => {
        let increment = 0;
        if (worked && total) {
          const progressValue = Math.round((worked / total) * 100);
          increment = progressValue - currentProgress;
          currentProgress = progressValue;
        }
        windowProgress.report({ message: details, increment });
      };
      const abortController = new AbortController();
      token.onCancellationRequested(() => {
        console.log(`Pulling ${modelName} model was cancelled`);
        abortController.abort();
      });
      await modelInstaller.installModel(
        modelName,
        abortController.signal,
        progressWrapper,
      );
    },
  );
}

export async function registerAllCommands(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: XynapseGUIWebviewViewProvider,
  consoleView: XynapseConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) {
  const existingCommands = new Set(await vscode.commands.getCommands(true));

  for (const [command, callback] of Object.entries(
    getCommandsMap(
      ide,
      extensionContext,
      sidebar,
      consoleView,
      configHandler,
      verticalDiffManager,
      battery,
      quickEdit,
      core,
      editDecorationManager,
    ),
  )) {
    if (existingCommands.has(command)) {
      continue;
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
    existingCommands.add(command);
  }
}
