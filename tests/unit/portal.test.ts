/**
 * Portal container context (docs/REDESIGN-V2.md §3 H1).
 *
 * `usePortalContainer()` is the node portals mount into: `document.body` when
 * no provider is present, the supplied container otherwise. `InfoHint`
 * relies on it through `infohint-portal.test.tsx`; this suite pins the hook
 * contract itself.
 */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PortalContainerProvider, usePortalContainer } from '../../src/ui/portal';

afterEach(() => cleanup());

describe('usePortalContainer', () => {
  it('defaults to document.body when there is no provider', () => {
    let seen: HTMLElement | null = null;
    function Probe(): null {
      seen = usePortalContainer();
      return null;
    }
    render(createElement(Probe));
    expect(seen).toBe(document.body);
  });

  it('returns the supplied container when wrapped', () => {
    const container = document.createElement('div');
    let seen: HTMLElement | null = null;
    function Probe(): null {
      seen = usePortalContainer();
      return null;
    }
    render(createElement(PortalContainerProvider, { container, children: createElement(Probe) }));
    expect(seen).toBe(container);
  });
});
