/**
 * Tests for @metaxia/scriptures-source-openscriptures-ohb
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
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
    expect(resh.metadata.points).toEqual([{ index: 2, char: 'ר', mark: 'upper' }]);

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
