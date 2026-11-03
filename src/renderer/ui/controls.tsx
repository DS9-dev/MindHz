import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { EvidenceLevel } from '../../shared/types';
import { fmtNum, t } from '../i18n';
import { Icon, type IconName } from './Icon';

export function Button({
  children,
  icon,
  variant,
  size,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: 'primary' | 'ghost' | 'danger' | 'danger solid';
  size?: 'sm';
}) {
  return (
    <button type="button" className={['btn', variant, size].filter(Boolean).join(' ')} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active,
  size = 18,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean; size?: number }) {
  return (
    <button type="button" className={`icon-btn${active ? ' active' : ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  color,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  color?: string;
  label: string;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ '--pct': `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { '--fill': color } : {}) } as React.CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Numeric input that commits on Enter / blur, with clamping and arrow-key steps. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  decimals = 2,
  label,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  label: string;
  id?: string;
}) {
  const [text, setText] = useState(fmtNum(value, decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtNum(value, decimals));
  }, [value, decimals]);
  const commit = (raw: string) => {
    const v = Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(v)) {
      const c = Math.min(max, Math.max(min, v));
      onChange(Number(c.toFixed(decimals)));
      setText(fmtNum(c, decimals));
    } else setText(fmtNum(value, decimals));
  };
  return (
    <div className="num">
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const nv = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * step * mult));
            onChange(Number(nv.toFixed(decimals)));
            setText(fmtNum(nv, decimals));
          }
        }}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </div>
  );
}

/** Frequency control: log-scale slider + exact numeric entry. */
export function FreqControl({
  label,
  value,
  onChange,
  min,
  max,
  color,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  color: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const toPos = (v: number) => (Math.log(Math.max(min, v) / min) / Math.log(max / min)) * 1000;
  const fromPos = (p: number) => {
    const v = min * Math.pow(max / min, p / 1000);
    return v < 10 ? Math.round(v * 100) / 100 : v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
  };
  return (
    <div className="field">
      <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {hint ? <span>{hint}</span> : null}
      </label>
      <div className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1, minWidth: 60 }}>
          <Slider label={label} value={toPos(value)} min={0} max={1000} step={1} color={color} onChange={(p) => onChange(fromPos(p))} />
        </div>
        <div style={{ width: 104 }}>
          <NumberField id={id} label={label} value={value} onChange={onChange} min={min} max={max} step={value < 20 ? 0.1 : 1} unit={t('unit.hz')} />
        </div>
      </div>
    </div>
  );
}

export function LabeledSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format,
  color,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  color?: string;
}) {
  return (
    <div className="slider-field">
      <div className="top">
        <span>{label}</span>
        <b>{format ? format(value) : `${Math.round(value * 100)}%`}</b>
      </div>
      <Slider label={label} value={value} min={min} max={max} step={step} onChange={onChange} color={color} />
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      className="select"
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const EV_LEVEL: Record<EvidenceLevel, number> = { established: 4, supported: 3, preliminary: 2, insufficient: 1, esoteric: 0 };

export function EvidenceBadge({ level, short }: { level: EvidenceLevel; short?: boolean }) {
  const label = t(`evidence.${level}`);
  if (level === 'esoteric')
    return (
      <span className="ev eso" title={short ? label : t('evidence.esoteric.long')}>
        <span className="glyph" />
        {short ? null : label}
      </span>
    );
  return (
    <span className={`ev l${EV_LEVEL[level]}`} title={short ? label : t(`evidence.${level}.long`)}>
      <span className="bars">
        <i />
        <i />
        <i />
        <i />
      </span>
      {short ? null : label}
    </span>
  );
}

export function QChip({ q, children }: { q: 'tone' | 'beat' | 'brain' | 'noise'; children: ReactNode }) {
  return (
    <span className={`chip q-${q}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

/** Small click-outside popover. */
export function Popover({
  open,
  onClose,
  children,
  down,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  down?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`popover${down ? ' down' : ''}`} role="menu">
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          {onClose ? <IconButton icon="close" label={t('common.close')} onClick={onClose} /> : null}
        </header>
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}
