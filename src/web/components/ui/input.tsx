import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-lg border border-outline-variant bg-surface-container-low px-4 text-sm text-on-surface placeholder:text-on-surface-variant",
        "focus:outline-none focus:border-primary focus:bg-surface-container-lowest focus:ring-4 focus:ring-primary/12",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
