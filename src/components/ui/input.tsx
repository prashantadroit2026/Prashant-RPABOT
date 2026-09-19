import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-11 w-full rounded-md bg-surface px-3 text-sm text-ink shadow-inset outline-none transition-[box-shadow] duration-150 placeholder:text-muted focus:shadow-[inset_0_1px_2px_rgba(28,25,22,0.06),0_0_0_3px_rgba(110,71,14,0.22)]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, "h-24 py-2", className)} {...props} />;
}
