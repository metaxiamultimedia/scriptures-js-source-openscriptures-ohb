/**
 * Targeted update for test verses Gen 8:17 and Exod 20:2
 * Uses embedded XML from MorphHB
 */

import { XMLParser } from 'fast-xml-parser';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeHebrew } from '@metaxia/scriptures-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAQQEF = '\u05BE';

function removeCantillation(text: string): string {
  return text.replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C6]/g, '');
}

const STRONGS_RE = /(?:strongs?:)?([HGhg]?\d{3,5})/g;

function extractStrongs(value: string | null): string[] {
  if (!value) return [];
  const results: string[] = [];
  let match;
  STRONGS_RE.lastIndex = 0;
  while ((match = STRONGS_RE.exec(value)) !== null) {
    const token = match[1];
    let prefix = token[0] && 'HGhg'.includes(token[0]) ? token[0].toUpperCase() : 'H';
    const digits = token.match(/\d{3,5}/);
    if (digits) results.push(prefix + String(Number(digits[0])));
  }
  return results;
}

interface WordEntry {
  position: number;
  text: string;
  lemma: string | null;
  morph: string | null;
  strongs?: string[];
  metadata: Record<string, unknown>;
  gematria: Record<string, number>;
}

function parseVerse(xml: string): { text: string; words: WordEntry[]; gematria: Record<string, number> } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false,
  });

  const doc = parser.parse(xml);
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
        if (rdgType === 'x-qere') {
          const prev = isInsideQere;
          isInsideQere = true;
          extractWords(rdg);
          isInsideQere = prev;
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
          const gematria = computeHebrew(word);
          words.push({ position: pos++, text: word, lemma: null, morph: null, metadata: {}, gematria });
        }
      }
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) extractWords(item);
      return;
    }
    if (typeof content === 'object') {
      const elem = content as Record<string, unknown>;
      if (elem['#text']) {
        const elemType = elem['@_type'] as string | undefined;
        if (elemType && elemType.startsWith('x-') && elemType !== 'x-ketiv' && elemType !== 'x-qere') {
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
            const metadata: Record<string, unknown> = {};
            if (elemType === 'x-ketiv') metadata.isKetiv = true;
            if (isInsideQere) metadata.isQere = true;
            const gematria = computeHebrew(piece);
            words.push({
              position: pos++,
              text: piece,
              lemma: lemma || null,
              morph: morph || null,
              strongs: strongs.length > 0 ? strongs : undefined,
              metadata,
              gematria,
            });
          }
        }
      }
      for (const [key, value] of Object.entries(elem)) {
        if (key === 'catchWord') continue;
        if (key === 'rdg') { processRdg(value); continue; }
        if (key === 'note') {
          const noteArray = Array.isArray(value) ? value : [value];
          for (const note of noteArray) {
            if (note && typeof note === 'object') {
              const noteObj = note as Record<string, unknown>;
              if (noteObj['rdg']) processRdg(noteObj['rdg']);
            }
          }
          continue;
        }
        if (!key.startsWith('@_') && key !== '#text') extractWords(value);
      }
    }
  }

  const verse = doc.verse;
  for (const [key, value] of Object.entries(verse)) {
    if (!key.startsWith('@_')) extractWords(value);
  }

  const text = words.map(w => w.text).join(' ');
  const totals: Record<string, number> = {};
  for (const w of words) {
    for (const [k, v] of Object.entries(w.gematria)) {
      totals[k] = (totals[k] || 0) + v;
    }
  }

  return { text, words, gematria: totals };
}

