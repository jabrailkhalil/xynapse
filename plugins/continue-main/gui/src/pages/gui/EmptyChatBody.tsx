import { OnboardingCard } from "../../components/OnboardingCard";

export interface EmptyChatBodyProps {
  showOnboardingCard?: boolean;
  noWorkspace?: boolean;
}

export function EmptyChatBody({
  showOnboardingCard,
  noWorkspace,
}: EmptyChatBodyProps) {
  if (noWorkspace) {
    return null;
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
