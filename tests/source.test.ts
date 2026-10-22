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
  // connection is preserved via metadata.joinNext ('maqqef'). Verse gematria
  // totals are unaffected (sum of parts = whole); only word counts differ.
  it('splits בְּכָל־לְבָבְךָ into two words in Deut 6:5, with joinNext on the first', async () => {
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

    // The maqqef connection is recorded on the first element.
    expect(bekhol.metadata?.joinNext).toBe('maqqef');
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

describe('special-letter tradition layer (#2)', () => {
  const load = async (...p: string[]) =>
    JSON.parse(await readFile(join(__dirname, '..', 'data', 'openscriptures-OHB', ...p), 'utf-8'));
  const special = (w: { metadata?: { specialLetters?: Array<{ type: string; char: string; index: number; tradition?: string; source?: string }> } }) =>
    w.metadata?.specialLetters ?? [];

  it('adds the famous received-tradition majuscule — Genesis 1:1 large bet — cited', async () => {
    const d = await load('Gen', '1', '1.json');
    const sl = special(d.words.find((w: { position: number }) => w.position === 1));
    const bet = sl.find(s => s.type === 'large' && s.char === 'ב');
    expect(bet).toBeDefined();
    expect(bet!.index).toBe(0);
    expect(bet!.tradition).toBe('masoretic-received');
    expect(bet!.source).toMatch(/Jewish Encyclopedia/);
  });

  it('adds the small alef of Leviticus 1:1 (received tradition)', async () => {
    const d = await load('Lev', '1', '1.json');
    const sl = special(d.words.find((w: { position: number }) => w.position === 1));
    expect(sl.some(s => s.type === 'small' && s.char === 'א' && s.tradition === 'masoretic-received')).toBe(true);
  });

  it('tags the WLC’s own markings as leningrad and does NOT duplicate them', async () => {
    // Deut 6:4 large ayin is marked in the WLC itself.
    const d = await load('Deut', '6', '4.json');
    const sl = special(d.words.find((w: { position: number }) => w.position === 1));
    const ayin = sl.filter(s => s.type === 'large' && s.char === 'ע');
    expect(ayin).toHaveLength(1); // no duplicate supplement entry
    expect(ayin[0].tradition).toBe('leningrad');
    expect(ayin[0].source).toMatch(/WLC/);
  });

  it('every specialLetter carries a tradition + source', async () => {
    for (const [b, c, v] of [['Gen','1','1'],['Lev','1','1'],['Deut','6','4'],['1Chr','1','1'],['Prov','30','15']]) {
      const d = await load(b, c, `${v}.json`);
      for (const w of d.words as { metadata?: { specialLetters?: { tradition?: string; source?: string }[] } }[]) {
        for (const s of special(w)) {
          expect(s.tradition === 'leningrad' || s.tradition === 'masoretic-received').toBe(true);
          expect(typeof s.source).toBe('string');
        }
      }
    }
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

  it('records maqqef as per-word joinNext on the connecting word (Gen 1:2)', async () => {
    // עַל־פְּנֵי appears twice; each עַל connects to the following word.
    const data = await load('Gen', '1', '2.json');
    const joiners = data.words.filter(
      (w: { metadata?: { joinNext?: string } }) => w.metadata?.joinNext === 'maqqef'
    );
    expect(joiners.map((w: { position: number }) => w.position)).toEqual([6, 12]);
    expect(joiners.every((w: { text: string }) => extractConsonants(w.text) === 'על')).toBe(true);
  });

  it('records the sof-pasuq as a single verse-level terminator (Gen 1:2)', async () => {
    const data = await load('Gen', '1', '2.json');
    expect(data.metadata?.terminator).toBe('sof-pasuq');
  });

  it('records paseq as verse-level positions of the word it follows (Gen 1:5)', async () => {
    // paseq sits after word 2 (אֱלֹהִים).
    const data = await load('Gen', '1', '5.json');
    expect(data.metadata?.paseq).toEqual([2]);
  });

  it('resolves the Deut 6:5 maqqef example (בְּכָל joins its noun)', async () => {
    // The issue cited Deut 6:5 showing a bare space where maqqef belongs.
    const data = await load('Deut', '6', '5.json');
    const joiners = data.words
      .filter((w: { metadata?: { joinNext?: string } }) => w.metadata?.joinNext === 'maqqef')
      .map((w: { position: number }) => w.position);
    expect(joiners).toEqual([5, 7, 9]);
  });

  it('keeps the Shema large letters while adding the Deut 6:4 paseq', async () => {
    // Regression: special letters must survive alongside the new punctuation.
    const data = await load('Deut', '6', '4.json');
    expect(data.metadata?.paseq).toEqual([5]);
    const specials = data.words
      .filter((w: { metadata?: { specialLetters?: unknown[] } }) => w.metadata?.specialLetters)
      .map((w: { position: number }) => w.position);
    expect(specials).toEqual([1, 6]); // large ע (שְׁמַע) and large ד (אֶחָד)
  });

  it('omits the terminator for verses the WLC leaves open (Exod 34:6)', async () => {
    // A handful of verses carry no sof-pasuq in the source (e.g. the enjambed
    // divine-name formula of Exod 34:6). The field must reflect that faithfully.
    const data = await load('Exod', '34', '6.json');
    expect(data.metadata?.terminator).toBeUndefined();
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

    // A received-tradition point is metadata only: the Deut 29:28 ayin of עד
    // has a point entry, but its word text is the WLC text with no dot, so the
    // consonant stream (and so the gematria) is unchanged.
    const deut = await load('Deut','29','28.json');
    const ad = deut.words.find((x: { position: number }) => x.position === 7);
    expect(ad.text).toBe('\u05E2\u05B7\u05D3'); // עַד
    expect(/[\u05C4\u05C5]/.test(ad.text)).toBe(false);
    expect(extractConsonants(ad.text)).toBe('עד');
    expect(ad.metadata.points).toEqual([
      expect.objectContaining({ index: 0, char: 'ע', mark: 'upper', tradition: 'masoretic-received' }),
    ]);
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

  // Citations. Avot de-Rabbi Natan (A) 34 and Sifre Numbers 69 list the ten
  // Torah passages; ARN 34 also names the dotted letters. Brouwer lists all
  // fifteen passages with the dotted letters and notes variant witnesses.
  const SOURCES = {
    WLC: 'WLC / OpenScriptures (Leningrad Codex)',
    ARN34: 'Avot de-Rabbi Natan (A) 34',
    SIFRE69: 'Sifre Numbers 69',
    BROUWER: 'A.E. Brouwer, "Typographic details in the Hebrew Bible" (https://aeb.win.tue.nl/natlang/hebrew/hebrew_bible.html)',
  } as const;

  type Mark = 'upper' | 'lower';
  type Dot = [index: number, char: string, mark: Mark];
  interface Word {
    position: number;
    /** The word's consonants. */
    word: string;
    /** Dots in the WLC text (tradition 'leningrad'). */
    leningrad: Dot[];
    /** Dots of the received tradition (leningrad dots not marked received:false, plus masoretic-received dots). */
    received: Dot[];
  }
  interface Passage {
    ref: [book: string, chapter: string, verse: string];
    words: Word[];
    sources: (keyof typeof SOURCES)[];
    /** Known differences between witnesses, recorded rather than resolved. */
    note?: string;
  }

  const up = (letters: string, from = 0): Dot[] => [...letters].map((c, i) => [from + i, c, 'upper']);

  const PASSAGES: Passage[] = [
    { ref: ['Gen', '16', '5'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 19, word: 'וביניך', leningrad: [[4, 'י', 'upper']], received: [[4, 'י', 'upper']] }],
      note: 'ARN 34 names "the yod of ביניך"; Brouwer places it on the second yod.' },
    { ref: ['Gen', '18', '9'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 2, word: 'אליו', leningrad: up('אליו'),
        received: [[0, 'א', 'upper'], [2, 'י', 'upper'], [3, 'ו', 'upper']] }],
      note: 'ARN 34 and Brouwer: א, י, ו (3 dots). The WLC (and BHS, per Brouwer) also dots the ל; that dot is received:false.' },
    { ref: ['Gen', '19', '33'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 15, word: 'ובקומה', leningrad: [[2, 'ק', 'upper']], received: [[3, 'ו', 'upper']] }],
      note: 'ARN 34 and Brouwer: the vav of בקומה. The WLC text has U+05C4 after the ק (קׄוּ).' },
    { ref: ['Gen', '33', '4'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 8, word: 'וישקהו', leningrad: up('וישקהו'), received: up('וישקהו') }] },
    { ref: ['Gen', '37', '12'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 4, word: 'את', leningrad: up('את'), received: up('את') }] },
    { ref: ['Num', '3', '39'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 7, word: 'ואהרן', leningrad: up('ואהרן'), received: up('ואהרן') }],
      note: 'ARN 34 says "dotted on אהרן" without saying whether the conjunction ו is dotted; Brouwer and the WLC dot all five letters.' },
    { ref: ['Num', '9', '10'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 14, word: 'רחקה', leningrad: [[3, 'ה', 'upper']], received: [[3, 'ה', 'upper']] }] },
    { ref: ['Num', '21', '30'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 9, word: 'אשר', leningrad: [[2, 'ר', 'upper']], received: [[2, 'ר', 'upper']] }] },
    { ref: ['Num', '29', '15'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [{ position: 1, word: 'ועשרון', leningrad: [[3, 'ר', 'upper']], received: [[4, 'ו', 'upper']] }],
      note: 'ARN 34 and Brouwer: the vav of עשרון. The WLC text has U+05C4 after the ר (רׄוֹ).' },
    { ref: ['Deut', '29', '28'], sources: ['WLC', 'ARN34', 'SIFRE69', 'BROUWER'],
      words: [
        { position: 5, word: 'לנו', leningrad: up('לנו'), received: up('לנו') },
        { position: 6, word: 'ולבנינו', leningrad: up('ולבנינו'), received: up('ולבנינו') },
        { position: 7, word: 'עד', leningrad: [], received: [[0, 'ע', 'upper']] },
      ],
      note: 'ARN 34 and Brouwer: 11 dots, including the ע of עד. The WLC (and BHS, per Brouwer) has 10.' },
    { ref: ['2Sam', '19', '20'], sources: ['WLC', 'BROUWER'],
      words: [{ position: 17, word: 'יצא', leningrad: up('יצא'), received: up('יצא') }],
      note: 'Brouwer: 3 dots; the Mechon-Mamre text, as Brouwer cites it, dots only י and א.' },
    { ref: ['Isa', '44', '9'], sources: ['WLC', 'BROUWER'],
      words: [{ position: 9, word: 'המה', leningrad: up('המה'), received: up('המה') }] },
    { ref: ['Ezek', '41', '20'], sources: ['WLC', 'BROUWER'],
      words: [{ position: 9, word: 'ההיכל', leningrad: up('ההיכל'), received: up('ההיכל') }],
      note: 'Brouwer: 5 dots; the Letteris edition (Berlin 1925), as Brouwer cites it, dots only ההכל.' },
    { ref: ['Ezek', '46', '22'], sources: ['WLC', 'BROUWER'],
      words: [{ position: 13, word: 'מהקצעות', leningrad: up('מהקצעות'), received: up('מהקצעות') }] },
    { ref: ['Ps', '27', '13'], sources: ['WLC', 'BROUWER'],
      words: [{ position: 1, word: 'לולא',
        leningrad: [[0, 'ל', 'upper'], [0, 'ל', 'lower'], [2, 'ל', 'upper'], [2, 'ל', 'lower'], [3, 'א', 'upper'], [3, 'א', 'lower']],
        received: [[0, 'ל', 'upper'], [0, 'ל', 'lower'], [2, 'ל', 'upper'], [2, 'ל', 'lower'], [3, 'א', 'upper'], [3, 'א', 'lower']] }],
      note: 'Brouwer: 3 upper + 3 lower on ל, ל, א; the Mechon-Mamre text, as Brouwer cites it, has upper dots on all four letters and no lower; Brouwer notes 4+4 is also seen.' },
  ];

  interface Point { index: number; char: string; mark: Mark; tradition?: string; source?: string; received?: boolean; receivedSource?: string }
  interface WordData { position: number; text: string; metadata?: { points?: Point[] } }
  const dot = (p: Point): Dot => [p.index, p.char, p.mark];
  const sortDots = (d: Dot[]) => [...d].sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]));

  it('lists fifteen passages, ten of them in the Torah', () => {
    expect(PASSAGES).toHaveLength(15);
    const torah = PASSAGES.filter(p => ['Gen', 'Exod', 'Lev', 'Num', 'Deut'].includes(p.ref[0]));
    expect(torah).toHaveLength(10);
    for (const p of torah) expect(p.sources).toContain('ARN34');
  });

  for (const p of PASSAGES) {
    const [b, c, v] = p.ref;
    it(`${b} ${c}:${v}: exact dotted letters (${p.sources.join(', ')})`, async () => {
      const d = await load(b, c, `${v}.json`);
      const words = d.words as WordData[];
      for (const exp of p.words) {
        const w = words.find(x => x.position === exp.position)!;
        expect(w, `${b} ${c}:${v} word ${exp.position}`).toBeDefined();
        expect(extractConsonants(w.text)).toBe(exp.word);
        const points = w.metadata?.points ?? [];
        expect(sortDots(points.filter(x => x.tradition === 'leningrad').map(dot))).toEqual(sortDots(exp.leningrad));
        expect(sortDots(points.filter(x => x.received !== false).map(dot))).toEqual(sortDots(exp.received));
      }
      // No other word in the verse carries points.
      const listed = new Set(p.words.map(x => x.position));
      expect(words.filter(x => x.metadata?.points && !listed.has(x.position)).map(x => x.position)).toEqual([]);
    });
  }

  it('the leningrad points are exactly the dots in the word text', async () => {
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
        const len = (w.metadata?.points ?? []).filter(x => x.tradition === 'leningrad').map(dot);
        expect(sortDots(len)).toEqual(sortDots(fromText));
      }
    }
  });

  it('every point carries a tradition and a source; received:false carries its own citation', async () => {
    for (const p of PASSAGES) {
      const d = await load(p.ref[0], p.ref[1], `${p.ref[2]}.json`);
      for (const w of d.words as WordData[]) {
        for (const pt of w.metadata?.points ?? []) {
          expect(['leningrad', 'masoretic-received']).toContain(pt.tradition);
          expect(typeof pt.source).toBe('string');
          if (pt.tradition === 'leningrad') expect(pt.source).toBe('WLC / OpenScriptures');
          else expect(pt.source).toMatch(/Avot de-Rabbi Natan/);
          if (pt.received === false) {
            expect(pt.tradition).toBe('leningrad');
            expect(pt.receivedSource).toMatch(/Avot de-Rabbi Natan/);
          } else {
            expect(pt.received).toBeUndefined();
            expect(pt.receivedSource).toBeUndefined();
          }
        }
      }
    }
  });

  it('the data reflects every entry of the points supplement overlay', async () => {
    const overlay = JSON.parse(
      await readFile(join(__dirname, '..', 'scripts', 'overlays', 'points-supplement.json'), 'utf-8')
    );
    for (const e of overlay.entries) {
      const d = await load(e.book, String(e.chapter), `${e.verse}.json`);
      const w = (d.words as WordData[]).find(x => x.position === e.position)!;
      const pt = (w.metadata?.points ?? []).find(x => x.index === e.index && x.mark === e.mark)!;
      expect(pt, `${e.book} ${e.chapter}:${e.verse}`).toBeDefined();
      expect(pt.char).toBe(e.char);
      if (e.kind === 'add') expect(pt.tradition).toBe('masoretic-received');
      else expect(pt.received).toBe(false);
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
