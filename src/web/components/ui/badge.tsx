import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize whitespace-nowrap [&_.material-symbols-outlined]:text-[14px]",
  {
    variants: {
      variant: {
        neutral: "bg-surface-container text-on-surface-variant",
        success: "bg-success-container text-success",
        error: "bg-error-container text-error",
        running: "bg-primary/12 text-primary",
        secondary: "bg-secondary/12 text-secondary",
        tag: "bg-surface-variant text-on-surface-variant font-medium",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
