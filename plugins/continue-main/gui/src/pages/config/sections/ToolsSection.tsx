import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import { useMemo } from "react";
import Alert from "../../../components/gui/Alert";
import { Card, EmptyState } from "../../../components/ui";
import { useAppSelector } from "../../../redux/hooks";
import { RUNTIME_CONFIGURABLE_TOOL_NAMES } from "../../../util/xynapseRuntimeTools";
import { ConfigHeader } from "../components/ConfigHeader";
import { ToolPoliciesGroup } from "../components/ToolPoliciesGroup";

export function ToolsSection() {
  const availableTools = useAppSelector((state) => state.config.config.tools);
  const mode = useAppSelector((store) => store.session.mode);

  const duplicateDetection = useMemo(() => {
    const counts: Record<string, number> = {};
    availableTools
      .filter((tool) =>
        RUNTIME_CONFIGURABLE_TOOL_NAMES.includes(tool.function.name),
      )
      .forEach((tool) => {
        counts[tool.function.name] = (counts[tool.function.name] ?? 0) + 1;
      });

    return Object.fromEntries(
      Object.entries(counts).map(([name, count]) => [name, count > 1]),
    );
  }, [availableTools]);

  const hasRuntimeTools = availableTools.some((tool) =>
    RUNTIME_CONFIGURABLE_TOOL_NAMES.includes(tool.function.name),
  );

  const availableToolsMessage =
    mode === "chat"
      ? "Chat mode answers without runtime tools. Plan, Edit, and Full pass the enabled tools below into Core."
      : "Enabled tools are sent to Core as allowedTools for the current runtime mode.";

  return (
    <>
      <ConfigHeader
        title="Tools"
        subtext="Control which Core runtime tools are allowed in Plan, Edit, and Full mode."
        className="mb-2"
      />

      <div className="mb-4">
        <Alert type="info" size="sm">
          <span className="text-2xs italic">{availableToolsMessage}</span>
        </Alert>
      </div>

      {hasRuntimeTools ? (
        <ToolPoliciesGroup
          showIcon={false}
          groupName={BUILT_IN_GROUP_NAME}
          displayName="Xynapse Core Tools"
          allToolsOff={false}
          duplicateDetection={duplicateDetection}
          toolNames={RUNTIME_CONFIGURABLE_TOOL_NAMES}
        />
      ) : (
        <Card>
          <EmptyState message="No Core runtime tools are available in the current config." />
        </Card>
      )}
    </>
  );
}
