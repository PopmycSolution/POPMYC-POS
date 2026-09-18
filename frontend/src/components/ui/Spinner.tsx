import { forwardRef, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type Variant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: Size;
  variant?: Variant;
  label?: string;
}

const sizeClasses: Record<Size, string> = {
  xs: 'h-3 w-3 border-2',
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-3',
  xl: 'h-12 w-12 border-4',
};

const variantClasses: Record<Variant, string> = {
  default: 'border-muted-200 border-t-muted-700',
  primary: 'border-primary-200 border-t-primary-600',
  secondary: 'border-secondary-200 border-t-secondary-600',
  success: 'border-success-200 border-t-success-600',
  warning: 'border-warning-200 border-t-warning-500',
  danger: 'border-danger-200 border-t-danger-600',
};

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  (
    {
      size = 'md',
      variant = 'primary',
      label,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        role="status"
        className={clsx('inline-flex items-center gap-2', className)}
        {...props}
      >
        <div
          className={clsx(
            'animate-spin rounded-full',
            sizeClasses[size],
            variantClasses[variant]
          )}
        />
        {label && (
          <span className="text-sm text-muted-600">{label}</span>
        )}
        <span className="sr-only">Loading...</span>
      </div>
    );
  }
);

Spinner.displayName = 'Spinner';

export default Spinner;
