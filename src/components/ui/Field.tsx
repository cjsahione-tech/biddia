import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-bold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="tipo-pequeno mt-1 text-ink-muted">{hint}</p>}
    </div>
  );
}

const baseInputClass =
  "mt-1.5 block min-h-11 w-full rounded-tile border border-border bg-surface px-4 py-2.5 text-[15px] text-ink placeholder:text-ink-muted/70 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-focus-ring/30";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${baseInputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${baseInputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${baseInputClass} ${props.className ?? ""}`} />;
}
