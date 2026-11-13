import { describe, expect, it } from 'vitest';
import { layoutGraph, noteLinks, titleWords } from './noteGraph';

describe('titleWords', () => {
  it('keeps meaningful words, folded, without short or stop words', () => {
    expect(titleWords('Idées pour le Projet de DAW')).toEqual(['idees', 'projet', 'daw']);
    expect(titleWords('Prueba Abierta UD02 (1/3)')).toEqual(['prueba', 'abierta', 'ud02']);
    expect(titleWords('The logo and the colours')).toEqual(['logo', 'colours']);
    expect(titleWords('À la plage')).toEqual(['plage']);
  });
});

describe('noteLinks', () => {
  it('links notes whose titles share a word, whatever the case or accents', () => {
    const links = noteLinks([
      { id: 'a', title: 'Logo The Buffer Club' },
      { id: 'b', title: 'Couleurs du logo' },
      { id: 'c', title: 'Idées de week-end' },
      { id: 'd', title: 'Buffer Club : réunion' },
    ]);
    expect(links).toEqual([
      { a: 'a', b: 'b', words: ['logo'] },
      { a: 'a', b: 'd', words: ['buffer', 'club'] },
    ]);
  });

  it('does not link through stop words or short words', () => {
    expect(noteLinks([{ id: 'a', title: 'Notes pour la DAW' }, { id: 'b', title: 'Courses pour la semaine' }])).toEqual([]);
  });
});

describe('layoutGraph', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: id }));
  const links = [
    { a: 'a', b: 'b', words: ['x'] },
    { a: 'b', b: 'c', words: ['y'] },
    { a: 'a', b: 'c', words: ['z'] },
  ];

  it('keeps every point inside the box', () => {
    const pos = layoutGraph(nodes, links, 3);
    expect(pos.size).toBe(6);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(3);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('gives the same picture every time', () => {
    expect([...layoutGraph(nodes, links, 3)]).toEqual([...layoutGraph(nodes, links, 3)]);
  });

  it('draws linked notes closer together than unlinked ones', () => {
    const pos = layoutGraph(nodes, links, 3);
    const dist = (a: string, b: string) => Math.hypot(pos.get(a)!.x - pos.get(b)!.x, pos.get(a)!.y - pos.get(b)!.y);
    const linkedAvg = (dist('a', 'b') + dist('b', 'c') + dist('a', 'c')) / 3;
    const unlinkedAvg = (dist('d', 'e') + dist('e', 'f') + dist('d', 'f')) / 3;
    expect(linkedAvg).toBeLessThan(unlinkedAvg);
  });

  it('centres a single note', () => {
    expect(layoutGraph([{ id: 'x', title: 'x' }], [], 4).get('x')).toEqual({ x: 2, y: 0.5 });
  });
});
