import { FolderIcon } from "@heroicons/react/24/outline";
import { ConversationStarterCards } from "../../components/ConversationStarters";
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
    return (
      <div className="mx-2 mt-6 flex flex-col items-center gap-3 text-center opacity-70">
        <FolderIcon className="h-10 w-10" />
        <div>
          <p className="text-base font-medium">Откройте папку проекта</p>
          <p className="mt-1 text-xs opacity-60">
            File &rarr; Open Folder
          </p>
        </div>
      </div>
    );
  }

  if (showOnboardingCard) {
    return (
      <div className="mx-2 mt-6">
        <OnboardingCard />
      </div>
    );
  }

  return (
    <div className="mx-2 mt-2">
      <ConversationStarterCards />
    </div>
  );
}
