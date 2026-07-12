import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm' | 'icon';
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', children, ...rest }: ButtonProps) {
  const classes = ['btn', `btn--${variant}`];
  if (size !== 'md') classes.push(`btn--${size}`);
  return (
    <button type="button" className={classes.join(' ')} {...rest}>
      {children}
    </button>
  );
}
