import { describe, expect, it } from 'vitest';
import { parseBlockedDays } from './blocked';

describe('parseBlockedDays', () => {
  it('reads ISO and European dates, detects holidays and skips junk', () => {
    expect(
      parseBlockedDays(`2026-12-08 festivo
07/12/2026
31/02/2027
hello
06.01.2027 Reyes férié
2026-12-08 holiday`),
    ).toEqual([
      { date: '2026-12-07', kind: 'non_school' },
      { date: '2026-12-08', kind: 'holiday' },
      { date: '2027-01-06', kind: 'holiday' },
    ]);
  });
});
