// TCC's UI kit. Thin, accessible wrappers over the classes in styles/ui.css — pages compose these
// instead of styling elements inline, so every screen shares one look.

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, X } from 'lucide-react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'danger-outline' | 'ghost' | 'link';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  /** Keyboard shortcut shown inside the button. */
  kbd?: string;
  block?: boolean;
  iconOnly?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, kbd, block, iconOnly, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', variant !== 'secondary' && `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', iconOnly && 'btn--icon', className)}
      {...rest}
    >
      {icon}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

export function Badge({ tone = 'neutral', dot, outline, children, title }: { tone?: Tone; dot?: boolean; outline?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={cx('badge', tone !== 'neutral' && `badge--${tone}`, outline && 'badge--outline')} title={title}>
      {dot && <span className="badge__dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Chip({ pressed, onClick, children, disabled, title }: { pressed: boolean; onClick?: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Card({ title, sub, actions, children, pad, className, id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; pad?: boolean; className?: string; id?: string }) {
  return (
    <section className={cx('card', className)} id={id}>
      {(title || actions) && (
        <header className="card__head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card__title">{title}</h2>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {pad === false ? children : <div className="card__body">{children}</div>}
    </section>
  );
}

export function Callout({ tone, icon, children }: { tone?: Exclude<Tone, 'neutral'>; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={cx('callout', tone && `callout--${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
      {icon}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'danger' ? 'var(--danger)' : tone === 'accent' ? 'var(--accent)' : undefined;
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={{ color }}>{value}</span>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="empty__title">{title}</div>
      {children && <div style={{ maxWidth: 440 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: 'lg' | 'xl' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={cx('avatar', size && `avatar--${size}`)} aria-hidden>
      {initials || '?'}
    </span>
  );
}

export function Meter({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx('input', invalid && 'input--invalid', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('select', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', className)} {...rest} />;
}

export function Toggle({ checked, onChange, label, disabled, help }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; help?: ReactNode }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id} style={{ alignItems: help ? 'flex-start' : 'center', opacity: disabled ? 0.7 : 1 }}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden style={{ marginTop: help ? 1 : 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {help && <span className="muted" style={{ fontSize: 13 }}>{help}</span>}
      </span>
    </label>
  );
}

export function CheckBox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="check" disabled={disabled} onClick={() => onChange(!checked)}>
      {checked && <Check size={13} strokeWidth={3.25} />}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" className="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Close on Escape and keep focus inside while open. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return ref;
}

export function Sheet({
  kind = 'drawer',
  wide,
  title,
  desc,
  onClose,
  children,
  footer,
  leading,
}: {
  kind?: 'drawer' | 'dialog';
  wide?: boolean;
  title: ReactNode;
  desc?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  leading?: ReactNode;
}) {
  const ref = useModal(onClose);
  return (
    <div className={cx('overlay', kind === 'drawer' ? 'overlay--right' : 'overlay--center')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cx(kind, wide && `${kind}--wide`)}>
        <div className="sheet__head">
          {leading}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet__title">{title}</div>
            {desc && <div className="sheet__desc">{desc}</div>}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<X size={16} />} />
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHead({ title, desc, actions, eyebrow }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page__head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>{eyebrow}</div>}
        <h1 className="page__title">{title}</h1>
        {desc && <p className="page__desc">{desc}</p>}
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
  );
}
