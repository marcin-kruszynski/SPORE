import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Label } from "../ui/label.js";
import { Checkbox } from "../ui/checkbox.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { skills, tools, teams } from "../../data/mock-data.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Create Agent</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Agents are configurable system actors with assigned skills, tools, and guardrails.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Agent Name</Label>
            <Input placeholder="e.g. Architect" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea placeholder="Describe what this agent does and its intended purpose..." rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Base Model</Label>
            <Select>
              <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="claude-3.5">Claude 3.5 Sonnet</SelectItem>
                <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                <SelectItem value="gemini-1.5">Gemini 1.5 Pro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assign Skills</Label>
            <div className="rounded-md border border-border p-3 space-y-2 max-h-36 overflow-y-auto">
              {skills.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <Checkbox id={`skill-${s.id}`} />
                  <Label htmlFor={`skill-${s.id}`} className="text-xs text-foreground cursor-pointer">{s.name}</Label>
                  <span className="text-[10px] text-muted-foreground ml-auto">{s.category}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assign Tools</Label>
            <div className="rounded-md border border-border p-3 space-y-2 max-h-36 overflow-y-auto">
              {tools.map(t => (
                <div key={t.id} className="flex items-center gap-2">
                  <Checkbox id={`tool-${t.id}`} />
                  <Label htmlFor={`tool-${t.id}`} className="text-xs text-foreground cursor-pointer">{t.name}</Label>
                  <span className={`text-[10px] ml-auto rounded px-1.5 py-0.5 ${
                    t.riskLevel === "critical" ? "bg-destructive/15 text-destructive" :
                    t.riskLevel === "high" ? "bg-destructive/10 text-destructive" :
                    t.riskLevel === "medium" ? "bg-warning/15 text-warning" :
                    "bg-muted text-muted-foreground"
                  }`}>{t.riskLevel}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Add to Teams</Label>
            <div className="rounded-md border border-border p-3 space-y-2">
              {teams.map(t => (
                <div key={t.id} className="flex items-center gap-2">
                  <Checkbox id={`tm-${t.id}`} />
                  <Label htmlFor={`tm-${t.id}`} className="text-xs text-foreground cursor-pointer">{t.name}</Label>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Guardrails</Label>
            <Textarea placeholder="One guardrail per line, e.g.:\nMust produce design doc before code\nCannot modify production configs\nMax 500 LOC per PR" rows={3} className="font-mono text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">Create Agent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
