import { FolderOpenIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { OnboardingCard } from "../../components/OnboardingCard";
import { IdeMessengerContext } from "../../context/IdeMessenger";

export interface EmptyChatBodyProps {
  showOnboardingCard?: boolean;
  noWorkspace?: boolean;
}

export function EmptyChatBody({
  showOnboardingCard,
  noWorkspace,
}: EmptyChatBodyProps) {
  const ideMessenger = useContext(IdeMessengerContext);

  if (noWorkspace) {
    return (
      <div className="flex min-h-full items-center justify-center px-5 py-10">
        <div
          className="w-full max-w-[420px] rounded-xl border p-6 text-center shadow-lg"
          style={{
            borderColor: "var(--vscode-widget-border, rgba(255,255,255,.16))",
            background: "var(--vscode-sideBar-background)",
            color: "var(--vscode-editor-foreground)",
          }}
        >
          <FolderOpenIcon
            className="mx-auto mb-4 h-10 w-10 opacity-80"
            aria-hidden="true"
          />
          <div className="mb-2 text-lg font-semibold">
            Open a project folder
          </div>
          <div className="mb-5 text-sm opacity-75">
            Choose a folder to initialize the Xynapse workspace.
          </div>
          <button
            type="button"
            className="w-full rounded-lg border-0 px-4 py-2.5 font-semibold"
            style={{
              cursor: "pointer",
              color: "var(--vscode-button-foreground)",
              background: "var(--vscode-button-background)",
            }}
            onClick={() => ideMessenger.post("openFolder", undefined)}
          >
            Open folder
          </button>
        </div>
      </div>
    );
  }

  if (showOnboardingCard) {
    return (
      <div className="mx-2 mt-6 space-y-4">
        <OnboardingCard />
      </div>
    );
  }

  return null;
}
