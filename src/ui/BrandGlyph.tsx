/**
 * Brand glyph (screen + subtitle lines). Single source of the vector: browser
 * bar, player controls, popup, panel and onboarding. Inherits `currentColor`.
 */
export function BrandGlyph({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <line x1="7" y1="12" x2="13" y2="12" />
      <line x1="7" y1="15.5" x2="11" y2="15.5" />
      <circle cx="17.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}