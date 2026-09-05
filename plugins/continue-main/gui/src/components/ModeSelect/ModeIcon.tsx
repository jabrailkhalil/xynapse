import {
  ChatBubbleOvalLeftEllipsisIcon,
  CommandLineIcon,
  EyeSlashIcon,
} from "@heroicons/react/24/outline";
import { MessageModes } from "core";

interface ModeIconProps {
  mode: MessageModes;
  className?: string;
}

export function ModeIcon({
  mode,
  className = "xs:h-3 xs:w-3 h-3 w-3",
}: ModeIconProps) {
  switch (mode) {
    case "plan":
      return <EyeSlashIcon className={className} />;
    case "agent":
      return <CommandLineIcon className={className} />;
    case "full":
      return <CommandLineIcon className={className} />;
    case "chat":
      return <ChatBubbleOvalLeftEllipsisIcon className={className} />;
    case "background":
      return <EyeSlashIcon className={className} />;
  }
}
