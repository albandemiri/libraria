import { describe, expect, it } from 'vitest';
import { paragraphs, splitDescription } from './description';

describe('splitDescription', () => {
  it('no description: no quote, no body', () => {
    expect(splitDescription(null)).toEqual({ lede: null, body: [] });
    expect(splitDescription('  \n\n ')).toEqual({ lede: null, body: [] });
  });

  it('the first paragraph is the quote, the rest the body', () => {
    expect(splitDescription('Një.')).toEqual({ lede: 'Një.', body: [] });
    expect(splitDescription('Një.\n\nDy.\n \nTre.')).toEqual({
      lede: 'Një.',
      body: ['Dy.', 'Tre.'],
    });
  });

  it('a first paragraph over 240 characters is cut at a word, and kept in full in the body', () => {
    const long = 'fjalë '.repeat(60).trim();
    const { lede, body } = splitDescription(`${long}\n\nDy.`);
    expect(lede?.endsWith('…')).toBe(true);
    expect(lede?.length).toBeLessThanOrEqual(241);
    expect(lede?.slice(0, -1).endsWith('fjalë')).toBe(true);
    expect(body).toEqual([long, 'Dy.']);
  });

  it('paragraphs split on blank lines only', () => {
    expect(paragraphs('A\nB\n\n\nC')).toEqual(['A\nB', 'C']);
  });
});
