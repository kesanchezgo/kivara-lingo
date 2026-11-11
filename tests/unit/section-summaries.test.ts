/**
 * Dictionary-pack accordion summary (`section-summaries`).
 *
 * The prototype counts enabled packs and never names the pack format; a
 * singular / plural pair backs the label. Tests run under the pinned Spanish
 * locale (tests/setup.ts).
 */
import { describe, expect, it } from 'vitest';
import { packsSummary } from '../../src/app/components/tabs/section-summaries';

describe('packsSummary', () => {
  it('uses the singular key for exactly one enabled pack', () => {
    expect(packsSummary(1)).toBe('1 activo');
  });

  it('uses the counted plural for zero and many', () => {
    expect(packsSummary(0)).toBe('0 activos');
    expect(packsSummary(3)).toBe('3 activos');
    expect(packsSummary(12)).toBe('12 activos');
  });

  it('never mentions the pack format', () => {
    expect(packsSummary(2).toLowerCase()).not.toContain('yomitan');
  });
});