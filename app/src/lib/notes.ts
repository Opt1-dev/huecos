// Notes logic: pure functions (tested in notes.test.ts).
import { fold } from './rendus';

export const NOTE_MAX = 5000;

export interface NoteLite {
  id: string;
  subject_id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  updated_at: string;
}

/** "" = every note, "none" = notes without subject, otherwise a subject id. */
export type SubjectFilter = string;

/**
 * Notes matching the search (title or text, case and accents ignored, every
 * word must appear) and the subject filter: pinned first, then most recently
 * modified.
 */
export function filterNotes<T extends NoteLite>(notes: readonly T[], search: string, subject: SubjectFilter): T[] {
  const words = fold(search).split(' ').filter(Boolean);
  return notes
    .filter((n) => (subject === '' ? true : subject === 'none' ? n.subject_id === null : n.subject_id === subject))
    .filter((n) => {
      if (words.length === 0) return true;
      const hay = fold(`${n.title} ${n.body}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
}
