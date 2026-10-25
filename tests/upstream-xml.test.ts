/**
 * Our data against the upstream WLC XML, for a sample of ketiv/qere verses.
 *
 * tests/fixtures/wlc-ketiv-qere-sample.xml holds the verses exactly as they are
 * in openscriptures/morphhb (commit in the fixture header). This test reads them
 * with an order-preserving XML parse, independent of scripts/import.ts, and
 * checks that the package data has the same words (text, ketiv/qere) and the
 * same marks, in the same order.
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data', 'openscriptures-OHB');

type Node = Record<string, unknown> & { ':@'?: Record<string, string> };
type Expected =
  | { kind: 'word'; text: string; variant?: 'ketiv' | 'qere' }
  | { kind: 'mark'; type: string; text: string; reading?: 'ketiv' | 'qere' };

const MARKS: Record<string, string> = {
  'x-maqqef': 'maqaf',
  'x-paseq': 'paseq',
  'x-sof-pasuq': 'sof-pasuq',
  'x-pe': 'petuchah',
  'x-samekh': 'setumah',
  'x-reversednun': 'reversed-nun',
};

const tagOf = (n: Node) => Object.keys(n).find(k => k !== ':@')!;
const attr = (n: Node, a: string) => n[':@']?.[`@_${a}`];
const textOf = (n: Node): string => {
  const t = tagOf(n);
  if (t === '#text') return String(n['#text']);
  return (n[t] as Node[]).map(textOf).join('');
};

/** The verse's words and marks in document order, read from the XML. */
function expectedSequence(children: Node[], reading?: 'qere'): Expected[] {
  const out: Expected[] = [];
  for (const n of children) {
    const tag = tagOf(n);
    if (tag === 'w') {
      const type = attr(n, 'type');
      // A word's text without the morpheme dividers; special-letter <seg>s
      // inside the word are part of its text.
      const text = textOf(n).replace(/\//g, '').trim();
      out.push({
        kind: 'word',
        text,
        ...(type === 'x-ketiv' ? { variant: 'ketiv' as const } : reading ? { variant: reading } : {}),
      });
    } else if (tag === 'seg') {
      const type = attr(n, 'type')!;
      out.push({
        kind: 'mark',
        type: MARKS[type] ?? `unknown ${type}`,
        text: textOf(n),
        ...(reading
          ? { reading }
          : attr(n, 'subType') === 'x-ketiv'
            ? { reading: 'ketiv' as const }
            : {}),
      });
    } else if (tag === 'note' && attr(n, 'type') === 'variant') {
      for (const c of n.note as Node[]) {
        if (tagOf(c) === 'rdg' && attr(c, 'type') === 'x-qere') {
          out.push(...expectedSequence(c.rdg as Node[], 'qere'));
        }
      }
    }
    // Other notes (editorial) and whitespace carry no words or marks.
  }
  return out;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
});
const fixture = parser.parse(
  readFileSync(join(__dirname, 'fixtures', 'wlc-ketiv-qere-sample.xml'), 'utf-8')
) as Node[];
const root = fixture.find(n => tagOf(n) === 'verses')!.verses as Node[];
const upstream = new Map<string, Node[]>(
  root.filter(n => tagOf(n) === 'verse').map(n => [attr(n, 'osisID')!, n.verse as Node[]])
);

function ours(osisId: string): Expected[] {
  const [book, ch, v] = osisId.split('.');
  const data = JSON.parse(readFileSync(join(DATA, book, ch, `${v}.json`), 'utf-8'));
  return data.metadata.sequence.map((item: { kind: string; position?: number }) => {
    if (item.kind !== 'word') return item;
    const w = data.words[item.position! - 1];
    return { kind: 'word', text: w.text, ...(w.variant ? { variant: w.variant } : {}) };
  });
}

const SAMPLE = [
  'Deut.29.22', // one-word ketiv/qere ו/צביים -> וּ/צְבוֹיִ֔ם
  'Gen.30.11', // one ketiv בגד, two qere words בָּ֣א גָ֑ד
  'Exod.4.2', // ketiv מזה, qere מַה־זֶּה with a maqaf inside the qere
  'Nah.1.3', // ketiv וגדול, qere וּגְדָל, then a maqaf after the whole unit
  'Job.38.1', // two ketiv words, two qere words with a paseq inside the qere
  'Neh.2.13', // maqaf before the ketiv, paseq inside the two-word qere
  'Isa.9.6', // ketiv לםרבה with a final mem mid-word
  'Dan.6.20', // ketiv/qere in Aramaic, no special letters in the WLC
];

describe('data matches the upstream WLC XML (ketiv/qere sample)', () => {
  it('the fixture has every sample verse', () => {
    expect([...upstream.keys()].sort()).toEqual([...SAMPLE].sort());
  });

  for (const osisId of SAMPLE) {
    it(`${osisId}: same words and marks, in XML order`, () => {
      expect(ours(osisId)).toEqual(expectedSequence(upstream.get(osisId)!));
    });
  }

  it('marks belong to no word: no joinNext, paseq, paragraphBreaks, terminator, scribalMarks', () => {
    for (const osisId of SAMPLE) {
      const [book, ch, v] = osisId.split('.');
      const data = JSON.parse(readFileSync(join(DATA, book, ch, `${v}.json`), 'utf-8'));
      expect(Object.keys(data.metadata)).toEqual(['sequence']);
      for (const w of data.words) expect(w.metadata?.joinNext).toBeUndefined();
    }
  });

  it('Nah 1:3: the maqaf of וּגְדָל־כֹּחַ follows the ketiv/qere unit as its own item', () => {
    const seq = ours('Nah.1.3');
    const i = seq.findIndex(x => x.kind === 'word' && x.variant === 'ketiv');
    const shape = seq.slice(i, i + 4).map(x => (x.kind === 'word' ? `word:${x.variant ?? ''}` : `mark:${x.type}`));
    expect(shape).toEqual(['word:ketiv', 'word:qere', 'mark:maqaf', 'word:']);
    expect(seq[i].text).toBe('וגדול');
  });
});
