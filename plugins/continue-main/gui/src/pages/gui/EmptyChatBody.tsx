import { XynapseModeTabs } from "../../components/claw/ClawSidecarCard";
import type { XynapseMode } from "../../components/claw/ClawSidecarCard";
import { OnboardingCard } from "../../components/OnboardingCard";

export interface EmptyChatBodyProps {
  showOnboardingCard?: boolean;
  noWorkspace?: boolean;
  xynapseMode?: XynapseMode;
  onXynapseModeChange?: (mode: XynapseMode) => void;
}

export function EmptyChatBody({
  showOnboardingCard,
  noWorkspace,
  xynapseMode,
  onXynapseModeChange,
}: EmptyChatBodyProps) {
  if (noWorkspace) {
    return (
      <div className="mx-2 mt-5 space-y-4">
        <XynapseModeTabs
          mode={xynapseMode}
          onModeChange={onXynapseModeChange}
          showOpenFolderAction
        />
      </div>
    );
  }

  if (showOnboardingCard) {
    return (
      <div className="mx-2 mt-6 space-y-4">
        <OnboardingCard />
        <XynapseModeTabs
          mode={xynapseMode}
          onModeChange={onXynapseModeChange}
        />
      </div>
    );
  }

  return (
    <div className="mx-2 mt-2 space-y-4">
      <XynapseModeTabs
        mode={xynapseMode}
        onModeChange={onXynapseModeChange}
      />
    </div>
  );
}
