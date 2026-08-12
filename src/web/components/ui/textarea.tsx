import * as React from "react";
import { cn } from "../../lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full resize-y rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant",
        "focus:outline-none focus:border-primary focus:bg-surface-container-lowest focus:ring-4 focus:ring-primary/12",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
