import { useState } from "react";
import { Paperclip, Send } from "lucide-react";

import { Button } from "../ui/button.js";

interface MessageComposerProps {
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  onSend: (message: string) => Promise<unknown>;
}

export function MessageComposer({ disabled = false, pending = false, error = null, onSend }: MessageComposerProps) {
  const [message, setMessage] = useState("");

  async function handleSend() {
    const nextMessage = message.trim();
    if (!nextMessage || disabled || pending) {
      return;
    }

    await onSend(nextMessage);
    setMessage("");
  }

  return (
    <div className="border-t border-border bg-card/80 p-4">
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" disabled>
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message the orchestrator..."
          rows={1}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          disabled={disabled || pending || message.trim().length === 0}
          onClick={() => {
            void handleSend();
          }}
          className="h-8 w-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
