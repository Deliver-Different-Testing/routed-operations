// 24-hour Hour:Minute picker that emits "HH:mm" (or "" when cleared).
//
// Replaces the native <input type="time">, whose AM/PM segment is a silent trap:
// when a user fills hour+minute but leaves AM/PM blank, the control's value is
// "" (an incomplete time isn't valid), so an optional field saves null without
// any warning. Two explicit selects in 24-hour form remove AM/PM entirely and
// can never produce a half-entered time; picking either part auto-completes the
// other to "00", and a value only clears when both go back to blank.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_STEP = 5;

function minuteOptions(current: string): string[] {
  const base = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP).padStart(2, '0'));
  if (current && !base.includes(current)) return [...base, current].sort();
  return base;
}

// pr-7 leaves room for the native select's disclosure arrow; without it the
// arrow overlaps the "HH" / "MM" digits (bug reported 2026-08-12).
const cls = 'border border-border rounded-lg pl-2 pr-7 py-2 text-sm bg-white focus:ring-2 focus:ring-brand-cyan focus:outline-none';

export function TimeField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
}) {
  const [hh, mm] = value.includes(':') ? value.split(':') : ['', ''];

  const apply = (h: string, m: string) => {
    if (!h && !m) { onChange(''); return; }
    onChange(`${h || '00'}:${m || '00'}`);
  };

  return (
    <div className="flex items-center gap-1.5" aria-label={ariaLabel}>
      <select value={hh} onChange={(e) => apply(e.target.value, mm)} className={cls} aria-label={ariaLabel ? `${ariaLabel} hour` : 'Hour'}>
        <option value="">HH</option>
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-text-secondary">:</span>
      <select value={mm} onChange={(e) => apply(hh, e.target.value)} className={cls} aria-label={ariaLabel ? `${ariaLabel} minute` : 'Minute'}>
        <option value="">MM</option>
        {minuteOptions(mm).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <span className="text-[11px] text-text-secondary ml-0.5">24h</span>
    </div>
  );
}
