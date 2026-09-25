/**
 * StepWizard - horizontal step indicator strip.
 *
 * Ported from Configurator (components/common/StepWizard.tsx) with a few
 * RoutedOperations-flavoured tweaks:
 *   - Optional onStepClick prop so completed steps can be clicked to
 *     jump back for review. Forward jumping past incomplete steps is
 *     always disabled by the parent (it just does not pass onStepClick,
 *     or ignores the callback).
 *   - Aria-current="step" on the active segment for screen-readers.
 *   - Plain-text checkmark ("v") instead of a unicode tick so the
 *     component renders identically across every terminal / logging
 *     surface the RoutedOperations team screenshots into.
 *
 * `current` is 1-based to match the numbered circles.
 */
interface Props {
  steps: string[];
  current: number;
  onStepClick?: (index: number) => void; // 1-based
}

export default function StepWizard({ steps, current, onStepClick }: Props) {
  return (
    <div className="flex gap-0" role="list" aria-label="Import steps">
      {steps.map((step, i) => {
        const num = i + 1;
        const isActive = current === num;
        const isDone = current > num;
        const clickable = !!onStepClick && isDone;

        const segmentClass = [
          'flex-1 text-center py-2.5 text-xs sm:text-sm border-b-2 transition-colors',
          isActive ? 'text-brand-cyan border-brand-cyan font-semibold' :
          isDone ? 'text-success border-success' :
          'text-text-muted border-border',
          clickable ? 'cursor-pointer hover:bg-surface-cream' : 'cursor-default',
        ].join(' ');

        const circleClass = [
          'inline-block w-6 h-6 rounded-full leading-6 text-[11px] mr-1.5 font-semibold',
          isActive ? 'bg-brand-cyan text-brand-dark' :
          isDone ? 'bg-success text-white' :
          'bg-border text-text-muted',
        ].join(' ');

        return (
          <button
            key={step}
            type="button"
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
            aria-label={`Step ${num}: ${step}${isDone ? ' (completed)' : isActive ? ' (current)' : ''}`}
            disabled={!clickable && !isActive}
            onClick={clickable ? () => onStepClick!(num) : undefined}
            className={segmentClass}
          >
            <span className={circleClass}>
              {isDone ? 'v' : num}
            </span>
            {step}
          </button>
        );
      })}
    </div>
  );
}
