import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success" | "warning";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  outline: "border-border text-foreground bg-transparent",
  destructive: "border-transparent bg-destructive/15 text-destructive",
  success: "border-transparent bg-success-bg text-success",
  warning: "border-transparent bg-warning-bg text-warning",
};

export function Badge({ className, variant = "secondary", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-tight",
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  );
}
