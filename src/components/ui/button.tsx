"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const styles: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent font-medium hover:bg-accent-strong active:translate-y-[0.5px] disabled:opacity-40",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-surface-hover active:translate-y-[0.5px] disabled:opacity-40",
  ghost: "text-ink-soft hover:bg-surface-hover hover:text-ink active:translate-y-[0.5px] disabled:opacity-40",
  danger: "bg-danger-soft text-danger border border-danger/25 hover:bg-danger/15 disabled:opacity-40",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs rounded-lg gap-1.5",
  md: "h-9 px-3.5 text-[13px] rounded-xl gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "focus-ring inline-flex items-center justify-center whitespace-nowrap transition-all duration-200",
        styles[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
