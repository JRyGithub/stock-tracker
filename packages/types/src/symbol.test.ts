import { describe, expect, it } from 'vitest';
import { tickerSymbolSchema } from './symbol.ts';

describe('tickerSymbolSchema', () => {
  it.each(['AAPL', 'MSFT', 'F', 'BRK.B', 'RDS-A', 'VOD.L'])('accepts %s', (input) => {
    expect(tickerSymbolSchema.parse(input)).toBe(input);
  });

  it('normalises to upper case and trims whitespace', () => {
    expect(tickerSymbolSchema.parse('  aapl ')).toBe('AAPL');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['too long', 'ABCDEFGHIJK'],
    ['contains spaces', 'AA PL'],
    ['SQL-ish', "AAPL'; DROP TABLE watchlist;--"],
    ['starts with punctuation', '.AAPL'],
  ])('rejects %s', (_label, input) => {
    expect(tickerSymbolSchema.safeParse(input).success).toBe(false);
  });
});
