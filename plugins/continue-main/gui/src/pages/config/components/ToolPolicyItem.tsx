import { ToolPolicy } from "@xynapse/terminal-security";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { Tool } from "core";
import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { Tooltip } from "react-tooltip";
import { ToolTip } from "../../../components/gui/Tooltip";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../../../components/ui";
import { useFontSize } from "../../../components/ui/font";
import { useAppSelector } from "../../../redux/hooks";
import {
  addTool,
  DEFAULT_TOOL_SETTING,
  setToolPolicy,
} from "../../../redux/slices/uiSlice";
import { getRuntimeToolInfo } from "../../../util/xynapseRuntimeTools";

interface ToolPolicyItemProps {
  tool: Tool;
  duplicatesDetected: boolean;
  isGroupEnabled: boolean;
}

export function ToolPolicyItem(props: ToolPolicyItemProps) {
  const dispatch = useDispatch();
  const policy = useAppSelector(
    (state) => state.ui.toolSettings[props.tool.function.name],
  );
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!policy) {
      dispatch(addTool(props.tool));
    }
  }, [props.tool.function.name, policy]);

  const parameters = useMemo(() => {
    if (props.tool.function.parameters?.properties) {
      return Object.entries(props.tool.function.parameters.properties).map(
        ([name, schema]) =>
          [name, schema] as [string, { description: string; type: string }],
      );
    }
    return undefined;
  }, [props.tool.function.parameters]);

  const fontSize = useFontSize(-2);

  const disabled = !props.isGroupEnabled;
  const runtimeInfo = getRuntimeToolInfo(props.tool.function.name);
  const displayName =
    runtimeInfo?.runtimeName ??
    props.tool.originalFunctionName ??
    props.tool.function.name;
  const description = runtimeInfo?.description ?? props.tool.function.description;

  if (!policy) {
    return null;
  }
  const disabledTooltipId = `disabled-note-${props.tool.group}-${props.tool.displayTitle}-${props.tool.function.name}`;

  return (
    <div
      className="flex flex-col"
      style={{
        fontSize,
      }}
    >
      <div className="flex flex-col rounded px-2 py-2 hover:bg-gray-50 hover:bg-opacity-5">
        <div className="flex flex-row items-start justify-between">
          <div
            className="flex flex-1 cursor-pointer flex-row items-start gap-1.5"
            onClick={() => setIsExpanded((val) => !val)}
          >
            <ChevronRightIcon
              className={`xs:flex hidden h-3 w-3 flex-shrink-0 pt-1 transition-all duration-200 ${isExpanded ? "rotate-90" : ""}`}
            />

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                {props.duplicatesDetected ? (
                  <ToolTip
                    place="bottom"
                    className="flex flex-wrap items-center"
                    content={
                      <p className="m-0 p-0">
                        <span>Duplicate tool name</span>{" "}
                        <code>{props.tool.function.name}</code>{" "}
                        <span>
                          detected. Permissions will conflict and usage may be
                          unpredictable
                        </span>
                      </p>
                    }
                  >
                    <InformationCircleIcon className="h-3 w-3 flex-shrink-0 cursor-help text-yellow-500" />
                  </ToolTip>
                ) : null}
                {props.tool.faviconUrl && (
                  <img
                    src={props.tool.faviconUrl}
                    alt={props.tool.displayTitle}
                    className="h-3 w-3 flex-shrink-0"
                  />
                )}
                <span className="line-clamp-1 break-all text-sm">
                  {displayName}
                </span>
                {runtimeInfo && (
                  <span className="text-description-muted rounded border border-solid border-white/10 px-1.5 py-0.5 text-[10px]">
                    {runtimeInfo.modes}
                  </span>
                )}
              </div>
              <div className="text-description line-clamp-3 text-sm">
                {description}
              </div>
            </div>
          </div>

          <div className="flex w-20 justify-end sm:w-24">
            <Listbox
              value={disabled || policy === "disabled" ? "disabled" : "enabled"}
              onChange={(newPolicy) => {
                const nextPolicy =
                  newPolicy === "disabled" ? "disabled" : DEFAULT_TOOL_SETTING;
                if (!disabled && nextPolicy !== policy) {
                  dispatch(
                    setToolPolicy({
                      toolName: props.tool.function.name,
                      policy: nextPolicy as ToolPolicy,
                    }),
                  );
                }
              }}
              disabled={disabled}
            >
              <div className="relative">
                <ListboxButton
                  className={`border-command-border h-7 w-full justify-between px-3 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                  data-testid={`tool-policy-item-${props.tool.function.name}`}
                  data-tooltip-id={disabled ? disabledTooltipId : undefined}
                >
                  <span className="text-xs">
                    {disabled || policy === "disabled" ? "Excluded" : "Enabled"}
                  </span>
                  <ChevronDownIcon className="h-3 w-3" />
                </ListboxButton>
                {!disabled && (
                  <ListboxOptions className="min-w-0">
                    <ListboxOption value="enabled">Enabled</ListboxOption>
                    <ListboxOption value="disabled">Excluded</ListboxOption>
                  </ListboxOptions>
                )}
              </div>
            </Listbox>
          </div>
        </div>
        <Tooltip id={disabledTooltipId}>Group is turned off</Tooltip>
      </div>
      <div
        className={`flex flex-col overflow-hidden ${isExpanded ? "h-min" : "h-0 opacity-0"} gap-x-1 gap-y-2 pl-2 transition-all`}
      >
        <span className="text-2xs mt-1.5 font-bold">Description:</span>
        <span className="text-2xs italic">
          {description}
        </span>
        {runtimeInfo && (
          <>
            <span className="text-2xs font-bold">Core runtime:</span>
            <span className="text-2xs italic">
              Passed as <code>{runtimeInfo.runtimeName}</code> in{" "}
              {runtimeInfo.modes}.
            </span>
          </>
        )}
        {parameters && !runtimeInfo ? (
          <>
            <span className="text-2xs font-bold">Arguments:</span>
            {parameters.map((param, idx) => (
              <div key={idx} className="text-2xs block">
                <code className="">{param[0]}</code>
                <span className="ml-1">{`(${param[1].type ?? "unknown"}):`}</span>
                <span className="ml-1 italic">
                  {param[1].description ?? "No description"}
                </span>
              </div>
            ))}
          </>
        ) : null}
        <div className="h-1"></div>
      </div>
    </div>
  );
}
