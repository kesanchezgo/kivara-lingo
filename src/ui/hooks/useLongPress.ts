/**
 * Press and long-press on the same button (⟲ in the study bar and in the
 * transcript: tap repeats the line, hold repeats it slower).
 *
 * Ported from the prototype. Keyboard Enter/Space is the normal press; the
 * slow pass has its own shortcut. The context menu is suppressed on touch
 * only while a long press is in flight or just fired, so the browser's
 * "copy / save" sheet does not replace the action.
 */
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

export function useLongPress(
  onPress: (event: MouseEvent) => void,
  onLongPress: () => void,
  ms = 450,
) {
  const press = useLatest(onPress);
  const long = useLatest(onLongPress);
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);

  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        long.current();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (event: MouseEvent) => {
      if (fired.current || timer.current !== null) event.preventDefault();
    },
    onClick: (event: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      press.current(event);
    },
  };
}

/** Keeps the callback current without re-creating the handlers each render. */
function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}