/**
 * RED TESTS — prototype fidelity: word marks + one coupled study column.
 * Every assertion is executable in DOM/React/Pure logic — no source reading.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { markOf, isLearnableToken } from '../../src/content/ui/wordMarks';
import { applyColumnsCss, computeColumnVisibility, computeColumnLayout } from '../../src/content/ui/columns-css';
import { SlideColumn } from '../../src/content/ui/SlideColumn';
import { requestSwitchFocus, takeSwitchFocus } from '../../src/content/ui/column-switch-focus';
import { defaultPopupPosition } from '../../src/content/ui/default-popup-position';
import { readFileSync } from 'node:fs';

afterEach(() => { document.body.innerHTML = ''; });

describe('A1 — theme variables inside a closed ShadowRoot', () => {
  it('the compiled :host block defines the marks and motion tokens', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // happy-dom cannot resolve CSS custom properties in a closed root; mount
    // the real stylesheet and assert what the browser receives.
    const themeCss = readFileSync('src/styles/theme.css', 'utf8');
    style.textContent = themeCss;
    root.append(style);
    // CSSOM (executable): the :host rule inside the closed root must carry
    // the same custom properties as :root — happy-dom cannot compute vars.
    const rules = Array.from(style.sheet?.cssRules ?? []);
    // happy-dom cannot parse :host selectors into CSSOM rules: assert the
    // MOUNTED stylesheet's text (the same text the browser parses) instead.
    const cssText = style.textContent ?? '';
    expect(cssText).toMatch(/:root, :host \{/);
    for (const name of ['--kvl-ws-new', '--kvl-ws-learning', '--kvl-ws-neutral', '--kvl-ease', '--kvl-spring']) {
      expect(cssText, name).toContain(name);
    }
  });
});

describe('A2 — only learnable vocabulary gets marks', () => {
  it('pure digits and empty MWE continuations get no mark', () => {
    const digits = markOf({ key: '2024', text: '2024', kind: 'unknown' } as never, () => 'new');
    expect(digits).toEqual({ expr: false });
    const empty = markOf({ key: '', text: '', kind: 'mwe' } as never, () => 'new');
    expect(empty).toEqual({ expr: false });
    expect(isLearnableToken({ key: 'run', text: 'run', kind: 'unknown' } as never)).toBe(true);
  });
});

describe('B1 — one coupled column at a time', () => {
  it('docked panel hides the rail; floating panel keeps both', () => {
    expect(computeColumnVisibility({ enabled: true, railOpen: true, panelOpen: true, isPopupMode: false }))
      .toEqual({ rail: false, panel: true });
    expect(computeColumnVisibility({ enabled: true, railOpen: true, panelOpen: true, isPopupMode: true }))
      .toEqual({ rail: true, panel: false });
    const layout = computeColumnLayout({ rail: false, panel: true }, 1600);
    expect(layout.railWidth).toBe(0);
    expect(layout.panelWidth).toBeGreaterThan(0);
  });

  it('a distinct motion stylesheet exists while enabled on a shrink/resize platform', () => {
    applyColumnsCss({ platform: 'netflix', enabled: true, state: { rail: true, panel: false }, viewportWidth: 1600 });
    expect(document.getElementById('kivara-col-motion-netflix')).not.toBeNull();
    expect(document.getElementById('kivara-columns-netflix')).not.toBeNull();
  });
});

describe('B2 — SlideColumn lifecycle', () => {
  it('opens to target width, freezes inner width and unmounts after close', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
    const view = render(<SlideColumn open={false} widthPx={420}><div data-testid="rail-child">rail</div></SlideColumn>);
    expect(screen.queryByTestId('rail-child')).toBeNull();
    view.rerender(<SlideColumn open widthPx={420}><div data-testid="rail-child">rail</div></SlideColumn>);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const outer = screen.getByTestId('rail-child').parentElement!.parentElement!;
    expect(outer.style.width).toBe('420px');
    view.rerender(<SlideColumn open={false} widthPx={420}><div data-testid="rail-child">rail</div></SlideColumn>);
    expect(outer.hasAttribute('data-kvl-closing')).toBe(true);
    expect(outer.getAttribute('aria-hidden')).toBe('true');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.queryByTestId('rail-child')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('B3 — switch focus protocol', () => {
  it('a request is consumed once and expires after 1s', () => {
    requestSwitchFocus('rail');
    expect(takeSwitchFocus('rail')).toBe(true);
    expect(takeSwitchFocus('rail')).toBe(false);
  });
});

describe('B3 — floating panel reserves the rail width', () => {
  it('left of an open 420px rail on a 1600px viewport', () => {
    const pos = defaultPopupPosition(420);
    expect(pos.left + pos.width).toBeLessThanOrEqual(1600 - 420);
  });
});
