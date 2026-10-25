/**
 * Tests for @metaxia/scriptures-source-openscriptures-ohb
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Extract only Hebrew consonants (removes vowels, cantillation, etc.)
function extractConsonants(text: string): string {
  return text.replace(/[^\u05D0-\u05EA]/g, '');
}

type SeqItem = { kind: 'word'; position: number } | { kind: 'mark'; type: string; text: string; reading?: string };
/** The positions of the words that each mark of `type` follows in metadata.sequence. */
function marksAfter(data: { metadata: { sequence: SeqItem[] } }, type: string): number[] {
  const out: number[] = [];
  let last = 0;
  for (const i of data.metadata.sequence) {
    if (i.kind === 'word') last = i.position;
    else if (i.type === type) out.push(last);
  }
  return out;
}

describe('word data', () => {
  it('should have Israel word at correct position in Genesis 32:29', async () => {
    // Genesis 32:29 contains יִשְׂרָאֵל (Israel) at position 9
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '32', '29.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const israelWord = data.words.find(
      (word: { position: number }) => word.position === 9
    );

    expect(israelWord).toBeDefined();
    // Extract consonants to compare (text now includes vowels and cantillation)
    expect(extractConsonants(israelWord.text)).toBe('ישראל'); // Israel in Hebrew
  });
});

describe('maqqef word segmentation (#3)', () => {
  // Decision (finalized): maqqef-joined units are kept as SEPARATE words — each
  // maqqef element has its own lexical identity + Strong's, so its own box. The
  // connection is preserved as a maqaf item in metadata.sequence. Verse gematria
  // totals are unaffected (sum of parts = whole); only word counts differ.
  it('splits בְּכָל־לְבָבְךָ into two words in Deut 6:5, with a maqaf item between them', async () => {
    const data = JSON.parse(
      await readFile(join(__dirname, '..', 'data', 'openscriptures-OHB', 'Deut', '6', '5.json'), 'utf-8')
    );
    const cons = (s: string) => s.replace(/[^א-ת]/g, '');

    // The two joined elements are present as separate, adjacent words.
    const bekhol = data.words.find((w: { text: string }) => cons(w.text) === 'בכל');
    const levavkha = data.words.find((w: { text: string }) => cons(w.text) === 'לבבך');
    expect(bekhol).toBeDefined();
    expect(levavkha).toBeDefined();
    expect(levavkha.position).toBe(bekhol.position + 1);

    // The joined unit never appears as a single token.
    const joined = data.words.find((w: { text: string }) => cons(w.text) === 'בכללבבך');
    expect(joined).toBeUndefined();

    // The maqaf is its own item between the two words.
    expect(marksAfter(data, 'maqaf')).toContain(bekhol.position);
    expect(bekhol.metadata?.joinNext).toBeUndefined();
  });
});

describe('maqqef punctuation handling', () => {
  it('should not include maqqef marks as separate word entries', async () => {
    // Genesis 1:2 contains maqqef (־) connecting words like "al-penei"
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Hebrew maqqef character (U+05BE)
    const MAQQEF = '־';

    const maqqefWords = data.words.filter(
      (word: { text: string }) => word.text === MAQQEF
    );

    expect(maqqefWords).toHaveLength(0);
  });

  it('should not have words with null lemma that are punctuation-only', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Words with null lemma should still have Hebrew text content
    const nullLemmaWords = data.words.filter(
      (word: { lemma: string | null; text: string }) =>
        word.lemma === null
    );

    // All null-lemma words should have actual Hebrew content
    for (const word of nullLemmaWords) {
      expect(word.text.length).toBeGreaterThan(0);
    }
  });
});

describe('special letters: WLC only (3.0.0)', () => {
  const load = async (...p: string[]) =>
    JSON.parse(await readFile(join(__dirname, '..', 'data', 'openscriptures-OHB', ...p), 'utf-8'));
  const special = (w: { metadata?: { specialLetters?: Array<{ type: string; char: string; index: number; tradition?: string; source?: string }> } }) =>
    w.metadata?.specialLetters ?? [];

  it('no received-tradition letters: Gen 1:1 bet and Lev 1:1 alef are unmarked', async () => {
    for (const [b, c, v] of [['Gen', '1', '1'], ['Lev', '1', '1']]) {
      const d = await load(b, c, `${v}.json`);
      for (const w of d.words) expect(special(w), `${b} ${c}:${v}`).toEqual([]);
    }
  });

  it('tags the WLC’s own markings as leningrad, once each', async () => {
    // Deut 6:4 large ayin is marked in the WLC itself.
    const d = await load('Deut', '6', '4.json');
    const sl = special(d.words.find((w: { position: number }) => w.position === 1));
    expect(sl).toHaveLength(1);
    expect(sl[0]).toMatchObject({ type: 'large', char: 'ע', index: 2, tradition: 'leningrad' });
    expect(sl[0].source).toMatch(/WLC/);
  });
});

