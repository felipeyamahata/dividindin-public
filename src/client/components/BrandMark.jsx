import React, { forwardRef } from 'react';

/**
 * Shared Dividindin three-D horizontal mark SVG.
 * Exposes each arch as an individually addressable path for staggered shimmer animations.
 */
export const BrandMark = forwardRef(function BrandMark(
  { className = '', animatedParts = false, ...rest },
  ref
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 90 29"
      fill="none"
      aria-hidden="true"
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      {...rest}
    >
      <path
        className={animatedParts ? 'brand-mark__d brand-mark__d--1' : undefined}
        d="M2 27V17C2 8.72 8.72 2 17 2s15 6.72 15 15v10H2Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        className={animatedParts ? 'brand-mark__d brand-mark__d--2' : undefined}
        d="M30 27V17C30 8.72 36.72 2 45 2s15 6.72 15 15v10H30Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        className={animatedParts ? 'brand-mark__d brand-mark__d--3' : undefined}
        d="M58 27V17C58 8.72 64.72 2 73 2s15 6.72 15 15v10H58Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
});
