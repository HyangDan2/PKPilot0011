import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, defaultValue = 0, format, onChange, hint }: SliderProps) {
  const filled = ((value - min) / (max - min)) * 100;
  const showReset = Math.abs(value - defaultValue) > 1e-6;
  return (
    <div className="slider">
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        <span className="slider-value">
          {format ? format(value) : Math.round(value)}
          {showReset && (
            <button type="button" className="slider-reset" onClick={() => onChange(defaultValue)} aria-label={`${label} 초기화`}>
              ↺
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ['--fill' as string]: `${filled}%` }}
      />
      {hint && <p className="slider-hint">{hint}</p>}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  compact?: boolean;
}

export function Segmented<T extends string>({ label, value, options, onChange, compact }: SegmentedProps<T>) {
  return (
    <div className={`segmented${compact ? ' compact' : ''}`}>
      {label && <span className="segmented-label">{label}</span>}
      <div className="segmented-track" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'on' : ''}
            disabled={option.disabled}
            title={option.title}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, hint, disabled }: ToggleProps) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden><span /></span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
