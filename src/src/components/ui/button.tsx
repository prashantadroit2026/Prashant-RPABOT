import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-[transform,background-color,box-shadow,color] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
  {
    variants: {
      variant: {
        primary:
          "bg-ink text-paper shadow-card hover:bg-brass",
        brass:
          "bg-brass text-paper shadow-card hover:bg-ink",
        outline:
          "bg-paper text-ink shadow-[0_0_0_1px_rgba(28,25,22,0.12)] hover:bg-surface",
        ghost: "bg-transparent text-ink hover:bg-surface",
        danger: "bg-stop text-paper shadow-card hover:opacity-90",
        ok: "bg-ok text-paper shadow-card hover:opacity-90",
      },
      size: {
        sm: "h-9 rounded-md px-3 text-sm",
        md: "h-11 rounded-md px-4 text-sm",
        lg: "h-12 rounded-lg px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: Props) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
