/** One-shot focus hand-off between the two coupled study columns (ported from
 * the prototype's panelNav.ts). Expires after 1s: if the other column never
 * opens, it must not steal focus later. */
export type StudyColumn = 'rail' | 'panel';

let switchFocus: { to: StudyColumn; at: number } | null = null;

export function requestSwitchFocus(to: StudyColumn): void {
  switchFocus = { to, at: Date.now() };
}

/** True once, for the column that just opened from the other one. */
export function takeSwitchFocus(me: StudyColumn): boolean {
  const req = switchFocus;
  if (!req || req.to !== me) return false;
  switchFocus = null;
  return Date.now() - req.at < 1000;
}
