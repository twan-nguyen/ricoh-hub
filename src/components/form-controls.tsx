import { cn } from "@/lib/utils";

/** A labelled form row: label, control, then a short hint. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="font-medium">
          {label}
        </label>
      ) : (
        <span className="font-medium">{label}</span>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One choice out of a few, as a row of toggles. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg border border-border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-md px-2.5 text-muted-foreground transition-colors duration-100 hover:text-foreground aria-checked:bg-accent aria-checked:text-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
