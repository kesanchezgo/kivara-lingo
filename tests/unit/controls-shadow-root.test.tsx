/**
 * F1 gate: `Select` and `Slider` must work inside a CLOSED shadow root.
 *
 * The old Radix-backed controls listened on `document` (focus scope, dismissable
 * layer) and broke inside the content script's closed root. The replacement is
 * native — a `<select>` and an `<input type="range">` — so the browser itself
 * handles the keyboard and React's delegated listener sits on the mount node
 * INSIDE the root. This mounts the real components into a closed shadow root
 * and drives change + key events through it.
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Select, Slider } from '../../src/ui/primitives/controls';

function Harness({ onSelect, onSlide }: {
  onSelect: (v: string) => void;
  onSlide: (v: string) => void;
}) {
  const [word, setWord] = useState('a');
  const [size, setSize] = useState(20);
  return (
    <div>
      <Select
        value={word}
        aria-label="word"
        onChange={(e) => { setWord(e.target.value); onSelect(e.target.value); }}
      >
        <option value="a">A</option>
        <option value="b">B</option>
        <optgroup label="More">
          <option value="c">C</option>
        </optgroup>
      </Select>
      <Slider
        value={size}
        min={0}
        max={100}
        step={1}
        aria-label="size"
        onChange={(e) => { setSize(Number(e.target.value)); onSlide(e.target.value); }}
      />
    </div>
  );
}

/** Mounts into a fresh closed shadow root and hands back the root + controls. */
function mountInClosedRoot(onSelect: (v: string) => void, onSlide: (v: string) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const mount = document.createElement('div');
  root.appendChild(mount);
  render(<Harness onSelect={onSelect} onSlide={onSlide} />, { container: mount });
  return { root, host };
}

describe('native controls inside a closed shadow root', () => {
  it('renders a real <select> and <input type="range"> inside the closed root', () => {
    const { root } = mountInClosedRoot(() => {}, () => {});
    const select = root.querySelector<HTMLSelectElement>('select');
    const range = root.querySelector<HTMLInputElement>('input[type="range"]');
    expect(select).not.toBeNull();
    expect(range).not.toBeNull();
    // Nothing portaled to the document: Radix used to mount its popup outside
    // the root, where it could not be seen or reached.
    expect(document.querySelector('select')).toBeNull();
    expect(document.querySelector('input[type="range"]')).toBeNull();
    cleanup();
  });

  it('delivers change events to both handlers from inside the root', () => {
    const selected: string[] = [];
    const slid: string[] = [];
    const { root } = mountInClosedRoot((v) => selected.push(v), (v) => slid.push(v));
    const select = root.querySelector<HTMLSelectElement>('select')!;
    const range = root.querySelector<HTMLInputElement>('input[type="range"]')!;

    fireEvent.change(select, { target: { value: 'b' } });
    expect(selected).toEqual(['b']);
    expect(select.value).toBe('b');

    fireEvent.change(range, { target: { value: '42' } });
    expect(slid).toEqual(['42']);
    expect(range.value).toBe('42');
    cleanup();
  });

  it('delivers keyboard events to the native controls inside the root', () => {
    const { root } = mountInClosedRoot(() => {}, () => {});
    const select = root.querySelector<HTMLSelectElement>('select')!;
    const range = root.querySelector<HTMLInputElement>('input[type="range"]')!;

    // The old Radix control needed a document-level focus scope that reads
    // document.activeElement (which a closed root hides). These controls own
    // their key handling, so a keydown dispatched inside the root arrives at
    // the element itself.
    let selectKey: string | null = null;
    let rangeKey: string | null = null;
    select.addEventListener('keydown', (e: Event) => { selectKey = (e as KeyboardEvent).key; });
    range.addEventListener('keydown', (e: Event) => { rangeKey = (e as KeyboardEvent).key; });

    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));

    expect(selectKey).toBe('ArrowDown');
    expect(rangeKey).toBe('ArrowRight');
    cleanup();
  });
})
