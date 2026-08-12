import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-6 w-12 shrink-0 cursor-pointer rounded-full transition-colors",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-variant",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-7" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
