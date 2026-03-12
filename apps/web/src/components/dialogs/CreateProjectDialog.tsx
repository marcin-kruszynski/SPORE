import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Label } from "../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { Checkbox } from "../ui/checkbox.js";
import { spaces, workflows, teams } from "../../data/mock-data.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Add Project</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Connect a repository to SPORE for managed orchestration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Project Name</Label>
            <Input placeholder="e.g. spore-orchestrator" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Repository URL</Label>
            <Input placeholder="github.com/org/repo" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea placeholder="Brief description of the project..." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Space</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Assign to space" /></SelectTrigger>
                <SelectContent>
                  {spaces.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default Workflow</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Select workflow" /></SelectTrigger>
                <SelectContent>
                  {workflows.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assign Teams</Label>
            <div className="rounded-md border border-border p-3 space-y-2">
              {teams.map(t => (
                <div key={t.id} className="flex items-center gap-2">
                  <Checkbox id={`team-${t.id}`} />
                  <Label htmlFor={`team-${t.id}`} className="text-xs text-foreground cursor-pointer">{t.name}</Label>
                  <span className="text-[10px] text-muted-foreground ml-auto">{t.agentIds.length} agents</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">Add Project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
