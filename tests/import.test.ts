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
import { readFile } from 'fs/promises';
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
