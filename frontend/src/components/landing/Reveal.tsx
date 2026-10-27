'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { variants } from '@/lib/motion';

const viewport = { once: true, margin: '-80px' } as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
}

export function Reveal({ children, className = '' }: RevealProps) {
  return (
    <motion.div
      className={className}
      variants={variants.enter}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
    >
      {children}
    </motion.div>
  );
}

export function RevealGroup({ children, className = '' }: RevealProps) {
  return (
    <motion.div
      className={className}
      variants={variants.list}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className = '' }: RevealProps) {
  return (
    <motion.div className={className} variants={variants.item}>
      {children}
    </motion.div>
  );
}
