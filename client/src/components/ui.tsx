import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-ripple-fg text-white hover:bg-ripple-fg/90 dark:bg-white dark:text-ripple-fg",
        accent:
          "bg-brand text-white hover:bg-brand/90 dark:text-[#0f1419] dark:font-semibold",
        outline:
          "border border-[var(--border)] bg-[var(--surface)] hover:bg-ripple-muted/10",
        ghost: "hover:bg-ripple-muted/10",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // text-base (16px) below md: iOS Safari zooms the page into any focused
        // text input under 16px — that's the "map auto-zoom" on From/To.
        "h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--fg)] placeholder:text-ripple-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
      {...props}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card
        className="w-full max-w-md p-5 shadow-[var(--shadow-card)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ripple-muted hover:bg-ripple-muted/10 hover:text-[var(--fg)]"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

/** Page wrapper: centered column with a title header, matching the mockups. */
export function PageShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="eyebrow text-brand">{title}</h1>
        {action}
      </div>
      {children}
    </div>
  );
}
