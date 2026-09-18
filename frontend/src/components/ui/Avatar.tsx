import { forwardRef, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { User } from 'lucide-react';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type Variant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  initials?: string;
  size?: Size;
  variant?: Variant;
  fallbackIcon?: boolean;
}

const sizeClasses: Record<Size, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
  '2xl': 'h-20 w-20 text-xl',
};

const variantClasses: Record<Variant, string> = {
  default: 'bg-muted-200 text-muted-700',
  primary: 'bg-primary-100 text-primary-700',
  secondary: 'bg-secondary-100 text-secondary-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
};

const iconSizes: Record<Size, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
  '2xl': 'h-10 w-10',
};

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      src,
      alt,
      initials,
      size = 'md',
      variant = 'default',
      fallbackIcon = true,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold',
          sizeClasses[size],
          !src && variantClasses[variant],
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt || 'avatar'}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : initials ? (
          <span className="leading-none uppercase">{initials}</span>
        ) : fallbackIcon ? (
          <User className={clsx(iconSizes[size])} />
        ) : null}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';

export default Avatar;
