import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'ghost' | 'danger' | 'primary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'icon';
  children: ReactNode;
}

const variantCls: Record<Variant, string> = {
  default: 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100 border border-zinc-600',
  ghost: 'bg-transparent hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-200',
  danger: 'bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-800/50',
  primary: 'bg-blue-700 hover:bg-blue-600 text-white border border-blue-600',
};

const sizeCls: Record<string, string> = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
  icon: 'text-sm p-1.5',
};

export function Button({ variant = 'default', size = 'md', children, className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variantCls[variant]} ${sizeCls[size]} ${className}`}
    >
      {children}
    </button>
  );
}
