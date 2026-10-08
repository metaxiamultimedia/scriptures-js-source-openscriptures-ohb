# @metaxia/scriptures-source-openscriptures-ohb

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

### Masoretic marks (structural metadata)

The data model is **words-only**: every word's `text` carries just the letters,
points, and cantillation, so gematria totals and word counts are never affected
by scribal punctuation. The Masoretic marks the WLC places *around* words are
preserved separately so a renderer can reproduce a faithful text:

- **`words[].metadata.joinNext: "maqqef"`** — the maqqef (־, U+05BE) connector;
  recorded on the word it binds to the following word.
- **`metadata.terminator: "sof-pasuq"`** — the verse-ending sof-pasuq (׃,
  U+05C3). Recorded once per verse; omitted for the handful of verses the WLC
  leaves open (e.g. the enjambed divine-name formula of Exod 34:6).
- **`metadata.paseq: [n, …]`** — the paseq disjunctive (׀, U+05C0), as the
  1-based positions of the words it follows.
- **`metadata.paragraphBreaks`**, **`metadata.scribalMarks`** — petuhah/setumah
  parashah breaks and the reversed nun (nun hafukha), likewise verse-level.
- **`words[].metadata.points`** — the extraordinary points (puncta extraordinaria),
  the traditional fifteen dotted passages. Each entry `{index, char, mark}` names
  the dotted base consonant (0-based `index`) and whether the dot sits `upper`
  (U+05C4) or `lower` (U+05C5). The dots are retained in the word `text` as
  combining marks; because they lie outside the consonant range they do not
  affect gematria or counts.
- **`words[].metadata.specialLetters`** — enlarged / small / suspended letters
  (litterae majusculae / minusculae / suspensae), `{type, char, index, tradition, source}`.
  Each entry is tagged by **tradition**:
  - `tradition: "leningrad"` — marked in the WLC manuscript itself (`source: "WLC / OpenScriptures"`).
  - `tradition: "masoretic-received"` — the broader received-Masoretic
    majuscules/minuscules the Leningrad codex does not mark, supplied from a
    cited enumeration (`source` = Jewish Encyclopedia 1906 + A.E. Brouwer),
    occurrence-adjudicated against L. Cohen, *Windows into the Text* (HUC, 2000).
    Only entries those sources attest with a single unambiguous location are
    included; contested either/or and occurrence-ambiguous cases are excluded.

All of these are structural only: they never enter `words[]` as separate tokens
and never carry a numeric value. A renderer can show the WLC base alone
(`tradition === "leningrad"`) or the full received tradition.

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
- The connection is not lost: the preceding word carries
  `metadata.joinNext: "maqqef"`, so a renderer can re-join the unit for display
  or for an alternative word count.

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
