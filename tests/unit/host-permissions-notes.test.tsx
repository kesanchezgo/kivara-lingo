/**
 * The host-permissions hint carries the two parity notes (close-out point 4a).
 *
 * The prototype folds both explanations into the info hint next to the
 * summary: the groups drive SOURCES (an enabled source without permission
 * fails), and they are not per video site (Netflix, Prime, YouTube… ride the
 * manifest's fixed content-script matches, never this switch). Without the
 * notes, the most common support question — "why did my enabled source fail?"
 * — has no answer where the switches live.
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HostPermissionsRow } from '../../src/app/components/HostPermissionsRow';

describe('the host-permissions info hint', () => {
  it('explains sources vs sites: both parity notes render in the tooltip', () => {
    const { container } = render(<HostPermissionsRow />);
    // The FIRST hint on the row is the summary line's info icon; every group
    // row carries its own, so the aria-label alone matches several elements.
    const summaryHint = container.querySelector<HTMLElement>('.kvl-hint');
    expect(summaryHint).not.toBeNull();
    // React synthesizes onMouseEnter from mouseover (same as infohint-portal).
    fireEvent.mouseOver(summaryHint!);

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip).not.toBeNull();

    // vipx.permDiffVip — permission is per SOURCE, not per site.
    expect(tooltip!.textContent).toContain('VIP y Estándar eligen qué fuentes usar');
    expect(tooltip!.textContent).toContain('una fuente activada sin permiso dará error');

    // vipx.permDiffSites — the video sites always work.
    expect(tooltip!.textContent).toContain('No es por sitio de vídeo');
    expect(tooltip!.textContent).toContain('Netflix, Prime, YouTube');
  });
});
