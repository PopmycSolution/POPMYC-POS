import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
} from 'lucide-react';

type Variant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  title?: string;
  children: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  showIcon?: boolean;
}

const variantClasses: Record<Variant, { container: string; icon: string }> = {
  info: {
    container: 'bg-primary-50 text-primary-800 border-primary-200',
    icon: 'text-primary-600',
  },
  success: {
    container: 'bg-success-50 text-success-800 border-success-200',
    icon: 'text-success-600',
  },
  warning: {
    container: 'bg-warning-50 text-warning-800 border-warning-200',
    icon: 'text-warning-600',
  },
  error: {
    container: 'bg-danger-50 text-danger-800 border-danger-200',
    icon: 'text-danger-600',
  },
};

const icons: Record<Variant, ReactNode> = {
  info: <Info className="h-5 w-5 shrink-0" />,
  success: <CheckCircle2 className="h-5 w-5 shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 shrink-0" />,
  error: <XCircle className="h-5 w-5 shrink-0" />,
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      variant = 'info',
      title,
      children,
      dismissible = false,
      onDismiss,
      showIcon = true,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        role="alert"
        className={clsx(
          'relative flex w-full rounded-lg border p-4 text-sm',
          variantClasses[variant].container,
          className
        )}
        {...props}
      >
        {showIcon && (
          <div className={clsx('mr-3 mt-0.5', variantClasses[variant].icon)}>
            {icons[variant]}
          </div>
        )}
        <div className="flex-1">
          {title && (
            <h5 className="mb-1 font-semibold leading-none">{title}</h5>
          )}
          <div className="leading-relaxed">{children}</div>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onDismiss}
            className={clsx(
              'ml-4 shrink-0 rounded-md p-1 transition-colors hover:bg-white/50',
              'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white/50'
            )}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);

Alert.displayName = 'Alert';

export default Alert;
