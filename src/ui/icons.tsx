/**
 * Icon layer — Phosphor Icons behind the lucide-style API the components use
 * (`size`, `className`, `strokeWidth`). Swapping the set happens in
 * `icon-map.ts`; the runtime wrapper lives in `icon-base.tsx`.
 *
 * The exported components are generated into `icons.generated.tsx` from the
 * (icon, weight) combinations found across `src/` — run `pnpm icons:build`
 * after adding an import. This file stays the public API every component
 * imports from.
 */
export * from './icon-base';
export * from './icons.generated';