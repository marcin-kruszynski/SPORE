import { useEffect, useState } from "react";

import type { CreateMissionFormValues } from "../../types/operator-chat.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";

interface Props {
  open: boolean;
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: CreateMissionFormValues) => Promise<unknown>;
}

const DEFAULT_VALUES: CreateMissionFormValues = {
  objective: "",
  projectId: "spore",
  safeMode: true,
  autoValidate: true,
  useStubRuntime: true,
};

export function CreateMissionDialog({
  open,
  pending = false,
  error = null,
  onOpenChange,
  onCreate,
}: Props) {
  const [values, setValues] = useState<CreateMissionFormValues>(DEFAULT_VALUES);

  useEffect(() => {
    if (open) {
      setValues(DEFAULT_VALUES);
    }
  }, [open]);

  async function handleCreate() {
    if (!values.objective.trim()) {
      return;
    }

    await onCreate(values);
    onOpenChange(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="create-mission-title">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl">
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h2 id="create-mission-title" className="text-base font-semibold leading-none tracking-tight">New Mission</h2>
          <p className="text-xs text-muted-foreground">
            Start a supervised operator mission against the live orchestrator APIs.
          </p>
        </div>
        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="mission-objective" className="text-xs">Mission objective</Label>
            <Textarea
              id="mission-objective"
              value={values.objective}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  objective: event.target.value,
                }))
              }
              placeholder="Describe what this mission should achieve and any important constraints..."
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mission-project-id" className="text-xs">Project ID</Label>
            <Input
              id="mission-project-id"
              value={values.projectId}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  projectId: event.target.value,
                }))
              }
              placeholder="spore"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/40 px-3 py-3">
            <ToggleRow
              label="Safe mode"
              description="Keep the mission on the governed safe path."
              checked={values.safeMode}
              onCheckedChange={(checked) =>
                setValues((current) => ({ ...current, safeMode: checked }))
              }
            />
            <ToggleRow
              label="Auto validate"
              description="Run validation automatically after approval when available."
              checked={values.autoValidate}
              onCheckedChange={(checked) =>
                setValues((current) => ({ ...current, autoValidate: checked }))
              }
            />
            <ToggleRow
              label="Use stub runtime"
              description="Start the mission in stub mode unless you explicitly need live runtime behavior."
              checked={values.useStubRuntime}
              onCheckedChange={(checked) =>
                setValues((current) => ({ ...current, useStubRuntime: checked }))
              }
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || values.objective.trim().length === 0}
            onClick={() => {
              void handleCreate();
            }}
            className="text-xs"
          >
            Start Mission
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
