/**
 * Tests for the import script parsing logic
 *
 * These tests verify that:
 * 1. The current data has null lemmas (documenting the bug)
 * 2. The parsing logic correctly handles ketiv/qere variants
 * 3. Alternative accent notes don't create duplicate words
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simplified types for testing
interface WordEntry {
  position: number;
  text: string;
  lemma: string | null;
  morph: string | null;
  strongs?: string[];
  metadata?: Record<string, unknown>;
}

interface ParsedVerse {
  book: string;
  chapter: number;
  number: number;
  text: string;
  words: WordEntry[];
}

// Hebrew maqqef character (U+05BE)
const MAQQEF = '\u05BE';

function removeCantillation(text: string): string {
  return text.replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C6]/g, '');
}

const STRONGS_RE = /(?:strongs?:)?([HGhg]?\d{1,5})/g;

function extractStrongs(value: string | null): string[] {
  if (!value) return [];
  const results: string[] = [];
  let match;
  STRONGS_RE.lastIndex = 0;
  while ((match = STRONGS_RE.exec(value)) !== null) {
    const token = match[1];
    let prefix = '';
    if (token[0] && 'HGhg'.includes(token[0])) {
      prefix = token[0].toUpperCase();
    }
    const digits = token.match(/\d{1,5}/);
    if (!digits) continue;
    if (!prefix) prefix = 'H';
    results.push(`${prefix}${parseInt(digits[0], 10)}`);
  }
  return results;
}

/**
 * OLD BROKEN LOGIC - for comparison testing
 * This is how the parser worked BEFORE the fix
 */
function parseOsisBroken(xml: string): ParsedVerse[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false,
  });

  const doc = parser.parse(xml);
  const verses: ParsedVerse[] = [];

  function findVerses(obj: unknown, results: ParsedVerse[]): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        findVerses(item, results);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    if (record['@_osisID'] && typeof record['@_osisID'] === 'string') {
      const osisId = record['@_osisID'];
      const parts = osisId.split('.');
      if (parts.length === 3) {
        const [book, chap, num] = parts;
        const words: WordEntry[] = [];
        let pos = 1;

        function extractWords(content: unknown): void {
          if (!content) return;

          if (typeof content === 'string') {
            const cleanText = removeCantillation(content.replace(/\//g, '').trim());
            if (cleanText) {
              for (const word of cleanText.split(/\s+/).filter(Boolean)) {
                if (word === MAQQEF) continue;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
                });
              }
            }
            return;
          }

          if (Array.isArray(content)) {
            for (const item of content) {
              extractWords(item);
            }
            return;
          }

          if (typeof content === 'object') {
            const elem = content as Record<string, unknown>;

            if (elem['#text']) {
              // OLD BUG: Skip ALL elements with @_type, including x-ketiv
              if (elem['@_type']) {
                return;
              }

              const rawText = String(elem['#text']);
              const text = removeCantillation(rawText.replace(/\//g, '')).trim();
              const lemma = elem['@_lemma'] as string | undefined;
              const morph = elem['@_morph'] as string | undefined;

              if (text) {
                const strongs = extractStrongs(lemma || null);
                for (const piece of text.split(/\s+/).filter(Boolean)) {
                  if (piece === MAQQEF) continue;
                  words.push({
                    position: pos++,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                  });
                }
              }
            }

            // OLD BUG: Recurse into ALL children including note/catchWord/rdg
            for (const [key, value] of Object.entries(elem)) {
              if (!key.startsWith('@_') && key !== '#text') {
                extractWords(value);
              }
            }
          }
        }

        for (const [key, value] of Object.entries(record)) {
          if (!key.startsWith('@_')) {
            extractWords(value);
          }
        }

        if (words.length > 0) {
          const text = words.map(w => w.text).join(' ');
          results.push({
            book,
            chapter: parseInt(chap, 10),
            number: parseInt(num, 10),
            text,
            words,
          });
        }
      }
    }

    for (const value of Object.values(record)) {
      findVerses(value, results);
    }
  }

  findVerses(doc, verses);
  return verses;
}

/**
 * NEW FIXED LOGIC - extracts ketiv/qere with proper metadata
 * This mirrors the actual import.ts logic
 */
