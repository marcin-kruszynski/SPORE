import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { Label } from "../ui/label.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSpaceDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Create Space</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Spaces are top-level containers for organizing related projects.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Space Name</Label>
            <Input placeholder="e.g. Platform Core" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea placeholder="Describe the purpose and scope of this space..." rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tags</Label>
            <Input placeholder="e.g. infrastructure, backend, critical (comma separated)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">Create Space</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
