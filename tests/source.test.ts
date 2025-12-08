/**
 * Tests for @metaxia/scriptures-source-openscriptures-ohb
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('gematria calculations', () => {
  it('should calculate correct ordinal gematria using alphabet positions', async () => {
    // Genesis 32:29 contains יִשְׂרָאֵל (Israel) at position 10
    // Letters: י(10) + ש(21) + ר(20) + א(1) + ל(12) = 64
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '32', '29.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Word at position 10 is Israel (יִשְׂרָאֵל)
    const israelWord = data.words.find(
      (word: { position: number }) => word.position === 10
    );

    expect(israelWord).toBeDefined();
    expect(israelWord.gematria.standard).toBe(541); // Standard gematria for Israel
    // Ordinal should be alphabet positions: י(10) + ש(21) + ר(20) + א(1) + ל(12) = 64
    expect(israelWord.gematria.ordinal).toBe(64);
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

  it('should not have words with null lemma and zero gematria', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Words with null lemma AND zero gematria are likely punctuation
    const suspiciousWords = data.words.filter(
      (word: { lemma: string | null; gematria: { standard: number } }) =>
        word.lemma === null && word.gematria.standard === 0
    );

    expect(suspiciousWords).toHaveLength(0);
  });
});