function parseOsisFixed(xml: string): ParsedVerse[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false,
  });

  const doc = parser.parse(xml);
  const verses: ParsedVerse[] = [];

  function findVerses(obj: unknown, results: ParsedVerse[]): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        findVerses(item, results);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    if (record['@_osisID'] && typeof record['@_osisID'] === 'string') {
      const osisId = record['@_osisID'];
      const parts = osisId.split('.');
      if (parts.length === 3) {
        const [book, chap, num] = parts;
        const words: WordEntry[] = [];
        let pos = 1;
        let isInsideQere = false;

        function processRdg(rdgValue: unknown): void {
          if (!rdgValue) return;
          const rdgArray = Array.isArray(rdgValue) ? rdgValue : [rdgValue];
          for (const rdg of rdgArray) {
            if (rdg && typeof rdg === 'object') {
              const rdgObj = rdg as Record<string, unknown>;
              const rdgType = rdgObj['@_type'] as string | undefined;
              // Only process x-qere readings (skip x-accent)
              if (rdgType === 'x-qere') {
                const prevIsInsideQere = isInsideQere;
                isInsideQere = true;
                extractWords(rdg);
                isInsideQere = prevIsInsideQere;
              }
            }
          }
        }

        function extractWords(content: unknown): void {
          if (!content) return;

          if (typeof content === 'string') {
            const cleanText = removeCantillation(content.replace(/\//g, '').trim());
            if (cleanText) {
              for (const word of cleanText.split(/\s+/).filter(Boolean)) {
                if (word === MAQQEF) continue;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
                  metadata: {},
                });
              }
            }
            return;
          }

          if (Array.isArray(content)) {
            for (const item of content) {
              extractWords(item);
            }
            return;
          }

          if (typeof content === 'object') {
            const elem = content as Record<string, unknown>;

            if (elem['#text']) {
              const elemType = elem['@_type'] as string | undefined;

              // FIX: Only skip segment types, NOT x-ketiv or x-qere
              if (elemType && elemType.startsWith('x-')) {
                // Allow ketiv and qere types through
                if (elemType !== 'x-ketiv' && elemType !== 'x-qere') {
                  return;
                }
              }

              const rawText = String(elem['#text']);
              const text = removeCantillation(rawText.replace(/\//g, '')).trim();
              const lemma = elem['@_lemma'] as string | undefined;
              const morph = elem['@_morph'] as string | undefined;

              if (text) {
                const strongs = extractStrongs(lemma || null);
                for (const piece of text.split(/\s+/).filter(Boolean)) {
                  if (piece === MAQQEF) continue;

                  // Determine variant type for Qere/Ketiv
                  let variant: 'ketiv' | 'qere' | undefined;
                  if (elemType === 'x-ketiv') {
                    variant = 'ketiv';
                  } else if (isInsideQere) {
                    variant = 'qere';
                  }

                  words.push({
                    position: pos++,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                    variant,
                  });
                }
              }
            }

            for (const [key, value] of Object.entries(elem)) {
              // Skip catchWord (redundant copy of ketiv text)
              if (key === 'catchWord') {
                continue;
              }
              // Handle rdg elements specially
              if (key === 'rdg') {
                processRdg(value);
                continue;
              }
              // Process note's rdg children but skip other note content
              if (key === 'note') {
                const noteArray = Array.isArray(value) ? value : [value];
                for (const note of noteArray) {
                  if (note && typeof note === 'object') {
                    const noteObj = note as Record<string, unknown>;
                    if (noteObj['rdg']) {
                      processRdg(noteObj['rdg']);
                    }
                  }
                }
                continue;
              }
              if (!key.startsWith('@_') && key !== '#text') {
                extractWords(value);
              }
            }
          }
        }

        for (const [key, value] of Object.entries(record)) {
          if (!key.startsWith('@_')) {
            extractWords(value);
          }
        }

        if (words.length > 0) {
          const text = words.map(w => w.text).join(' ');
          results.push({
            book,
            chapter: parseInt(chap, 10),
            number: parseInt(num, 10),
            text,
            words,
          });
        }
      }
    }

    for (const value of Object.values(record)) {
      findVerses(value, results);
    }
  }

  findVerses(doc, verses);
  return verses;
}

// Sample XML representing Genesis 8:17 ketiv/qere pattern
const KETIV_QERE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Gen.8.17">
  <w lemma="3605" morph="HNcmsc">כָּל</w>
  <w type="x-ketiv" lemma="3318" morph="HVhv2ms">הוצא</w>
  <note type="variant">
    <catchWord>הוצא</catchWord>
    <rdg type="x-qere">
      <w lemma="3318" morph="HVhv2ms">הַיְצֵא</w>
    </rdg>
  </note>
  <w lemma="854" morph="HR/Sp2fs">אִתָּךְ</w>