describe('Masoretic punctuation preservation (#5)', () => {
  const load = async (...p: string[]) =>
    JSON.parse(
      await readFile(join(__dirname, '..', 'data', 'openscriptures-OHB', ...p), 'utf-8')
    );

  // The three Masoretic marks that this feature preserves as structural metadata.
  const MAQQEF = '־';
  const SOF_PASUQ = '׃';
  const PASEQ = '׀';

  it('records each maqaf as a sequence item after the word it follows (Gen 1:2)', async () => {
    // עַל־פְּנֵי appears twice; each עַל is followed by a maqaf.
    const data = await load('Gen', '1', '2.json');
    expect(marksAfter(data, 'maqaf')).toEqual([6, 12]);
    for (const p of [6, 12]) expect(extractConsonants(data.words[p - 1].text)).toBe('על');
    expect(data.words.some((w: { metadata?: { joinNext?: string } }) => w.metadata?.joinNext)).toBe(false);
  });

  it('records the sof-pasuq as the last item (Gen 1:2)', async () => {
    const data = await load('Gen', '1', '2.json');
    expect(data.metadata.sequence.at(-1)).toEqual({ kind: 'mark', type: 'sof-pasuq', text: SOF_PASUQ });
    expect(data.metadata.terminator).toBeUndefined();
  });

  it('records paseq as an item after the word it follows (Gen 1:5)', async () => {
    // paseq sits after word 2 (אֱלֹהִים).
    const data = await load('Gen', '1', '5.json');
    expect(marksAfter(data, 'paseq')).toEqual([2]);
    expect(data.metadata.paseq).toBeUndefined();
  });

  it('resolves the Deut 6:5 maqqef example (בְּכָל joins its noun)', async () => {
    const data = await load('Deut', '6', '5.json');
    expect(marksAfter(data, 'maqaf')).toEqual([5, 7, 9]);
  });

  it('keeps the Shema large letters alongside the Deut 6:4 paseq', async () => {
    const data = await load('Deut', '6', '4.json');
    expect(marksAfter(data, 'paseq')).toEqual([5]);
    const specials = data.words
      .filter((w: { metadata?: { specialLetters?: unknown[] } }) => w.metadata?.specialLetters)
      .map((w: { position: number }) => w.position);
    expect(specials).toEqual([1, 6]); // large ע (שְׁמַע) and large ד (אֶחָד)
  });

  it('has no sof-pasuq item for verses the WLC leaves open (Exod 34:6)', async () => {
    // A handful of verses carry no sof-pasuq in the source (e.g. the enjambed
    // divine-name formula of Exod 34:6).
    const data = await load('Exod', '34', '6.json');
    expect(marksAfter(data, 'sof-pasuq')).toEqual([]);
  });

  it('surfaces extraordinary points (puncta) on exactly the 15 dotted verses', async () => {
    const dotted = [
      ['Gen','16','5'],['Gen','18','9'],['Gen','19','33'],['Gen','33','4'],['Gen','37','12'],
      ['Num','3','39'],['Num','9','10'],['Num','21','30'],['Num','29','15'],['Deut','29','28'],
      ['2Sam','19','20'],['Isa','44','9'],['Ezek','41','20'],['Ezek','46','22'],['Ps','27','13'],
    ];
    for (const [b,c,v] of dotted) {
      const d = await load(b,c,`${v}.json`);
      const withPoints = d.words.filter((w:{metadata?:{points?:unknown[]}}) => w.metadata?.points);
      expect(withPoints.length).toBeGreaterThan(0);
    }
  });

  it('records the dotted consonant precisely (Num 21:30 = resh only; Gen 33:4 = all six)', async () => {
    const num = await load('Num','21','30.json');
    const resh = num.words.find((w:{metadata?:{points?:{index:number;char:string;mark:string}[]}}) => w.metadata?.points);
    expect(
      resh.metadata.points.map(({ index, char, mark }: { index: number; char: string; mark: string }) => ({ index, char, mark }))
    ).toEqual([{ index: 2, char: 'ר', mark: 'upper' }]);

    const gen = await load('Gen','33','4.json');
    const kissed = gen.words.find((w:{metadata?:{points?:unknown[]}}) => w.metadata?.points);
    expect(kissed.metadata.points.map((p:{index:number}) => p.index)).toEqual([0,1,2,3,4,5]);
    expect(kissed.metadata.points.every((p:{mark:string}) => p.mark === 'upper')).toBe(true);
  });

  it('keeps extraordinary points out of the gematria consonant stream', async () => {
    // The dots (U+05C4/U+05C5) are combining marks; stripping them must not
    // change the extracted consonants.
    const d = await load('Ps','27','13.json');
    const w = d.words.find((x:{metadata?:{points?:unknown[]}}) => x.metadata?.points);
    const bare = w.text.replace(/[ׅׄ]/g, '');
    expect(extractConsonants(w.text)).toBe(extractConsonants(bare));

    // Only the WLC's own dots are recorded: the ayin of עד in Deut 29:28 has no
    // dot in the WLC, so it carries no point.
    const deut = await load('Deut','29','28.json');
    const ad = deut.words.find((x: { position: number }) => x.position === 7);
    expect(ad.text).toBe('\u05E2\u05B7\u05D3'); // עַד
    expect(/[\u05C4\u05C5]/.test(ad.text)).toBe(false);
    expect(ad.metadata.points).toBeUndefined();
    expect(extractConsonants(deut.text)).toBe(extractConsonants(deut.text.replace(/[\u05C4\u05C5]/g, '')));
  });

  it('never leaks a punctuation glyph into word text (gematria integrity)', async () => {
    // Punctuation is metadata only; valued word text must stay glyph-free so
    // gematria totals and word counts are untouched.
    for (const [b, c, v] of [
      ['Gen', '1', '2'],
      ['Gen', '1', '5'],
      ['Deut', '6', '4'],
      ['Deut', '6', '5'],
    ]) {
      const data = await load(b, c, `${v}.json`);
      for (const w of data.words as { text: string }[]) {
        expect(w.text.includes(MAQQEF)).toBe(false);
        expect(w.text.includes(SOF_PASUQ)).toBe(false);
        expect(w.text.includes(PASEQ)).toBe(false);
      }
      expect(data.text.includes(MAQQEF)).toBe(false);
      expect(data.text.includes(SOF_PASUQ)).toBe(false);
      expect(data.text.includes(PASEQ)).toBe(false);
    }
  });
});


