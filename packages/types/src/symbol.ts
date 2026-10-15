import { z } from 'zod';

/**
 * A ticker symbol as accepted from users and providers, e.g. `AAPL`, `BRK.B`, `VOD.L`.
 * Normalised to upper case. Must start with a letter or digit; may contain `.` and `-`.
 */
export const tickerSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9.-]{0,9}$/, 'Invalid ticker symbol');

export type TickerSymbol = z.infer<typeof tickerSymbolSchema>;
