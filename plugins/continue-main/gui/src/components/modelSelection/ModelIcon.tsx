import { CubeIcon } from "@heroicons/react/24/outline";
import { getModelIcon } from "core/util/modelIcon";
import { useState } from "react";

export function ModelIcon({
  model,
  provider,
  className = "h-4 w-4 flex-shrink-0",
}: {
  model?: string;
  provider?: string;
  className?: string;
}) {
  const icon = getModelIcon(model, provider);
  const [failedIcon, setFailedIcon] = useState<string>();
  if (!icon || icon === failedIcon)
    return <CubeIcon className={className} aria-hidden="true" />;
  return (
    <img
      src={`${window.vscMediaUrl ?? ""}/logos/${icon}`}
      alt=""
      aria-hidden="true"
      className={`${className} rounded-sm object-contain`}
      style={{ backgroundColor: icon === "openai.png" ? "#242424" : "#ffffff" }}
      onError={() => setFailedIcon(icon)}
    />
  );
}