describe('extraordinary points: the fifteen passages, letter by letter', () => {
  const DATA = join(__dirname, '..', 'data', 'openscriptures-OHB');
  const load = async (...p: string[]) => JSON.parse(await readFile(join(DATA, ...p), 'utf-8'));

  // The dots exactly as the WLC text carries them (U+05C4 upper, U+05C5 lower).
  // Since 3.0.0 the package records no other tradition's dots.
  type Mark = 'upper' | 'lower';
  type Dot = [index: number, char: string, mark: Mark];
  interface Word {
    position: number;
    /** The word's consonants. */
    word: string;
    /** Dots in the WLC text. */
    leningrad: Dot[];
  }
  interface Passage {
    ref: [book: string, chapter: string, verse: string];
    words: Word[];
  }

  const up = (letters: string, from = 0): Dot[] => [...letters].map((c, i) => [from + i, c, 'upper']);

  const PASSAGES: Passage[] = [
    { ref: ['Gen', '16', '5'], words: [{ position: 19, word: 'וביניך', leningrad: [[4, 'י', 'upper']] }] },
    { ref: ['Gen', '18', '9'], words: [{ position: 2, word: 'אליו', leningrad: up('אליו') }] },
    // The WLC text has U+05C4 after the ק (קׄוּ).
    { ref: ['Gen', '19', '33'], words: [{ position: 15, word: 'ובקומה', leningrad: [[2, 'ק', 'upper']] }] },
    { ref: ['Gen', '33', '4'], words: [{ position: 8, word: 'וישקהו', leningrad: up('וישקהו') }] },
    { ref: ['Gen', '37', '12'], words: [{ position: 4, word: 'את', leningrad: up('את') }] },
    { ref: ['Num', '3', '39'], words: [{ position: 7, word: 'ואהרן', leningrad: up('ואהרן') }] },
    { ref: ['Num', '9', '10'], words: [{ position: 14, word: 'רחקה', leningrad: [[3, 'ה', 'upper']] }] },
    { ref: ['Num', '21', '30'], words: [{ position: 9, word: 'אשר', leningrad: [[2, 'ר', 'upper']] }] },
    // The WLC text has U+05C4 after the ר (רׄוֹ).
    { ref: ['Num', '29', '15'], words: [{ position: 1, word: 'ועשרון', leningrad: [[3, 'ר', 'upper']] }] },
    { ref: ['Deut', '29', '28'], words: [
        { position: 5, word: 'לנו', leningrad: up('לנו') },
        { position: 6, word: 'ולבנינו', leningrad: up('ולבנינו') },
      ] },
    { ref: ['2Sam', '19', '20'], words: [{ position: 17, word: 'יצא', leningrad: up('יצא') }] },
    { ref: ['Isa', '44', '9'], words: [{ position: 9, word: 'המה', leningrad: up('המה') }] },
    { ref: ['Ezek', '41', '20'], words: [{ position: 9, word: 'ההיכל', leningrad: up('ההיכל') }] },
    { ref: ['Ezek', '46', '22'], words: [{ position: 13, word: 'מהקצעות', leningrad: up('מהקצעות') }] },
    { ref: ['Ps', '27', '13'], words: [{ position: 1, word: 'לולא',
        leningrad: [[0, 'ל', 'upper'], [0, 'ל', 'lower'], [2, 'ל', 'upper'], [2, 'ל', 'lower'], [3, 'א', 'upper'], [3, 'א', 'lower']] }] },
  ];

  interface Point { index: number; char: string; mark: Mark; tradition?: string; source?: string; [k: string]: unknown }
  interface WordData { position: number; text: string; metadata?: { points?: Point[] } }
  const dot = (p: Point): Dot => [p.index, p.char, p.mark];
  const sortDots = (d: Dot[]) => [...d].sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]));

  it('lists fifteen passages, ten of them in the Torah', () => {
    expect(PASSAGES).toHaveLength(15);
    expect(PASSAGES.filter(p => ['Gen', 'Exod', 'Lev', 'Num', 'Deut'].includes(p.ref[0]))).toHaveLength(10);
  });

  for (const p of PASSAGES) {
    const [b, c, v] = p.ref;
    it(`${b} ${c}:${v}: exact dotted letters (WLC)`, async () => {
      const d = await load(b, c, `${v}.json`);
      const words = d.words as WordData[];
      for (const exp of p.words) {
        const w = words.find(x => x.position === exp.position)!;
        expect(w, `${b} ${c}:${v} word ${exp.position}`).toBeDefined();
        expect(extractConsonants(w.text)).toBe(exp.word);
        expect(sortDots((w.metadata?.points ?? []).map(dot))).toEqual(sortDots(exp.leningrad));
      }
      // No other word in the verse carries points.
      const listed = new Set(p.words.map(x => x.position));
      expect(words.filter(x => x.metadata?.points && !listed.has(x.position)).map(x => x.position)).toEqual([]);
    });
  }

  it('the points are exactly the dots in the word text', async () => {
    for (const p of PASSAGES) {
      const d = await load(p.ref[0], p.ref[1], `${p.ref[2]}.json`);
      for (const w of d.words as WordData[]) {
        const fromText: Dot[] = [];
        let i = -1;
        let base = '';
        for (const ch of w.text) {
          const cp = ch.codePointAt(0)!;
          if (cp >= 0x05d0 && cp <= 0x05ea) { i++; base = ch; }
          else if (ch === 'ׄ') fromText.push([i, base, 'upper']);
          else if (ch === 'ׅ') fromText.push([i, base, 'lower']);
        }
        expect(sortDots((w.metadata?.points ?? []).map(dot))).toEqual(sortDots(fromText));
      }
    }
  });

  it('every point is the WLC\'s own: tradition leningrad, source WLC, no other fields', async () => {
    for (const p of PASSAGES) {
      const d = await load(p.ref[0], p.ref[1], `${p.ref[2]}.json`);
      for (const w of d.words as WordData[]) {
        for (const pt of w.metadata?.points ?? []) {
          expect(Object.keys(pt).sort()).toEqual(['char', 'index', 'mark', 'source', 'tradition']);
          expect(pt.tradition).toBe('leningrad');
          expect(pt.source).toBe('WLC / OpenScriptures');
        }
      }
    }
  });

  it('only the fifteen passages carry points anywhere in the corpus', async () => {
    const expected = new Set(PASSAGES.map(p => p.ref.join('.')));
    const found = new Set<string>();
    for (const book of await readdir(DATA)) {
      if (book.endsWith('.json')) continue;
      for (const chap of await readdir(join(DATA, book))) {
        for (const file of await readdir(join(DATA, book, chap))) {
          const raw = await readFile(join(DATA, book, chap, file), 'utf-8');
          if (raw.includes('"points"') || /[ׅׄ]/.test(raw)) found.add(`${book}.${chap}.${file.replace(/\.json$/, '')}`);
        }
      }
    }
    expect([...found].sort()).toEqual([...expected].sort());
  }, 120_000);
});
