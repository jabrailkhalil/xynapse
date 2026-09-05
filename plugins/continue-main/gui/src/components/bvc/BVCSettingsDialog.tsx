import { useState } from "react";
import { Button } from "../ui";

export interface BVCParams {
  tauVote: number;
  tauCrit: number;
  tauCovBase: number;
  kMax: number;
  bRes: number;
}

const DEFAULTS: BVCParams = {
  tauVote: 0.3,
  tauCrit: 0.7,
  tauCovBase: 0.5,
  kMax: 2,
  bRes: 2,
};

const STORAGE_KEY = "bvc-settings";

export function loadBVCParams(): BVCParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

function saveBVCParams(params: BVCParams) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
}

interface ParamRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  isInteger?: boolean;
}

function ParamRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  isInteger,
}: ParamRowProps) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between">
        <label className="text-foreground text-2xs font-medium">{label}</label>
        <span className="text-description text-2xs font-mono">
          {isInteger ? value : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="accent-primary mt-0.5 h-1 w-full cursor-pointer"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="text-description-muted mt-0.5 text-[9px] leading-tight">
        {hint}
      </p>
    </div>
  );
}

interface BVCSettingsDialogProps {
  onClose: () => void;
}

function BVCSettingsDialog({ onClose }: BVCSettingsDialogProps) {
  const [params, setParams] = useState<BVCParams>(loadBVCParams);

  const update = (key: keyof BVCParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveBVCParams(params);
    onClose();
  };

  const handleReset = () => {
    setParams({ ...DEFAULTS });
  };

  return (
    <div className="flex flex-col overflow-hidden p-4 pt-2">
      <h2 className="text-foreground mb-3 text-center text-sm font-semibold uppercase tracking-widest">
        BVC Settings
      </h2>

      <ParamRow
        label="τ_vote — Voting Threshold"
        hint="Enter critique if D_vote exceeds this value"
        value={params.tauVote}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update("tauVote", v)}
      />

      <ParamRow
        label="τ_crit — Critical Threshold"
        hint="Fail if D_vote still exceeds this after all critique rounds"
        value={params.tauCrit}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update("tauCrit", v)}
      />

      <ParamRow
        label="τ_cov — Coverage Base"
        hint="Base coverage threshold (adapts with agent count)"
        value={params.tauCovBase}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => update("tauCovBase", v)}
      />

      <ParamRow
        label="K_max — Max Critique Rounds"
        hint="Maximum number of cross-critique rounds"
        value={params.kMax}
        min={0}
        max={5}
        step={1}
        onChange={(v) => update("kMax", v)}
        isInteger
      />

      <ParamRow
        label="B_res — Budget Reserve"
        hint="Reserved LLM calls for synthesis + overhead"
        value={params.bRes}
        min={1}
        max={10}
        step={1}
        onChange={(v) => update("bRes", v)}
        isInteger
      />

      {/* Actions */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={handleReset}>
          Reset
        </Button>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default BVCSettingsDialog;