</verse>`;

// Sample XML representing Exodus 20:2 alternative accent pattern
const ALTERNATIVE_ACCENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Exod.20.2">
  <w lemma="595" morph="HPp1cs">אָנֹכִי</w>
  <note type="alternative">
    <catchWord>אָנֹכִי</catchWord>
    <rdg type="x-accent">אָנֹכִי</rdg>
  </note>
  <w lemma="3068" morph="HNp">יְהוָה</w>
  <w lemma="430" morph="HNcmpc/Sp2ms">אֱלֹהֶיךָ</w>
  <note type="alternative">
    <catchWord>אֱלֹהֶיךָ</catchWord>
    <rdg type="x-accent">אֱלֹהֶיךָ</rdg>
  </note>
</verse>`;

describe('import script parsing - old vs new behavior', () => {
  it('OLD LOGIC: skips ketiv element (type=x-ketiv)', () => {
    const verses = parseOsisBroken(KETIV_QERE_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Old logic skips x-ketiv elements, so "הוצא" ketiv is missing its lemma
    // But it might still appear from catchWord extraction
    const ketivText = 'הוצא';
    const ketivWords = verse.words.filter(w => w.text === ketivText);

    // If ketiv is found, it should NOT have lemma (from catchWord)
    // or not be found at all (skipped)
    for (const w of ketivWords) {
      // Old logic would give null lemma from catchWord
      expect(w.lemma).toBeNull();
    }
  });

  it('FIXED LOGIC: extracts ketiv with lemma and variant field', () => {
    const verses = parseOsisFixed(KETIV_QERE_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Find ketiv word
    const ketivWord = verse.words.find(w => w.variant === 'ketiv');
    expect(ketivWord).toBeDefined();
    expect(ketivWord!.text).toBe('הוצא');
    expect(ketivWord!.lemma).toBe('3318'); // Has lemma now!
    expect(ketivWord!.morph).toBe('HVhv2ms');

    // Find qere word
    const qereWord = verse.words.find(w => w.variant === 'qere');
    expect(qereWord).toBeDefined();
    expect(qereWord!.text).toBe('הַיְצֵא');
    expect(qereWord!.lemma).toBe('3318');
  });

  it('FIXED LOGIC: no duplicate words from alternative accent notes', () => {
    const verses = parseOsisFixed(ALTERNATIVE_ACCENT_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Should only have 3 words, no duplicates from catchWord/rdg
    expect(verse.words).toHaveLength(3);

    // All words should have lemmas (no null lemma duplicates)
    const nullLemmaWords = verse.words.filter(w => w.lemma === null);
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('FIXED LOGIC: skips segment types like x-sof-pasuq', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Gen.1.1">
      <w lemma="7225" morph="HNcfsa">בְּרֵאשִׁית</w>
      <seg type="x-sof-pasuq">׃</seg>
    </verse>`;

    const verses = parseOsisFixed(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    expect(verse.words).toHaveLength(1);
    expect(verse.words[0].text).toBe('בְּרֵאשִׁית');
  });

  it('FIXED LOGIC: users can filter by variant field', () => {
    const verses = parseOsisFixed(KETIV_QERE_XML);
    const verse = verses[0];

    // Users can get only ketiv forms
    const ketivWords = verse.words.filter(w => w.variant === 'ketiv');
    expect(ketivWords.length).toBeGreaterThan(0);

    // Users can get only qere forms
    const qereWords = verse.words.filter(w => w.variant === 'qere');
    expect(qereWords.length).toBeGreaterThan(0);

    // Users can get only "standard" words (neither ketiv nor qere)
    const standardWords = verse.words.filter(w => !w.variant);
    expect(standardWords.length).toBeGreaterThan(0);
  });
});

describe('Strong\'s number extraction', () => {
  it('should extract Strong\'s numbers with 3+ digits', () => {
    // These should work with current regex
    expect(extractStrongs('430')).toEqual(['H430']);
    expect(extractStrongs('3068')).toEqual(['H3068']);
    expect(extractStrongs('H7225')).toEqual(['H7225']);
    expect(extractStrongs('b/7225')).toEqual(['H7225']);
    expect(extractStrongs('c/559')).toEqual(['H559']);
  });

  it('BUG: should extract Strong\'s numbers with 1-2 digits', () => {
    // These FAIL with current regex (\d{3,5} requires 3+ digits)
    // H1 = אָב (father), H6 = אָבַד (perish), H14 = אָבָה (consent)
    // H85 = אַבְרָהָם (Abraham), H26 = אֲבִיגַיִל (Abigail)
    expect(extractStrongs('1')).toEqual(['H1']);
    expect(extractStrongs('6')).toEqual(['H6']);
    expect(extractStrongs('14')).toEqual(['H14']);
    expect(extractStrongs('85')).toEqual(['H85']);
    expect(extractStrongs('26')).toEqual(['H26']);
    expect(extractStrongs('c/6')).toEqual(['H6']);
    expect(extractStrongs('l/26')).toEqual(['H26']);
  });

  it('BUG: should extract Strong\'s with letter suffix (e.g., "1471 a")', () => {
    // Lemmas often have a letter suffix for disambiguation
    expect(extractStrongs('1471 a')).toEqual(['H1471']);
    expect(extractStrongs('7227 a')).toEqual(['H7227']);
    expect(extractStrongs('1 a')).toEqual(['H1']); // Short number with suffix
  });

  it('should handle compound lemmas with prefix', () => {
    expect(extractStrongs('b/990')).toEqual(['H990']);
    expect(extractStrongs('d/8064')).toEqual(['H8064']);
    expect(extractStrongs('c/853')).toEqual(['H853']);
  });

  it('should return empty array for prefix-only lemmas', () => {
    // These correctly return empty - no Strong's for pure grammatical constructions
    expect(extractStrongs('l')).toEqual([]);
    expect(extractStrongs('b')).toEqual([]);
    expect(extractStrongs('c/l')).toEqual([]);
    expect(extractStrongs('m')).toEqual([]);
  });
});

describe('actual data - short Strong\'s numbers bug', () => {
  it('BUG: 1 Chronicles 1:27 - Abraham (H85) should have strongs', async () => {
    // אַבְרָהָם (Abraham) has lemma "85" - a 2-digit Strong's number
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', '1Chr', '1', '27.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find by lemma since text now includes cantillation marks
    const abrahamWord = data.words.find(
      (w: { lemma: string | null }) => w.lemma === '85'
    );

    expect(abrahamWord).toBeDefined();
    expect(abrahamWord.lemma).toBe('85');
    // BUG: This should have strongs: ['H85'] but the regex misses 2-digit numbers
    expect(abrahamWord.strongs).toEqual(['H85']);
  });

  it('BUG: Jeremiah 6:21 - perish verb (H6) should have strongs', async () => {
    // יאבדו (they will perish) has lemma "6" - a 1-digit Strong's number
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Jer', '6', '21.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find the ketiv word with lemma "6"
    const perishWord = data.words.find(
      (w: { lemma: string | null }) => w.lemma === '6'
    );

    expect(perishWord).toBeDefined();
    // BUG: This should have strongs: ['H6'] but the regex misses 1-digit numbers
    expect(perishWord.strongs).toEqual(['H6']);
  });

  it('BUG: 1 Chronicles 10:4 - consent verb (H14) should have strongs', async () => {
    // אָבָה (he was willing) has lemma "14" - a 2-digit Strong's number
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', '1Chr', '10', '4.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const consentWord = data.words.find(
      (w: { lemma: string | null }) => w.lemma === '14'
    );

    expect(consentWord).toBeDefined();
    // BUG: This should have strongs: ['H14'] but the regex misses 2-digit numbers
    expect(consentWord.strongs).toEqual(['H14']);
  });

  it('BUG: Exodus 10:6 - father noun (H1) should have strongs', async () => {
    // אֲבֹתֶיךָ (your fathers) has lemma "1" - a 1-digit Strong's number (H1 = אָב father)
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '10', '6.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const fatherWord = data.words.find(
      (w: { lemma: string | null }) => w.lemma === '1'
    );

    expect(fatherWord).toBeDefined();
    expect(fatherWord.strongs).toEqual(['H1']);
  });
});

describe('actual data verification - strict assertions', () => {
  it('Genesis 8:17 - should have NO null lemmas after fix', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const nullLemmaWords = data.words.filter(
      (w: { lemma: string | null }) => w.lemma === null
    );

    if (nullLemmaWords.length > 0) {
      console.log('FAIL: Genesis 8:17 still has null lemma words:',
        nullLemmaWords.map((w: { text: string; position: number }) => `pos ${w.position}: ${w.text}`)
      );
    }

    // STRICT: After re-import with fix, there should be NO null lemmas
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('Genesis 8:17 - should have ketiv word with variant=ketiv', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find ketiv word (הוצא - written form)
    const ketivWord = data.words.find(
      (w: { variant?: 'ketiv' | 'qere' }) => w.variant === 'ketiv'
    );

    expect(ketivWord).toBeDefined();
    expect(ketivWord.text).toBe('הוצא');
    expect(ketivWord.lemma).toBe('3318');
  });

  it('Genesis 8:17 - should have qere word with variant=qere', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find qere word (הַיְצֵא - read form, now includes cantillation marks)
    const qereWord = data.words.find(
      (w: { variant?: 'ketiv' | 'qere' }) => w.variant === 'qere'
    );

    expect(qereWord).toBeDefined();
    // Text now includes cantillation marks
    expect(qereWord.text).toBe('הַיְצֵ֣א');
    expect(qereWord.lemma).toBe('3318');
  });

  it('Exodus 20:2 - should have NO null lemmas after fix', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '20', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const nullLemmaWords = data.words.filter(
      (w: { lemma: string | null }) => w.lemma === null
    );

    if (nullLemmaWords.length > 0) {
      console.log('FAIL: Exodus 20:2 still has null lemma words:',
        nullLemmaWords.map((w: { text: string; position: number }) => `pos ${w.position}: ${w.text}`)
      );
    }

    // STRICT: After re-import with fix, there should be NO null lemmas
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('Exodus 20:2 - should NOT have duplicate words from alternative notes', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '20', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // The verse should have exactly 9 words (no duplicates from notes)
    // אָנֹכִי יְהוָה אֱלֹהֶיךָ אֲשֶׁר הוֹצֵאתִיךָ מֵאֶרֶץ מִצְרַיִם מִבֵּית עֲבָדִים
    expect(data.words.length).toBe(9);
  });

  it('Exodus 20:2 - all words should have strongs arrays', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '20', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    for (const word of data.words) {
      expect(word.strongs).toBeDefined();
      expect(word.strongs.length).toBeGreaterThan(0);
      expect(word.strongs[0]).toMatch(/^H\d+$/);
    }
  });

  it('prefix-only words should have isPrefixOnly flag', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '25', '23.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // לָהּ (to-her) at position 3 has lemma "l" - should be flagged as prefix-only
    const prefixWord = data.words.find((w: { lemma: string }) => w.lemma === 'l');
    expect(prefixWord).toBeDefined();
    expect(prefixWord.metadata.isPrefixOnly).toBe(true);
    expect(prefixWord.strongs).toBeUndefined();
  });

  it('words with strongs should NOT have isPrefixOnly flag', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '1.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    for (const word of data.words) {
      expect(word.strongs).toBeDefined();
      expect(word.metadata.isPrefixOnly).toBeUndefined();
    }
  });
});

describe('special letters (litterae majusculae/minusculae/suspensae)', () => {
  // These letters are encoded in the WLC source as <seg type="x-large|x-small|
  // x-suspended"> nested INSIDE a <w> element. They are an integral part of the
  // word and must not be dropped (regression guard for the "missing first/last
  // letter of Deut 6:4" bug, where the large ayin of שְׁמַע and large dalet of
  // אֶחָד were lost, also corrupting the gematria).
  const read = async (book: string, ch: string, v: string) =>
    JSON.parse(
      await readFile(
        join(__dirname, '..', 'data', 'openscriptures-OHB', book, ch, `${v}.json`),
        'utf-8'
      )
    );

  it('Deuteronomy 6:4 - large ayin of שְׁמַע is preserved (first word)', async () => {
    const data = await read('Deut', '6', '4');
    expect(data.words[0].text).toContain('ע');
    expect(data.words[0].text.replace(/[֑-ׇ]/g, '')).toBe('שמע');
  });

  it('Deuteronomy 6:4 - large dalet of אֶחָד is preserved (last word)', async () => {
    const data = await read('Deut', '6', '4');
    const last = data.words[data.words.length - 1];
    expect(last.text).toContain('ד');
    expect(last.text.replace(/[֑-ׇ]/g, '')).toBe('אחד');
  });

  it('Leviticus 11:42 - large vav sits mid-word in גָּחוֹן (center letter of Torah)', async () => {
    const data = await read('Lev', '11', '42');
    const gachon = data.words.find(
      (w: { text: string }) => w.text.replace(/[֑-ׇ]/g, '') === 'גחון'
    );
    expect(gachon).toBeDefined();
  });

  it('Judges 18:30 - suspended nun restores מְנַשֶּׁה (Manasseh, not Moses)', async () => {
    const data = await read('Judg', '18', '30');
    const name = data.words.find(
      (w: { text: string }) => w.text.replace(/[֑-ׇ]/g, '') === 'מנשה'
    );
    expect(name).toBeDefined();
  });

  it('Deut 6:4 - records special-letter metadata (type + consonant index)', async () => {
    const data = await read('Deut', '6', '4');
    // WLC-marked letters now also carry tradition/source provenance (#2).
    expect(data.words[0].metadata.specialLetters).toMatchObject([
      { type: 'large', char: 'ע', index: 2, tradition: 'leningrad' },
    ]);
    const last = data.words[data.words.length - 1];
    expect(last.metadata.specialLetters).toMatchObject([
      { type: 'large', char: 'ד', index: 2, tradition: 'leningrad' },
    ]);
  });

  it('metadata type and index cover mid-word small/suspended letters', async () => {
    // Judg 18:30 suspended nun is the 2nd consonant of מְנַשֶּׁה (index 1)
    const judg = await read('Judg', '18', '30');
    const manasseh = judg.words.find(
      (w: { text: string }) => w.text.replace(/[֑-ׇ]/g, '') === 'מנשה'
    );
    expect(manasseh.metadata.specialLetters[0]).toMatchObject({ type: 'suspended', index: 1 });

    // Isa 44:14 small final nun is the last consonant of אֹרֶן (index 2)
    const isa = await read('Isa', '44', '14');
    const oren = isa.words.find(
      (w: { text: string }) => w.text.replace(/[֑-ׇ]/g, '') === 'ארן'
    );
    expect(oren.metadata.specialLetters[0]).toMatchObject({ type: 'small', index: 2 });
  });
});

describe('special letters: only what the WLC marks', () => {
  // Since 3.0.0 the package carries no special letters from other sources. The
  // WLC marks 4 large, 3 small and 4 suspended letters.
  const root = join(__dirname, '..', 'data', 'openscriptures-OHB');
  it('exactly the 11 WLC special letters, all tradition leningrad', async () => {
    const found: string[] = [];
    for (const book of await readdir(root)) {
      if (book.endsWith('.json')) continue;
      for (const ch of await readdir(join(root, book))) {
        for (const f of await readdir(join(root, book, ch))) {
          const data = JSON.parse(await readFile(join(root, book, ch, f), 'utf-8'));
          for (const w of data.words) {
            for (const s of w.metadata?.specialLetters ?? []) {
              expect(s.tradition).toBe('leningrad');
              found.push(`${book} ${ch}:${f.replace('.json', '')} ${s.type} ${[...s.char][0]} ${s.index}`);
            }
          }
        }
      }
    }
    expect(found.sort()).toEqual([
      'Deut 6:4 large ד 2',
      'Deut 6:4 large ע 2',
      'Isa 44:14 small ן 2',
      'Jer 39:13 small ן 7',
      'Job 38:13 suspended ע 2',
      'Job 38:15 suspended ע 3',
      'Judg 18:30 suspended נ 1',
      'Lev 11:42 large ו 2',
      'Num 27:5 large ן 4',
      'Prov 16:28 small ן 4',
      'Ps 80:14 suspended ע 2',
    ]);
  }, 60000);
});

describe('metadata.sequence: words and marks in XML order', () => {
  // The marks the WLC writes between words (maqaf, paseq, sof pasuq,
  // petuchah/setumah, reversed nun) are items of metadata.sequence, in the
  // order of the XML, and belong to no word. They never enter words[], so
  // gematria and word counts are unaffected.
  const root = join(__dirname, '..', 'data', 'openscriptures-OHB');
  const read = async (book: string, ch: string, v: string) =>
    JSON.parse(await readFile(join(root, book, ch, `${v}.json`), 'utf-8'));
  type Item = { kind: 'word'; position: number } | { kind: 'mark'; type: string; text: string; reading?: string };
  const marks = (data: { metadata: { sequence: Item[] } }) =>
    data.metadata.sequence.filter(i => i.kind === 'mark') as Array<Extract<Item, { kind: 'mark' }>>;
  // The position of the word before each mark of the given type.
  const after = (data: { metadata: { sequence: Item[] } }, type: string) => {
    const out: number[] = [];
    let last = 0;
    for (const i of data.metadata.sequence) {
      if (i.kind === 'word') last = i.position;
      else if (i.type === type) out.push(last);
    }
    return out;
  };

  it('Gen 1:1 - sof pasuq is the last item', async () => {
    const data = await read('Gen', '1', '1');
    expect(data.metadata.sequence.at(-1)).toEqual({ kind: 'mark', type: 'sof-pasuq', text: '׃' });
    expect(data.metadata.sequence.filter((i: Item) => i.kind === 'word')).toHaveLength(data.words.length);
  });

  it('Gen 1:5 - petuchah after the sof pasuq', async () => {
    const data = await read('Gen', '1', '5');
    expect(marks(data).slice(-2).map(m => m.type)).toEqual(['sof-pasuq', 'petuchah']);
  });

  it('Gen 35:22 - mid-verse petuchah', async () => {
    const data = await read('Gen', '35', '22');
    const [p] = after(data, 'petuchah');
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(data.words.length);
  });

  it('Num 10:34 - sof pasuq, reversed nun, setumah, in XML order', async () => {
    const data = await read('Num', '10', '34');
    expect(marks(data).slice(-3).map(m => m.type)).toEqual(['sof-pasuq', 'reversed-nun', 'setumah']);
  });

  it('reversed nun: the 9 WLC verses, never in words[]', async () => {
    const MARKED = ['Num 10:34', 'Num 10:36', 'Ps 107:20', 'Ps 107:21', 'Ps 107:22', 'Ps 107:23', 'Ps 107:24', 'Ps 107:25', 'Ps 107:39'];
    for (const ref of MARKED) {
      const [book, cv] = ref.split(' ');
      const [ch, v] = cv.split(':');
      const data = await read(book, ch, v);
      expect(marks(data).filter(m => m.type === 'reversed-nun'), ref).toEqual([
        { kind: 'mark', type: 'reversed-nun', text: '׆' },
      ]);
      for (const w of data.words) expect(w.text).not.toContain('׆');
    }
    expect(marks(await read('Num', '10', '35')).some(m => m.type === 'reversed-nun')).toBe(false);
  });

  it('Neh 2:13 - the paseq is inside the qere, between הֵם and פְּרוּצִים', async () => {
    const data = await read('Neh', '2', '13');
    expect(after(data, 'paseq')).toEqual([18]);
    expect(marks(data).find(m => m.type === 'paseq')).toMatchObject({ reading: 'qere' });
    // The maqaf before the ketiv belongs to the main text.
    expect(after(data, 'maqaf')).toContain(16);
  });

  it('Job 38:1 - paseq inside the two-word qere', async () => {
    const data = await read('Job', '38', '1');
    expect(after(data, 'paseq')).toEqual([7]);
    expect(marks(data).find(m => m.type === 'paseq')).toMatchObject({ reading: 'qere' });
  });

  it('Exod 4:2 - the maqaf of מַה־זֶּה is inside the qere', async () => {
    const data = await read('Exod', '4', '2');
    const m = marks(data).filter(x => x.type === 'maqaf');
    expect(m).toEqual([{ kind: 'mark', type: 'maqaf', text: '־', reading: 'qere' }]);
    expect(after(data, 'maqaf')).toEqual([5]);
  });

  it('Isa 52:5 - a maqaf between two ketiv words has reading ketiv', async () => {
    const data = await read('Isa', '52', '5');
    expect(marks(data).filter(x => x.reading).map(x => [x.type, x.reading])).toEqual([
      ['maqaf', 'ketiv'],
      ['maqaf', 'qere'],
    ]);
  });

  it('every verse: each word once, in order; only known marks; no attached marks', async () => {
    const TYPES = ['maqaf', 'paseq', 'sof-pasuq', 'petuchah', 'setumah', 'reversed-nun'];
    const counts: Record<string, number> = {};
    for (const book of await readdir(root)) {
      if (book.endsWith('.json')) continue;
      for (const ch of await readdir(join(root, book))) {
        for (const f of await readdir(join(root, book, ch))) {
          const data = JSON.parse(await readFile(join(root, book, ch, f), 'utf-8'));
          const ref = `${book} ${ch}:${f}`;
          expect(Object.keys(data.metadata), ref).toEqual(['sequence']);
          const positions = data.metadata.sequence.filter((i: Item) => i.kind === 'word').map((i: { position: number }) => i.position);
          expect(positions, ref).toEqual(data.words.map((_: unknown, i: number) => i + 1));
          for (const m of marks(data)) {
            expect(TYPES, ref).toContain(m.type);
            counts[m.type] = (counts[m.type] ?? 0) + 1;
          }
          for (const w of data.words) expect(w.metadata?.joinNext, ref).toBeUndefined();
        }
      }
    }
    // Every <seg> mark in the WLC (grep -c over wlc/*.xml).
    expect(counts).toEqual({
      maqaf: 42577,
      paseq: 2278,
      'sof-pasuq': 23192,
      petuchah: 1181,
      setumah: 1981,
      'reversed-nun': 9,
    });
  }, 120000);
});

describe('ketiv/qere reading order', () => {
  // The XML parse groups a verse's children by tag, which used to put every
  // qere word (inside <note><rdg type="x-qere">) at the end or the start of the
  // verse instead of right after its ketiv. parseOsis numbers each <w> in
  // document order and restores that order.
  const root = join(__dirname, '..', 'data', 'openscriptures-OHB');
  const read = async (book: string, ch: string, v: string) =>
    JSON.parse(await readFile(join(root, book, ch, `${v}.json`), 'utf-8'));
  type W = { position: number; text: string; variant?: string };
  const variants = (data: { words: W[] }) =>
    data.words.filter(w => w.variant).map(w => [w.position, w.variant]);

  it('Neh 2:13 - qere הם פרוצים follows the ketiv המפרוצים', async () => {
    const data = await read('Neh', '2', '13');
    expect(variants(data)).toEqual([[17, 'ketiv'], [18, 'qere'], [19, 'qere']]);
    expect(data.words[16].text).toBe('המפרוצים');
  });

  it('Job 38:1 - two ketiv words, then two qere words', async () => {
    const job = await read('Job', '38', '1');
    expect(variants(job)).toEqual([[5, 'ketiv'], [6, 'ketiv'], [7, 'qere'], [8, 'qere']]);
  });

  it('Isa 9:6 - ketiv לםרבה (final mem mid-word) comes first, then the qere', async () => {
    const data = await read('Isa', '9', '6');
    expect(variants(data)).toEqual([[1, 'ketiv'], [2, 'qere']]);
    expect(data.words[0].text).toBe('לםרבה');
  });

  it('Isa 56:10 - qere follows the ketiv צפו', async () => {
    const data = await read('Isa', '56', '10');
    expect(variants(data)).toEqual([[1, 'ketiv'], [2, 'qere']]);
  });

  it('every qere directly follows its ketiv, except qere without ketiv', async () => {
    const qereOnly: string[] = [];
    const ketivOnly: string[] = [];
    for (const book of await readdir(root)) {
      if (book.endsWith('.json')) continue;
      for (const ch of await readdir(join(root, book))) {
        for (const f of await readdir(join(root, book, ch))) {
          const data = JSON.parse(await readFile(join(root, book, ch, f), 'utf-8'));
          const seq = data.words.map((w: W) => (w.variant === 'ketiv' ? 'K' : w.variant === 'qere' ? 'Q' : '.')).join('');
          const ref = `${book} ${ch}:${f.replace('.json', '')}`;
          for (let i = 0; i < seq.length; i++) {
            if (seq[i] === 'Q' && (i === 0 || seq[i - 1] === '.')) qereOnly.push(ref);
            if (seq[i] === 'K' && (i + 1 === seq.length || seq[i + 1] === '.')) ketivOnly.push(ref);
          }
        }
      }
    }
    // Qere without ketiv (vowels only in the WLC line) and ketiv without qere.
    expect(qereOnly.sort()).toEqual([
      '2Kgs 19:31', '2Kgs 19:37', '2Sam 16:23', '2Sam 8:3', 'Jer 31:38',
      'Jer 50:29', 'Judg 20:13', 'Ruth 3:17', 'Ruth 3:5',
    ]);
    expect(ketivOnly.sort()).toEqual([
      '2Kgs 5:18', 'Ezek 48:16', 'Jer 38:16', 'Jer 39:12', 'Jer 51:3', 'Ruth 3:12',
    ]);
  }, 60000);

  it('Nah 1:3 and Dan 6:20 - no special letters (the WLC marks none there)', async () => {
    for (const [b, c, v] of [['Nah', '1', '3'], ['Dan', '6', '20']]) {
      const data = await read(b, c, v);
      for (const w of data.words) expect(w.metadata?.specialLetters, `${b} ${c}:${v}`).toBeUndefined();
    }
  });
});
