import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { ErrorBoundary } from "react-error-boundary";
import { PersistGate } from "redux-persist/integration/react";
import App from "./App";
import "./index.css";
import { persistor, store } from "./redux/store";

declare const vscode:
  | {
      postMessage: (message: unknown) => void;
    }
  | undefined;

const fallbackText = {
  title: "Open a project folder",
  subtitle: "Choose a folder to initialize the Xynapse workspace.",
  action: "Open folder",
  retry: "Retry",
};
function postOpenFolder() {
  if (typeof vscode === "undefined") {
    return;
  }

  vscode?.postMessage({
    messageType: "openFolder",
    data: undefined,
    messageId: `boot-fallback-open-folder-${Date.now()}`,
  });
}

function getFallbackText() {
  return fallbackText;
}

function BootFallback({
  error,
  retry,
}: {
  error?: Error;
  retry?: () => void;
}) {
  const text = getFallbackText();
  const hasWorkspace = ((window as any).workspacePaths?.length ?? 0) > 0;

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        color: "var(--vscode-editor-foreground)",
        background: "var(--vscode-editor-background)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid var(--vscode-widget-border, rgba(255,255,255,.16))",
          borderRadius: 14,
          padding: 24,
          textAlign: "center",
          background: "var(--vscode-sideBar-background)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 650, marginBottom: 8 }}>
          {hasWorkspace && error ? "Xynapse failed to load" : text.title}
        </div>
        <div style={{ opacity: 0.72, marginBottom: 18 }}>
          {error?.message || text.subtitle}
        </div>
        {!hasWorkspace && (
          <button
            type="button"
            onClick={postOpenFolder}
            style={{
              width: "100%",
              border: 0,
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "pointer",
              fontWeight: 650,
              color: "var(--vscode-button-foreground)",
              background: "var(--vscode-button-background)",
            }}
          >
            {text.action}
          </button>
        )}
        {retry && (
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 10,
              width: "100%",
              border: "1px solid var(--vscode-button-border, transparent)",
              borderRadius: 8,
              padding: "9px 14px",
              cursor: "pointer",
              fontWeight: 650,
              color: "var(--vscode-button-secondaryForeground)",
              background: "var(--vscode-button-secondaryBackground)",
            }}
          >
            {text.retry}
          </button>
        )}
      </div>
    </div>
  );
}

(async () => {
  const container = document.getElementById("root") as HTMLElement;

  // Create React root
  const root = ReactDOM.createRoot(container);

  root.render(
    <React.StrictMode>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <BootFallback error={error} retry={resetErrorBoundary} />
        )}
      >
        <Provider store={store}>
          <PersistGate loading={<BootFallback />} persistor={persistor}>
            <App />
          </PersistGate>
        </Provider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
})();
