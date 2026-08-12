import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-label-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_.material-symbols-outlined]:text-[20px]",
  {
    variants: {
      variant: {
        primary:
          "rounded-full bg-gradient-to-r from-primary to-primary-bright text-on-primary shadow-lg shadow-primary/20 hover:brightness-105 hover:shadow-primary/30",
        container: "rounded-full bg-primary-container text-on-primary-container hover:brightness-105",
        ghost: "rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary",
        outline: "rounded-full border border-outline-variant text-primary hover:bg-surface-container-low",
        icon: "rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-primary",
      },
      size: {
        default: "h-12 px-6",
        sm: "h-9 px-4 text-xs",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
