interface ProgressBarProps {
  /** 0–100 */
  value: number;
  error?: boolean;
  label?: string;
}

export function ProgressBar({ value, error = false, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={error ? 'progress progress--error' : 'progress'}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress__fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}
