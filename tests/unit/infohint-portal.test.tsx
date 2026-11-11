/**
 * F0 gate: portals mount INSIDE the closed shadow root.
 *
 * The content script's shadow root is closed (shadow-host.ts); InfoHint's
 * tooltip portals through `usePortalContainer()`. Without a provider that
 * target used to be `document.body` — OUTSIDE the boundary, where the page's
 * CSS and Dark Reader repaint it, and where native fullscreen hides it (only
 * the fullscreen element's subtree renders). This mounts the real InfoHint
 * inside a closed shadow root under `PortalContainerProvider` — the same shape
 * controls-shadow-root.test.tsx uses for the Radix controls — and pins:
 *
 *   1. the tooltip is a descendant of the shadow root's host subtree, never
 *      of document.body;
 *   2. it renders into the exact container the provider supplied (the node
 *      ShadowHost.mount creates per shadow root);
 *   3. the container rides with the host when fullscreen-overlay-core
 *      re-parents it into a fullscreen element — appendChild carries the
 *      whole shadow tree, so portalled UI stays visible in fullscreen.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { InfoHint } from '../../src/app/components/InfoHint';
import { PortalContainerProvider } from '../../src/ui/portal';

interface MountedHint {
  host: HTMLElement;
  root: ShadowRoot;
  portalContainer: HTMLElement;
}

/** Mounts the real InfoHint into a fresh closed shadow root (mode: 'closed',
 *  as in production) with the dedicated portal container ShadowHost.mount
 *  appends for it. `withProvider` mirrors content vs. extension pages. */
function mountHintInClosedRoot(withProvider: boolean): MountedHint {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const mount = document.createElement('div');
  root.appendChild(mount);
  // The container ShadowHost.mount creates: a dedicated div appended to the
  // shadow root, outside the React mount node.
  const portalContainer = document.createElement('div');
  root.appendChild(portalContainer);
  render(
    withProvider ? (
      <PortalContainerProvider container={portalContainer}>
        <InfoHint text="tooltip body" />
      </PortalContainerProvider>
    ) : (
      <InfoHint text="tooltip body" />
    ),
    { container: mount },
  );
  return { host, root, portalContainer };
}

/** Opens the tooltip. React synthesizes onMouseEnter from mouseover. */
function openTooltip(root: ShadowRoot): HTMLElement {
  const trigger = root.querySelector<HTMLElement>('.kvl-hint');
  expect(trigger).not.toBeNull();
  fireEvent.mouseOver(trigger!);
  const tooltip = root.querySelector<HTMLElement>('[role="tooltip"]');
  expect(tooltip).not.toBeNull();
  return tooltip!;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('InfoHint portals inside the closed shadow root', () => {
  it('renders the tooltip into the provider container, inside the host subtree, never in document.body', () => {
    const { host, root, portalContainer } = mountHintInClosedRoot(true);
    openTooltip(root);

    // The provider's container is a child of the shadow root, and the
    // tooltip renders into it — the tooltip's wrapping portal node is a
    // direct child of that container.
    expect(root.contains(portalContainer)).toBe(true);
    const tooltip = root.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(portalContainer.contains(tooltip)).toBe(true);

    // Descendant of the shadow root's host subtree: its root node IS the
    // closed root the host carries, and the root contains it.
    expect(tooltip.getRootNode()).toBe(root);
    expect(root.contains(tooltip)).toBe(true);
    expect(host.contains(tooltip)).toBe(false); // `contains` stays in the light DOM; the shadow tree is reachable only through the root.

    // Nothing leaked out to document.body, where page CSS and Dark Reader
    // would repaint it.
    expect(document.body.contains(tooltip)).toBe(false);
  });

  it('without a provider the tooltip still mounts into document.body (extension-page fallback)', () => {
    const { root } = mountHintInClosedRoot(false);
    fireEvent.mouseOver(root.querySelector<HTMLElement>('.kvl-hint')!);

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(document.body.contains(tooltip)).toBe(true);
    // The closed root holds nothing: no provider → the default applies.
    expect(root.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('the container rides with the host when fullscreen-overlay-core re-parents it', () => {
    const { host, root, portalContainer } = mountHintInClosedRoot(true);
    const tooltip = openTooltip(root);
    expect(portalContainer.contains(tooltip)).toBe(true);

    // Exactly what updateOverlayParent does on fullscreen entry:
    // `target.appendChild(deps.mount.hostElement)`. The shadow tree travels
    // with its host — portal container and portalled tooltip included — so
    // the tooltip renders inside the fullscreen element and stays visible.
    const fullscreenTarget = document.createElement('div');
    document.body.appendChild(fullscreenTarget);
    fullscreenTarget.appendChild(host);

    expect(host.parentElement).toBe(fullscreenTarget);
    expect(portalContainer.getRootNode()).toBe(root);
    expect(portalContainer.contains(tooltip)).toBe(true);
    expect(tooltip.getRootNode()).toBe(root);
    expect(document.body.contains(tooltip)).toBe(false);
  });
});
