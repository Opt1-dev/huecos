import { describe, expect, it } from 'vitest';
import { filterNotes, type NoteLite } from './notes';

const note = (id: string, extra: Partial<NoteLite> = {}): NoteLite => ({
  id,
  subject_id: null,
  title: id,
  body: '',
  pinned: false,
  updated_at: '2026-11-10T10:00:00Z',
  ...extra,
});

const notes = [
  note('old', { updated_at: '2026-11-01T10:00:00Z', body: 'Réviser les formulaires' }),
  note('recent', { updated_at: '2026-11-12T10:00:00Z', subject_id: 'dewes' }),
  note('pinned-old', { pinned: true, updated_at: '2026-10-01T10:00:00Z', subject_id: 'tbc', body: 'Identité visuelle' }),
  note('Logo', { updated_at: '2026-11-11T10:00:00Z', subject_id: 'tbc', body: 'Nouveau logo pour The Buffer Club' }),
];
const ids = (list: NoteLite[]) => list.map((n) => n.id);

describe('filterNotes', () => {
  it('shows pinned notes first, then the most recently modified', () => {
    expect(ids(filterNotes(notes, '', ''))).toEqual(['pinned-old', 'recent', 'Logo', 'old']);
  });

  it('searches title and text, ignoring case and accents, every word', () => {
    expect(ids(filterNotes(notes, 'reviser', ''))).toEqual(['old']);
    expect(ids(filterNotes(notes, 'LOGO buffer', ''))).toEqual(['Logo']);
    expect(ids(filterNotes(notes, 'identite', ''))).toEqual(['pinned-old']);
    expect(ids(filterNotes(notes, 'introuvable', ''))).toEqual([]);
  });

  it('filters by subject, or notes without subject', () => {
    expect(ids(filterNotes(notes, '', 'tbc'))).toEqual(['pinned-old', 'Logo']);
    expect(ids(filterNotes(notes, '', 'none'))).toEqual(['old']);
    expect(ids(filterNotes(notes, 'logo', 'dewes'))).toEqual([]);
  });
});
