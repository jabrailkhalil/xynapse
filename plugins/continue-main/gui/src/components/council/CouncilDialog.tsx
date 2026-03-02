import { PlusIcon } from "@heroicons/react/24/outline";
import { ModelDescription } from "core";
import { useMemo, useState } from "react";
import { useAppSelector } from "../../redux/hooks";
import { Button } from "../ui";

export interface CouncilRoleConfig {
  name: string;
  modelTitle: string;
}

export interface CouncilConfig {
  difficulty: "easy" | "medium" | "hard";
  task: string;
  roles: CouncilRoleConfig[];
  saveDiscussion: boolean;
}

const DEFAULT_ROLES: string[] = [
  "Architect",
  "Developer",
  "Reviewer",
  "Tester",
];

const DIFFICULTY_OPTIONS = [
  { value: "easy" as const, label: "Easy (analysis only)" },
  { value: "medium" as const, label: "Medium (1 critique round)" },
  { value: "hard" as const, label: "Hard (2 critique rounds)" },
];

interface CouncilDialogProps {
  onClose: () => void;
  onSubmit: (config: CouncilConfig) => void;
}

function CouncilDialog({ onClose, onSubmit }: CouncilDialogProps) {
  const config = useAppSelector((state) => state.config.config);

  const allModels = useMemo(() => {
    const seen = new Set<string>();
    const models: ModelDescription[] = [];
    const byRole = config.modelsByRole ?? {};
    for (const roleKey of ["chat", "edit", "apply", "summarize"] as const) {
      for (const m of (byRole[roleKey] ?? []) as ModelDescription[]) {
        if (m.title && !seen.has(m.title)) {
          seen.add(m.title);
          models.push(m);
        }
      }
    }
    return models;
  }, [config.modelsByRole]);

  const defaultModelTitle = allModels[0]?.title ?? "";

  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">(
    "medium",
  );
  const [task, setTask] = useState("");
  const [roles, setRoles] = useState<CouncilRoleConfig[]>(
    DEFAULT_ROLES.map((name) => ({ name, modelTitle: defaultModelTitle })),
  );
  const [newRoleName, setNewRoleName] = useState("");
  const [saveDiscussion, setSaveDiscussion] = useState(true);

  const canRemoveRole = roles.length > 2;

  const handleAddRole = () => {
    if (newRoleName.trim()) {
      setRoles([
        ...roles,
        { name: newRoleName.trim(), modelTitle: defaultModelTitle },
      ]);
      setNewRoleName("");
    }
  };

  const handleRemoveRole = (index: number) => {
    if (!canRemoveRole) return;
    setRoles(roles.filter((_, i) => i !== index));
  };

  const handleModelChange = (index: number, modelTitle: string) => {
    const updated = [...roles];
    updated[index] = { ...updated[index], modelTitle };
    setRoles(updated);
  };

  const handleSetAllModels = (modelTitle: string) => {
    setRoles(roles.map((r) => ({ ...r, modelTitle })));
  };

  const handleSubmit = () => {
    if (!task.trim()) return;
    onSubmit({ difficulty, task: task.trim(), roles, saveDiscussion });
  };

  return (
    <div className="flex flex-col overflow-hidden p-4 pt-2">
      <h2 className="text-foreground mb-3 text-center text-sm font-semibold uppercase tracking-widest">
        Council
      </h2>

      {/* Task */}
      <div className="mb-2.5 min-w-0">
        <label className="text-description mb-1 block text-2xs uppercase tracking-wider">
          Task
        </label>
        <textarea
          className="bg-input text-input-foreground border-input-border box-border w-full max-w-full rounded border border-solid p-2 text-xs leading-relaxed placeholder:text-input-placeholder focus:border-border-focus focus:outline-none"
          rows={2}
          placeholder="Describe the task for discussion..."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              handleSubmit();
            }
          }}
        />
      </div>

      {/* Difficulty */}
      <div className="mb-2.5 min-w-0">
        <label className="text-description mb-1 block text-2xs uppercase tracking-wider">
          Discussion Depth
        </label>
        <select
          className="bg-input text-input-foreground border-input-border box-border w-full max-w-full cursor-pointer rounded border border-solid px-2 py-1.5 text-xs focus:border-border-focus focus:outline-none"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as any)}
        >
          {DIFFICULTY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Roles */}
      <div className="mb-2.5 min-w-0">
        <div className="mb-1 flex min-w-0 items-center justify-between">
          <label className="text-description text-2xs uppercase tracking-wider">
            Roles & Models
          </label>
          {allModels.length > 1 && (
            <select
              className="bg-input text-input-foreground border-input-border box-border max-w-[50%] cursor-pointer truncate rounded border border-solid px-1 py-0.5 text-2xs focus:outline-none"
              value=""
              onChange={(e) => {
                if (e.target.value) handleSetAllModels(e.target.value);
              }}
            >
              <option value="">Set all models to...</option>
              {allModels.map((m) => (
                <option key={m.title} value={m.title}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          {roles.map((role, i) => (
            <div key={i} className="flex min-w-0 items-center gap-1">
              <span
                className="text-foreground min-w-[80px] shrink-0 truncate text-2xs font-medium"
                title={role.name}
              >
                {role.name}
              </span>
              <select
                className="bg-input text-input-foreground border-input-border box-border min-w-0 flex-1 cursor-pointer rounded border border-solid px-1 py-0.5 text-2xs focus:border-border-focus focus:outline-none"
                value={role.modelTitle}
                onChange={(e) => handleModelChange(i, e.target.value)}
              >
                {allModels.map((m) => (
                  <option key={m.title} value={m.title}>
                    {m.title}
                  </option>
                ))}
                {allModels.length === 0 && (
                  <option value="">No models</option>
                )}
              </select>
              {canRemoveRole && (
                <button
                  className="ml-0.5 shrink-0 cursor-pointer border-none bg-transparent p-0 leading-none text-error opacity-50 transition-opacity duration-100 hover:opacity-100"
                  onClick={() => handleRemoveRole(i)}
                  title="Remove role"
                  style={{ fontSize: "10px", lineHeight: 1 }}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add role */}
      <div className="mb-2.5 flex min-w-0 gap-1">
        <input
          className="bg-input text-input-foreground border-input-border box-border min-w-0 flex-1 rounded border border-solid px-2 py-0.5 text-2xs placeholder:text-input-placeholder focus:border-border-focus focus:outline-none"
          placeholder="Add role..."
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddRole()}
        />
        <button
          className="text-description border-input-border bg-input flex shrink-0 items-center justify-center rounded border border-solid px-1.5 py-0.5 text-2xs transition-colors duration-100 hover:enabled:text-foreground disabled:opacity-30"
          onClick={handleAddRole}
          disabled={!newRoleName.trim()}
        >
          <PlusIcon className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Save discussion checkbox */}
      <div className="mb-3">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={saveDiscussion}
            onChange={(e) => setSaveDiscussion(e.target.checked)}
            className="accent-primary h-3 w-3 cursor-pointer"
          />
          <span className="text-description text-2xs">
            Save discussion
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <div>
          {allModels.length === 0 && (
            <span className="text-warning text-2xs">
              No models
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!task.trim() || allModels.length === 0}
          >
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CouncilDialog;
