import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Label } from "../ui/label.js";
import { Checkbox } from "../ui/checkbox.js";
import { agents, projects } from "../../data/mock-data.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTeamDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Create Team</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Teams are groups of agents assigned to work on projects together.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Team Name</Label>
            <Input placeholder="e.g. Core Engineering" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Purpose</Label>
            <Textarea placeholder="Describe the team's responsibilities and focus areas..." rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assign Agents</Label>
            <div className="rounded-md border border-border p-3 space-y-2 max-h-40 overflow-y-auto">
              {agents.map(a => (
                <div key={a.id} className="flex items-center gap-2">
                  <Checkbox id={`agent-${a.id}`} />
                  <Label htmlFor={`agent-${a.id}`} className="text-xs text-foreground cursor-pointer">{a.name}</Label>
                  <span className="text-[10px] text-muted-foreground ml-auto">{a.skillIds.length} skills · {a.toolIds.length} tools</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assign to Projects</Label>
            <div className="rounded-md border border-border p-3 space-y-2 max-h-40 overflow-y-auto">
              {projects.map(p => (
                <div key={p.id} className="flex items-center gap-2">
                  <Checkbox id={`proj-${p.id}`} />
                  <Label htmlFor={`proj-${p.id}`} className="text-xs text-foreground cursor-pointer">{p.name}</Label>
                  <span className="text-[10px] text-muted-foreground ml-auto">{p.spaceName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">Create Team</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
