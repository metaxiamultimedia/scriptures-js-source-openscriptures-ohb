# @metaxia/scriptures-source-openscriptures-ohb

It is a data source for [GematriaBible.com](https://gematriabible.com) — an interlinear Bible with gematria values and Strong's numbers.

Open Scriptures Hebrew Bible (Hebrew) data for [@metaxia/scriptures](https://github.com/metaxiamultimedia/scriptures-js).

## Source

[Open Scriptures Hebrew Bible Project](https://github.com/openscriptures/morphhb)

## Installation

```bash
npm install @metaxia/scriptures @metaxia/scriptures-source-openscriptures-ohb
```

## Usage

### Auto-Registration

```typescript
// Import to auto-register with @metaxia/scriptures
import '@metaxia/scriptures-source-openscriptures-ohb';

import { getVerse } from '@metaxia/scriptures';

const verse = await getVerse('Genesis', 1, 1, { edition: 'openscriptures-OHB' });
console.log(verse.text);
// "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃"
```

### Granular Imports

Import specific portions for smaller bundle sizes:

```typescript
// Single verse
import verse from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis/1/1';

// Entire chapter
import chapter from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis/1';

// Entire book
import genesis from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis';

// Raw JSON data
import verseData from '@metaxia/scriptures-source-openscriptures-ohb/data/Genesis/1/1.json';

// Edition metadata
import metadata from '@metaxia/scriptures-source-openscriptures-ohb/metadata';
```

### Lazy Loading

```typescript
// Register without loading data
import '@metaxia/scriptures-source-openscriptures-ohb/register';

import { getVerse } from '@metaxia/scriptures';

// Data loads on demand
const verse = await getVerse('Genesis', 1, 1, { edition: 'openscriptures-OHB' });
```

## Contents

- **Edition**: openscriptures-OHB
- **Language**: Hebrew
- **Books**: 39 (Genesis–Malachi)
- **Features**: Morphological tagging, Strong's numbers, lemmas

## Data Format

Each verse includes morphological annotations:

```json
{
  "id": "openscriptures-OHB:Gen.1.1",
  "text": "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃",
  "words": [
    {
      "position": 1,
      "text": "בְּרֵאשִׁית",
      "lemma": "רֵאשִׁית",
      "strong": "H7225",
      "morph": "HNcfsa"
    }
  ],
  "gematria": {
    "standard": 2701
  }
}
```

### Masoretic marks: `metadata.sequence`

The data model is **words-only**: every word's `text` carries just the letters,
points, and cantillation, so gematria totals and word counts are never affected
by scribal punctuation. The marks the WLC writes *between* words are separate
items of **`metadata.sequence`**, which lists the verse's words and marks in the
order of the WLC XML:

```json
"sequence": [
  { "kind": "word", "position": 1 },
  { "kind": "word", "position": 2 },
  { "kind": "mark", "type": "maqaf", "text": "־" },
  { "kind": "word", "position": 3 },
  { "kind": "mark", "type": "sof-pasuq", "text": "׃" },
  { "kind": "mark", "type": "petuchah", "text": "פ" }
]
```

- A **word item** points into `words[]` by `position`. Every word appears exactly
  once, in `words[]` order.
- A **mark item** is the mark itself. It belongs to no word: not to the word
  before it, and not to a ketiv or a qere. `text` is the character as the WLC
  writes it.

| `type` | Mark | WLC element |
|---|---|---|
| `maqaf` | ־ U+05BE | `<seg type="x-maqqef">` |
| `paseq` | ׀ U+05C0 | `<seg type="x-paseq">` |
| `sof-pasuq` | ׃ U+05C3 | `<seg type="x-sof-pasuq">` |
| `petuchah` | פ (open paragraph) | `<seg type="x-pe">` |
| `setumah` | ס (closed paragraph) | `<seg type="x-samekh">` |
| `reversed-nun` | ׆ U+05C6 (nun hafukha) | `<seg type="x-reversednun">` |

`reading` is set only on a mark that is part of one reading of a ketiv/qere:

- `reading: "qere"`: inside the qere (`<note><rdg type="x-qere">`), e.g. the
  paseq between הֵם and פְּרוּצִים in Neh 2:13, or the maqaf of מַה־זֶּה in Exod 4:2.
- `reading: "ketiv"`: between two ketiv words (`<seg subType="x-ketiv">`), e.g.
  the maqaf of מי־לי in Isa 52:5.

A mark after a whole ketiv/qere unit has no `reading` and comes after the last
qere word (Nah 1:3: ketiv וגדול, qere וּגְדָל, then the maqaf, then כֹּחַ).

To render a reading, walk `sequence` and keep the words of that reading
(`variant`) and the marks whose `reading` is unset or matches. To find "the
word a mark follows", take the nearest word item before it.

Counts over the whole corpus equal the WLC's own: 42,577 maqaf, 2,278 paseq,
23,192 sof pasuq, 1,181 petuchah, 1,981 setumah, 9 reversed nun.

### Special letters and extraordinary points

- **`words[].metadata.specialLetters`**: enlarged / small / suspended letters,
  `{type, char, index, tradition: "leningrad", source: "WLC / OpenScriptures"}`,
  exactly as the WLC marks them (`<seg type="x-large|x-small|x-suspended">`
  inside a word): 4 large (Lev 11:42; Num 27:5; Deut 6:4 twice), 3 small (Isa
  44:14; Jer 39:13; Prov 16:28) and 4 suspended (Judg 18:30; Ps 80:14; Job
  38:13, 38:15). `index` is the 0-based base consonant.
  Marks of the Masoretic tradition that the WLC does not carry are not part of
  this package; `@metaxia/scriptures` has cited tables of them by authority
  (`data/masoretic-marks/`).
- **`words[].metadata.points`**: the extraordinary points (puncta extraordinaria),
  exactly the dots the WLC text carries: HEBREW MARK UPPER DOT (U+05C4) and
  LOWER DOT (U+05C5) in fifteen passages. Each entry
  `{index, char, mark, tradition: "leningrad", source: "WLC / OpenScriptures"}`
  names the dotted base consonant (0-based `index`) and whether the dot sits
  `upper` or `lower`. The dots stay in the word `text` as combining marks;
  they lie outside the consonant range, so they do not affect gematria or
  counts.

### Changes in 3.0.0

- Removed: `words[].metadata.joinNext`, `metadata.paseq`,
  `metadata.paragraphBreaks`, `metadata.terminator`, `metadata.scribalMarks`.
  The same marks are items of `metadata.sequence`. Names changed: `maqqef` is
  `maqaf`, `petuhah` is `petuchah`.
- Removed: the special-letters supplement (`tradition: "masoretic-received"`
  entries of `specialLetters`, `scripts/overlays/special-letters-supplement.json`).
- Removed: the extraordinary-points supplement (`scripts/overlays/points-supplement.json`):
  the `tradition: "masoretic-received"` points (the ayin of עד ("until") in Deut 29:28,
  the vav of ובקומה ("and when she arose") in Gen 19:33, the vav of ועשרון
  ("and a tenth") in Num 29:15) and the
  `received: false` / `receivedSource` fields (Gen 18:9, 19:33; Num 29:15).
  `points` is the WLC's own dots only.
- The importer reads morphhb at a pinned commit,
  `3d15126fb1ef74867fc1434be1942e837932691f`, instead of `master`.
- Fixed: the six maqafs between two ketiv words (`<seg subType="x-ketiv">`:
  Isa 52:5, Lam 1:6, 1 Sam 9:1, 20:2, 24:9, 1 Kgs 17:15) were dropped; they are
  now in `sequence` with `reading: "ketiv"`.
- Unchanged: `words[]` text, order, positions, lemmas, morphology and
  variants, the verse `text`, and the WLC's own extraordinary points.

### Ketiv and qere

Where the WLC writes one form (ketiv) and the Masorah reads another (qere), both
are kept as words: `variant: "ketiv"` on the written form (consonants only, as
in the WLC) and `variant: "qere"` on the read form (pointed). Words are in WLC
reading order: each qere directly follows its ketiv (Neh 2:13 המפרוצים, then
הֵם פְּרוּצִים; Isa 9:6 לםרבה, with its final mem mid-word, then לְמַרְבֵּה).
A qere without ketiv (e.g. Ruth 3:5 אֵלַי, 2 Sam 8:3 פְּרָת) stands where the WLC
places it, and a ketiv without qere (e.g. Jer 51:3 ידרך) has no qere after it.
Before 2.8.0 the qere words were emitted at the end (or start) of the verse.
`tests/upstream-xml.test.ts` checks words and marks against the upstream XML for
Deut 29:22, Gen 30:11, Exod 4:2, Nah 1:3, Job 38:1, Neh 2:13, Isa 9:6 and Dan 6:20.

### Word segmentation (maqqef)

Maqqef-joined units are stored as **separate words**, by design. The maqqef
(־, U+05BE) binds words into one Masoretic accent unit (e.g. `אֶת־כָּל־`), but
each joined element keeps its own lexical identity and Strong's number, so each
occupies its own entry in `words[]`. For example Deut 6:5 `בְּכָל־לְבָבְךָ`
("with all thy heart") is two words — `בְּכָל` then `לְבָבְךָ` — not one.

Consequences to expect:
- **Word counts** count each maqqef-joined element separately. A source that
  counts a maqqef unit as a single word will report fewer words; this is a
  convention difference, not an error.
- **Per-word gematria** is computed per element. Verse/phrase **totals are
  unaffected** — the sum of the split parts equals the sum of the joined whole.
- The connection is not lost: the maqaf is an item of `metadata.sequence`
  between the two words, so a renderer can re-join the unit for display or for
  an alternative word count.

## Morphology Codes

This edition includes Hebrew morphology codes:

| Code | Meaning |
|------|---------|
| `H` | Hebrew |
| `N` | Noun |
| `V` | Verb |
| `c` | Common gender |
| `f` | Feminine |
| `m` | Masculine |
| `s` | Singular |
| `p` | Plural |

Use `parseMorphology()` from the main library to decode:

```typescript
import { parseMorphology } from '@metaxia/scriptures';

const parsed = parseMorphology('HVqp3ms');
// { language: 'Hebrew', partOfSpeech: 'verb', stem: 'qal', ... }
```

## License

CC BY 4.0

This data is licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

Attribution: Open Scriptures Hebrew Bible Project
