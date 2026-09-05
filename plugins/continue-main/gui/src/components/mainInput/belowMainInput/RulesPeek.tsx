import { DocumentTextIcon, GlobeAltIcon } from "@heroicons/react/24/outline";
import { RuleMetadata } from "core";
import { getRuleSourceDisplayName } from "core/llm/rules/rules-utils";
import { ComponentType, useMemo } from "react";
import ToggleDiv from "../../ToggleDiv";
import { useOpenRule } from "../Lump/useEditBlock";

interface RulesPeekProps {
  appliedRules?: RuleMetadata[];
  icon?: ComponentType<React.SVGProps<SVGSVGElement>>;
}

interface RulesPeekItemProps {
  rule: RuleMetadata;
  label: string;
}

function getRuleLabel(rule: RuleMetadata, index: number) {
  const source = getRuleSourceDisplayName(rule);
  return (
    rule.name?.trim() ||
    rule.description?.trim() ||
    (source ? `${source} ${index + 1}` : `Rule ${index + 1}`)
  );
}

function getRuleDedupeKey(rule: RuleMetadata) {
  return JSON.stringify({
    name: rule.name ?? "",
    description: rule.description ?? "",
    source: rule.source ?? "",
    sourceFile: rule.sourceFile ?? "",
    globs: rule.globs ?? "",
    alwaysApply: rule.alwaysApply ?? null,
  });
}

export function RulesPeekItem({ rule, label }: RulesPeekItemProps) {
  const isGlobal = rule.alwaysApply ?? !rule.globs;
  const openRule = useOpenRule();
  const ruleScope =
    !isGlobal && rule.globs
      ? `Pattern: ${
          typeof rule.globs === "string"
            ? rule.globs
            : Array.isArray(rule.globs)
              ? rule.globs.join(", ")
              : ""
        }`
      : undefined;

  return (
    <div
      className={`group mr-2 flex flex-col overflow-hidden rounded px-1.5 py-1 text-xs hover:bg-white/10`}
      data-testid="rules-peek-item"
      onClick={() => openRule(rule)}
    >
      <div className="flex w-full items-center">
        {isGlobal ? (
          <GlobeAltIcon className="text-description-muted mr-2 h-4 w-4 flex-shrink-0" />
        ) : (
          <DocumentTextIcon className="text-description-muted mr-2 h-4 w-4 flex-shrink-0" />
        )}

        <div className="flex min-w-0 flex-1 gap-2 text-xs">
          <div className="min-w-0 flex-1 truncate font-medium">{label}</div>

          {ruleScope ? (
            <div className="min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap text-xs text-gray-500">
              {ruleScope}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function RulesPeek({ appliedRules, icon }: RulesPeekProps) {
  const rules = useMemo(() => {
    const seen = new Set<string>();
    return (appliedRules ?? []).filter((rule) => {
      const key = getRuleDedupeKey(rule);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [appliedRules]);

  if (!rules || rules.length === 0) {
    return null;
  }

  return (
    <ToggleDiv
      icon={icon}
      title={`${rules.length} rule${rules.length > 1 ? "s" : ""}`}
      testId="rules-peek"
    >
      {rules.map((rule, idx) => (
        <RulesPeekItem
          key={`rule-${idx}`}
          rule={rule}
          label={getRuleLabel(rule, idx)}
        />
      ))}
    </ToggleDiv>
  );
}