// Genesis 8:17 XML (from MorphHB)
const GEN_8_17_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Gen.8.17">
  <w lemma="3605" morph="HNcmsc">כָּל</w>
  <w lemma="d/2416 c" morph="HTd/Ncfsa">הַחַיָּה</w>
  <w lemma="834 a" morph="HTr">אֲשֶׁר</w>
  <w lemma="854" morph="HR/Sp2ms">אִתְּךָ</w>
  <w lemma="m/3605" morph="HR/Ncmsc">מִכָּל</w>
  <w lemma="1320" morph="HNcmsa">בָּשָׂר</w>
  <w lemma="b/5775" morph="HRd/Ncmsa">בָּעוֹף</w>
  <w lemma="c/b/929" morph="HC/Rd/Ncfsa">וּבַבְּהֵמָה</w>
  <w lemma="c/b/3605" morph="HC/R/Ncmsc">וּבְכָל</w>
  <w lemma="d/7431" morph="HTd/Ncmsa">הָרֶמֶשׂ</w>
  <w lemma="d/7430" morph="HTd/Vqrmsa">הָרֹמֵשׂ</w>
  <w lemma="5921 a" morph="HR">עַל</w>
  <w lemma="d/776" morph="HTd/Ncbsa">הָאָרֶץ</w>
  <w type="x-ketiv" lemma="3318" morph="HVhv2ms">הוצא</w>
  <note type="variant">
    <catchWord>הוצא</catchWord>
    <rdg type="x-qere">
      <w lemma="3318" morph="HVhv2ms">הַיְצֵא</w>
    </rdg>
  </note>
  <w lemma="854" morph="HR/Sp2fs">אִתָּךְ</w>
  <w lemma="c/8317" morph="HC/Vqq3cp">וְשָׁרְצוּ</w>
  <w lemma="b/776" morph="HRd/Ncbsa">בָאָרֶץ</w>
  <w lemma="c/6509" morph="HC/Vqq3cp">וּפָרוּ</w>
  <w lemma="c/7235 a" morph="HC/Vqq3cp">וְרָבוּ</w>
  <w lemma="5921 a" morph="HR">עַל</w>
  <w lemma="d/776" morph="HTd/Ncbsa">הָאָרֶץ</w>
</verse>`;

// Exodus 20:2 XML (from MorphHB)
const EXOD_20_2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Exod.20.2">
  <w lemma="595" morph="HPp1cs">אָנֹכִי</w>
  <note type="alternative"><catchWord>אָנֹכִי</catchWord><rdg type="x-accent">אָנֹכִי</rdg></note>
  <w lemma="3068" morph="HNp">יְהוָה</w>
  <w lemma="430" morph="HNcmpc/Sp2ms">אֱלֹהֶיךָ</w>
  <note type="alternative"><catchWord>אֱלֹהֶיךָ</catchWord><rdg type="x-accent">אֱלֹהֶיךָ</rdg></note>
  <w lemma="834 a" morph="HTr">אֲשֶׁר</w>
  <w lemma="3318" morph="HVhp1cs/Sp2ms">הוֹצֵאתִיךָ</w>
  <w lemma="m/776" morph="HR/Ncbsc">מֵאֶרֶץ</w>
  <w lemma="4714" morph="HNp">מִצְרַיִם</w>
  <w lemma="m/1004 b" morph="HR/Ncmsc">מִבֵּית</w>
  <note type="alternative"><catchWord>מִבֵּית</catchWord><rdg type="x-accent">מִבֵּית</rdg></note>
  <w lemma="5650" morph="HNcmpa">עֲבָדִים</w>
  <note type="alternative"><catchWord>עֲבָדִים</catchWord><rdg type="x-accent">עֲבָדִים</rdg></note>
</verse>`;

async function main() {
  const dataDir = join(__dirname, '..', 'data', 'openscriptures-OHB');

  // Process Genesis 8:17
  console.log('Processing Genesis 8:17...');
  const gen817 = parseVerse(GEN_8_17_XML);
  await mkdir(join(dataDir, 'Gen', '8'), { recursive: true });
  await writeFile(join(dataDir, 'Gen', '8', '17.json'), JSON.stringify(gen817, null, 2));
  console.log(`  Words: ${gen817.words.length}`);
  console.log(`  Ketiv: ${gen817.words.filter(w => w.metadata.isKetiv).map(w => w.text)}`);
  console.log(`  Qere: ${gen817.words.filter(w => w.metadata.isQere).map(w => w.text)}`);
  console.log(`  Null lemmas: ${gen817.words.filter(w => w.lemma === null).length}`);

  // Process Exodus 20:2
  console.log('\nProcessing Exodus 20:2...');
  const exod202 = parseVerse(EXOD_20_2_XML);
  await mkdir(join(dataDir, 'Exod', '20'), { recursive: true });
  await writeFile(join(dataDir, 'Exod', '20', '2.json'), JSON.stringify(exod202, null, 2));
  console.log(`  Words: ${exod202.words.length}`);
  console.log(`  Null lemmas: ${exod202.words.filter(w => w.lemma === null).length}`);

  console.log('\n✓ Test verses updated');
}

main().catch(console.error);
