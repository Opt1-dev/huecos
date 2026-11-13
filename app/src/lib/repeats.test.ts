import { describe, expect, it } from 'vitest';
import { looksLikeTimeOff, repeatedTitles, type TitleRow } from './repeats';

const row = (title: string, start: string, end: string, allDay = false): TitleRow => ({
  title,
  all_day: allDay,
  start_at: start,
  end_at: end,
});
const shift = (title: string, d: number) => row(title, `2026-11-${d}T09:00:00Z`, `2026-11-${d}T17:00:00Z`);
const wholeDay = (title: string, d: number) => row(title, `2026-11-${d}T00:00:00Z`, `2026-11-${d + 1}T00:00:00Z`, true);

describe('repeatedTitles', () => {
  it('lists titles used several times, day-off ones first and pre-ticked', () => {
    const rows = [
      shift('Turno Amorino', 10),
      shift('Turno Amorino', 11),
      shift('Turno Amorino', 12),
      wholeDay('Día libre', 13),
      wholeDay('día  libre ', 14),
      shift('Reunión', 15),
    ];
    expect(repeatedTitles(rows, [])).toEqual([
      { title: 'Día libre', count: 2, allDay: true, suggested: true },
      { title: 'Turno Amorino', count: 3, allDay: false, suggested: false },
    ]);
  });

  it('leaves out titles already hidden and empty titles', () => {
    const rows = [wholeDay('Vacaciones', 1), wholeDay('Vacaciones', 2), shift('', 3), shift('', 4)];
    expect(repeatedTitles(rows, ['vacaciones'])).toEqual([]);
  });

  it('treats a 20 h+ timed event as a whole day', () => {
    const rows = [row('Guardia', '2026-11-01T08:00:00Z', '2026-11-02T08:00:00Z'), row('Guardia', '2026-11-03T08:00:00Z', '2026-11-04T08:00:00Z')];
    expect(repeatedTitles(rows, [])[0]).toMatchObject({ allDay: true, suggested: true });
  });
});

describe('looksLikeTimeOff', () => {
  it.each(['Día libre', 'Vacaciones', 'Jour de repos', 'Congés', 'Férié', 'Day off', 'Festivo local'])('%s', (t) => {
    expect(looksLikeTimeOff(t)).toBe(true);
  });
  it.each(['Turno Amorino', 'Librería', 'Offre', 'Restaurante', 'Repostería'])('not %s', (t) => {
    expect(looksLikeTimeOff(t)).toBe(false);
  });
});
