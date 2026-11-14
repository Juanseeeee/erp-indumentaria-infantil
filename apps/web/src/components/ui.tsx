'use client';

import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:bg-accent-hover',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }
>(function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-9 px-4 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/**
 * Recorridos guiados (components/tour.tsx): la prop `tour` marca el elemento con data-tour para que un
 * paso pueda resaltarlo. En los elementos HTML y en Button/Input/Select se usa data-tour directamente.
 */
export function LinkButton({ href, variant = 'primary', className, children, tour }: { href: string; variant?: Variant; className?: string; children: ReactNode; tour?: string }) {
  return (
    <Link href={href} data-tour={tour} className={cn('inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors', variants[variant], className)}>
      {children}
    </Link>
  );
}

const fieldBase =
  'w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, children, className, htmlFor, tour }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string; htmlFor?: string; tour?: string }) {
  return (
    <div data-tour={tour} className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ className, children, tour }: { className?: string; children: ReactNode; tour?: string }) {
  return <div data-tour={tour} className={cn('rounded-lg border border-border bg-surface', className)}>{children}</div>;
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function PageHeader({ title, description, actions, tour }: { title: string; description?: string; actions?: ReactNode; tour?: string }) {
  return (
    <div data-tour={tour} className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-2 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Ocurrió un error.';
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function Stat({ label, value, hint, tone, tour }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; tour?: string }) {
  return (
    <Card className="p-4" tour={tour}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('num mt-1 text-2xl font-semibold', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; tour?: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          data-tour={t.tour}
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
            value === t.id ? 'border-accent font-medium text-text' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Confirmación de acciones críticas: muestra el impacto y pide motivo si corresponde. */
export function ConfirmPanel({
  title,
  impact,
  requireReason,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
  reason,
  setReason,
}: {
  title: string;
  impact: ReactNode;
  requireReason?: boolean;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  reason?: string;
  setReason?: (v: string) => void;
}) {
  const reasonId = useId();
  return (
    <Card className="border-danger/40 p-4">
      <p className="font-medium">{title}</p>
      <div className="mt-2 text-sm text-muted">{impact}</div>
      {requireReason && (
        <Field label="Motivo (obligatorio)" className="mt-3" htmlFor={reasonId}>
          <Input id={reasonId} value={reason} onChange={(e) => setReason?.(e.target.value)} autoFocus />
        </Field>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" loading={loading} disabled={requireReason && (reason?.trim().length ?? 0) < 3} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
