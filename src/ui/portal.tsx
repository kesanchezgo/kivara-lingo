/**
 * Portal container context (docs/REDESIGN-V2.md §3 H1).
 *
 * The content script's shadow root is CLOSED, so a portal (toast, InfoHint,
 * VocabCheck dialog) cannot mount into `document.body`: the Radix
 * DismissableLayer / FocusScope listen on the document and see only the host,
 * which breaks focus handling and dismissal. Portals inside the content script
 * must therefore mount into a node INSIDE that root — the shadow host supplies
 * it as `container`. Extension pages (Options, popup, onboarding) supply
 * `document.body`.
 */
import { createContext, useContext, type ReactNode } from 'react';

/** `null` means "no provider / no override" → the default applies. */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

/**
 * The node portals should mount into. Defaults to `document.body` when no
 * provider (or a null container) is present.
 */
export function usePortalContainer(): HTMLElement {
  const container = useContext(PortalContainerContext);
  return container ?? document.body;
}
