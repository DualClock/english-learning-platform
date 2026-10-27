'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'onDark' | 'secondaryOnDark' | 'danger';

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  onDark: 'btn-on-dark',
  secondaryOnDark: 'btn-secondary-on-dark',
  danger: 'btn-danger',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  href?: string;
  children: ReactNode;
}

export default function Button({ variant = 'primary', href, className = '', children, disabled, ...rest }: ButtonProps) {
  const cls = `${variantClass[variant]} ${className}`.trim();
  if (href) {
    const { type, ...linkRest } = rest;
    void type;
    return (
      <Link
        href={href}
        className={cls}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        {...(linkRest as Record<string, unknown>)}
      >
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}
