/**
 * RED TESTS — #156 closeout (base main@fb9e449).
 */
import { describe, expect, it } from 'vitest';
import { buildColumnsCss } from '../../src/content/ui/columns-css';
import { safeZoneFor } from '../../src/content/ui/study-bar-safe-zone';

describe('1 — generic anti-double-shrink selector', () => {
  it('a child container inside a matched parent does NOT match the width rule', () => {
    const css = buildColumnsCss({
      platform: 'netflix',
      state: { rail: true, panel: false },
      viewportWidth: 1920,
    });
    // Every selector must exclude a descendant of any selector in the list.
    expect(css).toContain(':not(:is(');
    const list = ['.watch-video', '[data-uia="watch-video"]'];
    for (const sel of list) {
      expect(css).toContain(`${sel}:not(:is(${list.join(', ')}) ${sel})`);
    }
    // DOM proof: parent + child, only the parent matches.
    const parent = document.createElement('div');
    parent.className = 'watch-video';
    parent.setAttribute('data-uia', 'watch-video');
    const child = document.createElement('div');
    child.className = 'watch-video';
    child.setAttribute('data-uia', 'watch-video');
    parent.appendChild(child);
    document.body.appendChild(parent);
    const rule = list
      .map((sel) => `${sel}:not(:is(${list.join(', ')}) ${sel})`)
      .join(', ');
    // Control: the plain selector DOES find the child, so the zero below is
    // the :not(:is(...)) exclusion, not a dead selector.
    expect(parent.querySelectorAll(list.join(', '))).toHaveLength(1);
    expect([...parent.querySelectorAll(rule)]).toHaveLength(0);
    parent.remove();
  });
});

describe('2 — prime margin consistent with the other five platforms', () => {
  it('prime keeps right:140 but its bottom matches the group', () => {
    const prime = safeZoneFor('prime');
    expect(prime.margins.bottom).toBe(safeZoneFor('netflix').margins.bottom);
    expect(prime.margins.bottom).toBe(170);
    expect(prime.margins.right).toBe(140);
  });
});
