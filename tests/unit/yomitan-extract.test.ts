/**
 * Unit tests for the Yomitan structured-content extractor.
 *
 * Anchored against the real shapes emitted by the
 * `kaikki-to-yomitan` / `wiktionary-to-yomitan` pipeline (see
 * `kty-en-es.zip` term_bank entries). Each fixture below mirrors the layout
 * that pipeline produces for a sense with or without examples, so a
 * regression in the extractor would show up as one of these tests
 * flipping.
 */
import { describe, expect, it } from 'vitest';
import { extractDefinitionParts } from '../../src/content/nlp/yomitan';

describe('extractDefinitionParts', () => {
  it('returns plain strings as-is', () => {
    expect(extractDefinitionParts('Andar, marchar, caminar.')).toEqual({
      text: 'Andar, marchar, caminar.',
      examples: [],
    });
  });

  it('falls back to empty for null / non-objects', () => {
    expect(extractDefinitionParts(null)).toEqual({ text: '', examples: [] });
    expect(extractDefinitionParts(undefined)).toEqual({ text: '', examples: [] });
    expect(extractDefinitionParts(123 as unknown)).toEqual({ text: '', examples: [] });
  });

  it('joins nested text leaves into a single trimmed string', () => {
    const node = {
      type: 'structured-content',
      content: [
        { tag: 'div', content: ['Hello', ' ', 'world'] },
        { tag: 'span', content: '!' },
      ],
    };
    expect(extractDefinitionParts(node).text).toBe('Hello world !');
  });

  it('extracts a single example-sentence pair from the kty-en-es shape', () => {
    const node = {
      type: 'structured-content',
      content: {
        tag: 'div',
        content: [
          'Ir.',
          {
            tag: 'details',
            data: { content: 'details-entry-examples' },
            content: [
              {
                tag: 'summary',
                data: { content: 'summary-entry' },
                content: '1 ejemplo',
              },
              {
                tag: 'div',
                data: { content: 'extra-info' },
                content: {
                  tag: 'div',
                  data: { content: 'example-sentence' },
                  content: [
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-a' },
                      content: 'You can come and go as you please.',
                    },
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-b' },
                      content: 'Puedes ir y venir a tu antojo.',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const parts = extractDefinitionParts(node);
    expect(parts.text).toBe('Ir.');
    expect(parts.examples).toEqual([
      'You can come and go as you please. — Puedes ir y venir a tu antojo.',
    ]);
  });

  it('extracts multiple examples under a single details wrapper', () => {
    const node = {
      type: 'structured-content',
      content: {
        tag: 'div',
        content: [
          'Irse, marcharse, partir.',
          {
            tag: 'details',
            data: { content: 'details-entry-examples' },
            content: [
              {
                tag: 'summary',
                data: { content: 'summary-entry' },
                content: '2 ejemplos',
              },
              {
                tag: 'div',
                data: { content: 'extra-info' },
                content: {
                  tag: 'div',
                  data: { content: 'example-sentence' },
                  content: [
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-a' },
                      content: 'Go on holiday.',
                    },
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-b' },
                      content: 'Irse de vacaciones.',
                    },
                  ],
                },
              },
              {
                tag: 'div',
                data: { content: 'extra-info' },
                content: {
                  tag: 'div',
                  data: { content: 'example-sentence' },
                  content: [
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-a' },
                      content: 'All his money goes on records.',
                    },
                    {
                      tag: 'div',
                      data: { content: 'example-sentence-b' },
                      content: 'Todo el dinero se le va en discos.',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const parts = extractDefinitionParts(node);
    expect(parts.text).toBe('Irse, marcharse, partir.');
    expect(parts.examples).toEqual([
      'Go on holiday. — Irse de vacaciones.',
      'All his money goes on records. — Todo el dinero se le va en discos.',
    ]);
  });

  it('returns the source alone when only example-sentence-a is present', () => {
    const node = {
      tag: 'div',
      data: { content: 'example-sentence' },
      content: [
        {
          tag: 'div',
          data: { content: 'example-sentence-a' },
          content: 'Solo source available.',
        },
      ],
    };
    expect(extractDefinitionParts(node).examples).toEqual(['Solo source available.']);
  });

  it('strips inline grammatical-tag wrappers from the definition text', () => {
    const node = {
      tag: 'div',
      content: [
        {
          tag: 'div',
          data: { content: 'tags' },
          content: [
            {
              tag: 'span',
              content: 'col',
              data: { content: 'tag', category: '' },
            },
          ],
        },
        'Persona cualquiera; tipo, fulano.',
      ],
    };
    const parts = extractDefinitionParts(node);
    expect(parts.text).toBe('Persona cualquiera; tipo, fulano.');
    expect(parts.examples).toEqual([]);
  });

  it('omits the "1 ejemplo" summary label from the definition text', () => {
    const node = {
      tag: 'div',
      content: [
        'Recorrer.',
        {
          tag: 'details',
          data: { content: 'details-entry-examples' },
          content: [
            {
              tag: 'summary',
              data: { content: 'summary-entry' },
              content: '1 ejemplo',
            },
            {
              tag: 'div',
              data: { content: 'extra-info' },
              content: {
                tag: 'div',
                data: { content: 'example-sentence' },
                content: [
                  {
                    tag: 'div',
                    data: { content: 'example-sentence-a' },
                    content: 'They had only gone a mile when the car stopped.',
                  },
                  {
                    tag: 'div',
                    data: { content: 'example-sentence-b' },
                    content: 'Sólo habían recorrido una milla cuando se les paró el auto.',
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const parts = extractDefinitionParts(node);
    expect(parts.text).toBe('Recorrer.');
    expect(parts.text).not.toContain('1 ejemplo');
    expect(parts.examples).toHaveLength(1);
  });

  it('collapses repeated whitespace in extracted definitions', () => {
    const node = {
      tag: 'div',
      content: [
        '  Andar,   ',
        ' marchar, ',
        '  caminar.   ',
      ],
    };
    expect(extractDefinitionParts(node).text).toBe('Andar, marchar, caminar.');
  });

  it('handles structuredContent (camelCase) wrappers used by some packs', () => {
    const node = {
      structuredContent: {
        tag: 'div',
        content: 'Test sense.',
      },
    };
    expect(extractDefinitionParts(node).text).toBe('Test sense.');
  });
});
