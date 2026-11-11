/**
 * Hand-written icon runtime: the lucide-style API on top of plain SVG nodes.
 *
 * `icons.generated.tsx` carries only the (icon, weight) path data the UI uses;
 * this file carries the one wrapper, the weight mapping and the public prop
 * types. Keeping the wrapper here (instead of regenerating it) means a change
 * to `strokeWidth` semantics is a hand edit in one place, not a generator
 * template change.
 *
 * `strokeWidth` maps onto Phosphor weights: <=1.75 light · 2 regular · >=2.5
 * bold. `fill="currentColor"` maps to the fill weight (lucide's solid
 * play/pause convention); an explicit `weight` always wins.
 */
import React from 'react';

/** Every weight Phosphor defines. The generator emits the subset in use. */
export type IconWeight =
  | 'thin'
  | 'light'
  | 'regular'
  | 'bold'
  | 'fill'
  | 'duotone';

/** One `<path>` of an icon weight; Phosphor emits nothing else. */
export interface IconPath {
  d: string;
  opacity?: string;
}

/** Weight → paths. `regular` is always present. */
export type IconPaths = Partial<Record<IconWeight, readonly IconPath[]>>;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  strokeWidth?: number | string;
  weight?: IconWeight;
  className?: string;
}

export type IconComponent = React.FC<IconProps>;

function weightFor(strokeWidth?: number | string): IconWeight {
  const w = Number(strokeWidth ?? 2);
  if (w >= 2.5) return 'bold';
  if (w <= 1.75) return 'light';
  return 'regular';
}

/**
 * Build a component from generated path data.
 *
 * A weight the generator did not ship (only possible when a call site passes
 * one the scanner could not see, e.g. a computed expression) falls back to
 * `regular` instead of rendering nothing.
 */
export function wrap(paths: IconPaths, name: string): IconComponent {
  const C: IconComponent = ({ size = 24, strokeWidth, weight, fill, ...rest }) => {
    const wanted =
      weight ?? (fill && fill !== 'none' ? 'fill' : weightFor(strokeWidth));
    const nodes = paths[wanted] ?? paths.regular ?? [];
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill="currentColor"
        viewBox="0 0 256 256"
        {...rest}
      >
        {nodes.map((node, i) => (
          <path key={i} d={node.d} opacity={node.opacity} />
        ))}
      </svg>
    );
  };
  C.displayName = name;
  return C;
}