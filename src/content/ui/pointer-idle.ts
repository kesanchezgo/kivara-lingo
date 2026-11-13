/**
 * Point 4 — «Limpieza visual» hides the player's chrome only while the
 * pointer is IDLE over the video, and shows it again on pointer activity —
 * the same rule Kivara's own bar follows. The timeline, volume and menus must
 * never be lost to the toggle.
 *
 * The hook ticks a small state machine: pointer activity inside the video
 * rect pushes the deadline forward; an interval flips the boolean when the
 * deadline passes. Paused/hidden states are the caller's business.
 */
import { useEffect, useState } from 'react';

export function usePointerIdleOverPlayer(
  video: HTMLVideoElement | null,
  enabled: boolean,
  idleMs = 2_500,
): boolean {
  // `idle` starts TRUE: with the toggle on, chrome starts hidden until the
  // user moves the pointer — the same first frame the mock shows.
  const [idle, setIdle] = useState(true);

  useEffect(() => {
    if (!enabled || !video) {
      // Disabled: the chrome must SHOW (nothing hides it) — the state says so.
      setIdle(false);
      return;
    }
    let deadline = 0; // 0 = already idle
    let raf = 0;

    const isOverVideo = (x: number, y: number): boolean => {
      const r = video.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const markActivity = (x: number, y: number): void => {
      if (!isOverVideo(x, y)) return;
      deadline = Date.now() + idleMs;
    };
    const onMove = (e: PointerEvent | MouseEvent): void => markActivity(e.clientX, e.clientY);
    const onDown = (e: PointerEvent | MouseEvent): void => markActivity(e.clientX, e.clientY);

    const tick = (): void => {
      if (deadline === 0) {
        setIdle(true);
        return;
      }
      const idleNow = Date.now() >= deadline;
      setIdle(idleNow);
    };
    const interval = window.setInterval(tick, 250);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [video, enabled, idleMs]);

  return idle;
}
