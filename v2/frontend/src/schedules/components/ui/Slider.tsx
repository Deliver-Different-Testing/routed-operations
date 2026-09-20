import { forwardRef, type InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  /** Current value(s) of the slider */
  value: number[];
  /** Callback when value changes */
  onValueChange: (value: number[]) => void;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step size */
  step?: number;
}

export type { SliderProps };

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ value, onValueChange, min = 0, max = 100, step = 1, className = '', ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value);
      onValueChange([newValue]);
    };

    const currentValue = value[0] || min;
    const percentage = ((currentValue - min) / (max - min)) * 100;

    return (
      <div className={`relative ${className}`} data-testid="slider">
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          className="w-full h-2 bg-surface-dark rounded-lg appearance-none cursor-pointer slider-thumb"
          style={{
            background: `linear-gradient(to right, var(--color-brand-cyan) 0%, var(--color-brand-cyan) ${percentage}%, var(--color-surface-dark) ${percentage}%, var(--color-surface-dark) 100%)`
          }}
          {...props}
        />
        <style>{`
          .slider-thumb::-webkit-slider-thumb {
            appearance: none;
            height: 20px;
            width: 20px;
            border-radius: 50%;
            background: var(--color-brand-cyan);
            cursor: pointer;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
          .slider-thumb::-moz-range-thumb {
            height: 20px;
            width: 20px;
            border-radius: 50%;
            background: var(--color-brand-cyan);
            cursor: pointer;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
        `}</style>
      </div>
    );
  }
);

Slider.displayName = 'Slider';