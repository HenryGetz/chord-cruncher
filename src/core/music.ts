export type ChartFormat = "chords" | "numbers";
export type InputChartFormat = ChartFormat | "auto";
export type AccidentalsPreference = "auto" | "sharp" | "flat";

export interface KeyShiftStats {
  totalPages: number;
  processedPages: number[];
  touchedPages: number;
  changedSpans: number;
  fallbackFontUses: number;
  fromFormat: ChartFormat;
  toFormat: ChartFormat;
  fromKey: string;
  toKey: string;
  semitoneShift: number;
}

export interface ChartInspection {
  totalPages: number;
  processedPages: number[];
  boldOnly: boolean;
  sampledTokens: number;
  chordHits: number;
  numbersHits: number;
  detectedFormat: ChartFormat;
}

export interface KeyInference {
  totalPages: number;
  processedPages: number[];
  sampledLines: number;
  matchedKeyLines: number;
  keyCandidates: string[];
  inferredKey: string | null;
}

const noteAliases: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  DB: 1,
  D: 2,
  "D#": 3,
  EB: 3,
  E: 4,
  FB: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  GB: 6,
  G: 7,
  "G#": 8,
  AB: 8,
  A: 9,
  "A#": 10,
  BB: 10,
  B: 11,
  CB: 11,
};

const chromaticSharps = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const chromaticFlats = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const keySpecificSpellings: Record<string, Record<number, string>> = {
  Gb: { 11: "Cb" },
  Cb: { 4: "Fb", 11: "Cb" },
};
const majorScaleOffsets = [0, 2, 4, 5, 7, 9, 11];
const offsetToDegree = new Map(majorScaleOffsets.map((offset, index) => [offset, index + 1]));
const flatMajorKeys = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

const notePattern = "[A-G](?:#|b)?";
const keyLineRe = new RegExp(`^(?<prefix>(?:Key|Tono)\\s*-\\s*)(?<key>${notePattern})(?<suffix>.*)$`, "i");
const chordTokenRe = new RegExp(`^(?<open>\\()?(?<root>${notePattern})(?<quality>[^\\s/]*)(?:/(?<bass>${notePattern}))?(?<close>\\))?$`);
const slashBassNoteRe = new RegExp(`^/(?<bass>${notePattern})$`);
const nnsTokenRe = /^(?<open>\()?(?<acc>[#b]?)(?<deg>[1-7])(?<quality>[^\s/]*)(?:\/(?<bassAcc>[#b]?)(?<bassDeg>[1-7]))?(?<close>\))?$/;
const slashBassNnsRe = /^\/(?<bassAcc>[#b]?)(?<bassDeg>[1-7])$/;

export function normalizeNoteName(raw: string): string {
  const cleaned = raw.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const match = /^([A-Ga-g])([#b]?)$/.exec(cleaned);
  if (!match) throw new Error(`Unsupported key: ${raw}`);
  const note = `${match[1].toUpperCase()}${match[2]}`;
  if (!(note.toUpperCase() in noteAliases)) throw new Error(`Unsupported key: ${raw}`);
  return note;
}

export function noteIndex(note: string): number {
  return noteAliases[normalizeNoteName(note).toUpperCase()];
}

export function useFlats(note: string): boolean {
  const normalized = normalizeNoteName(note);
  return flatMajorKeys.has(normalized) || normalized.includes("b");
}

function noteName(index: number, preferFlats: boolean, key?: string): string {
  const normalized = ((index % 12) + 12) % 12;
  const keySpelling = key ? keySpecificSpellings[normalizeNoteName(key)]?.[normalized] : undefined;
  if (keySpelling) return keySpelling;
  return (preferFlats ? chromaticFlats : chromaticSharps)[normalized];
}

function qualityIsNotationLike(quality: string): boolean {
  if (!quality) return true;
  if (quality.includes(".")) return false;
  const letters = quality.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!letters) return true;
  return [...letters].every((letter) => "majinsudgno".includes(letter));
}

function transposeNote(note: string, semitoneShift: number, preferFlats: boolean, key?: string): string {
  return noteName(noteIndex(note) + semitoneShift, preferFlats, key);
}

function noteToDegree(note: string, key: string, preferFlats: boolean): string {
  const interval = (noteIndex(note) - noteIndex(key) + 12) % 12;
  const degree = offsetToDegree.get(interval);
  if (degree !== undefined) return String(degree);

  const candidates: Array<[string, number]> = [];
  majorScaleOffsets.forEach((offset, index) => {
    const diff = (interval - offset + 12) % 12;
    if (diff === 1) candidates.push(["#", index + 1]);
    if (diff === 11) candidates.push(["b", index + 1]);
  });

  if (candidates.length === 0) {
    const nearest = majorScaleOffsets
      .map((offset, index) => [Math.abs(((interval - offset + 6) % 12) - 6), index + 1] as const)
      .sort((a, b) => a[0] - b[0])[0][1];
    return String(nearest);
  }

  candidates.sort((a, b) => {
    const preferred = preferFlats ? "b" : "#";
    return (a[0] === preferred ? 0 : 1) - (b[0] === preferred ? 0 : 1);
  });
  return `${candidates[0][0]}${candidates[0][1]}`;
}

function degreeToNote(accidental: string, degree: number, key: string, preferFlats: boolean): string {
  let semitone = noteIndex(key) + majorScaleOffsets[degree - 1];
  if (accidental === "#") semitone += 1;
  if (accidental === "b") semitone -= 1;
  return noteName(semitone, preferFlats, key);
}

function convertKeyLine(text: string, fromFormat: ChartFormat, toFormat: ChartFormat, fromKey: string, toKey: string): string {
  const match = keyLineRe.exec(text);
  if (!match?.groups) return text;
  const prefix = match.groups.prefix;
  const keyValue = normalizeNoteName(match.groups.key);
  const suffix = match.groups.suffix ?? "";

  if (fromFormat === "chords" && toFormat === "chords") {
    const shift = (noteIndex(toKey) - noteIndex(fromKey) + 12) % 12;
    return `${prefix}${transposeNote(keyValue, shift, useFlats(toKey), toKey)}${suffix}`;
  }
  if (toFormat === "numbers") return `${prefix}${fromKey}${suffix}`;
  return `${prefix}${toKey}${suffix}`;
}

function convertChordTokenToChord(token: string, semitoneShift: number, preferFlats: boolean, key: string): string {
  const compact = token.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const slash = slashBassNoteRe.exec(compact);
  if (slash?.groups) return `/${transposeNote(slash.groups.bass, semitoneShift, preferFlats, key)}`;

  const chord = chordTokenRe.exec(compact);
  if (!chord?.groups) return token;
  const quality = chord.groups.quality ?? "";
  if (!qualityIsNotationLike(quality)) return token;
  const bass = chord.groups.bass ? `/${transposeNote(chord.groups.bass, semitoneShift, preferFlats, key)}` : "";
  return `${chord.groups.open ?? ""}${transposeNote(chord.groups.root, semitoneShift, preferFlats, key)}${quality}${bass}${chord.groups.close ?? ""}`;
}

function convertChordTokenToNumbers(token: string, key: string, preferFlatsNumbers: boolean): string {
  const compact = token.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const slash = slashBassNoteRe.exec(compact);
  if (slash?.groups) return `/${noteToDegree(slash.groups.bass, key, preferFlatsNumbers)}`;

  const chord = chordTokenRe.exec(compact);
  if (!chord?.groups) return token;
  const quality = chord.groups.quality ?? "";
  if (!qualityIsNotationLike(quality)) return token;
  const bass = chord.groups.bass ? `/${noteToDegree(chord.groups.bass, key, preferFlatsNumbers)}` : "";
  return `${chord.groups.open ?? ""}${noteToDegree(chord.groups.root, key, preferFlatsNumbers)}${quality}${bass}${chord.groups.close ?? ""}`;
}

function convertNumbersTokenToChord(token: string, key: string, preferFlatsChords: boolean): string {
  const compact = token.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const slash = slashBassNnsRe.exec(compact);
  if (slash?.groups) return `/${degreeToNote(slash.groups.bassAcc ?? "", Number(slash.groups.bassDeg), key, preferFlatsChords)}`;

  const numbers = nnsTokenRe.exec(compact);
  if (!numbers?.groups) return token;
  const quality = numbers.groups.quality ?? "";
  if (!qualityIsNotationLike(quality)) return token;
  const root = degreeToNote(numbers.groups.acc ?? "", Number(numbers.groups.deg), key, preferFlatsChords);
  const bass = numbers.groups.bassDeg
    ? `/${degreeToNote(numbers.groups.bassAcc ?? "", Number(numbers.groups.bassDeg), key, preferFlatsChords)}`
    : "";
  return `${numbers.groups.open ?? ""}${root}${quality}${bass}${numbers.groups.close ?? ""}`;
}

function convertNumbersTokenToNumbers(token: string, preferFlatsNumbers: boolean): string {
  const compact = token.trim().replaceAll("♭", "b").replaceAll("♯", "#");
  const slash = slashBassNnsRe.exec(compact);
  if (slash?.groups) {
    const accidental = slash.groups.bassAcc ?? "";
    const degree = slash.groups.bassDeg;
    if (preferFlatsNumbers && accidental === "#") return `/${noteToDegree(degreeToNote(accidental, Number(degree), "C", false), "C", true)}`;
    return token;
  }

  const numbers = nnsTokenRe.exec(compact);
  if (!numbers?.groups) return token;
  if (!qualityIsNotationLike(numbers.groups.quality ?? "")) return token;
  return token;
}

export interface TransformTokenOptions {
  fromFormat: ChartFormat;
  toFormat: ChartFormat;
  fromKey: string;
  toKey: string;
  semitoneShift: number;
  preferFlatsChords: boolean;
  preferFlatsNumbers: boolean;
  transposeKeyLines: boolean;
}

export function transformToken(token: string, options: TransformTokenOptions): string {
  const compact = token.trim();
  if (!compact) return token;

  if (options.transposeKeyLines) {
    const convertedKey = convertKeyLine(compact, options.fromFormat, options.toFormat, options.fromKey, options.toKey);
    if (convertedKey !== compact) return convertedKey;
  }

  if (options.fromFormat === "chords" && options.toFormat === "chords") {
    return convertChordTokenToChord(compact, options.semitoneShift, options.preferFlatsChords, options.toKey);
  }
  if (options.fromFormat === "chords" && options.toFormat === "numbers") {
    return convertChordTokenToNumbers(compact, options.fromKey, options.preferFlatsNumbers);
  }
  if (options.fromFormat === "numbers" && options.toFormat === "chords") {
    return convertNumbersTokenToChord(compact, options.toKey, options.preferFlatsChords);
  }
  return convertNumbersTokenToNumbers(compact, options.preferFlatsNumbers);
}

export function countTokenHits(tokens: string[]): [number, number] {
  let chordHits = 0;
  let numbersHits = 0;
  for (const token of tokens) {
    const compact = token.trim().replaceAll("♭", "b").replaceAll("♯", "#");
    if (!compact || keyLineRe.test(compact)) continue;

    const chord = chordTokenRe.exec(compact);
    if (slashBassNoteRe.test(compact) || (chord?.groups && qualityIsNotationLike(chord.groups.quality ?? ""))) chordHits += 1;

    const numbers = nnsTokenRe.exec(compact);
    if (slashBassNnsRe.test(compact) || (numbers?.groups && qualityIsNotationLike(numbers.groups.quality ?? ""))) numbersHits += 1;
  }
  return [chordHits, numbersHits];
}

export function detectChartFormat(tokens: string[]): ChartFormat {
  const [chordHits, numbersHits] = countTokenHits(tokens);
  return numbersHits > chordHits ? "numbers" : "chords";
}

export function parsePagesSpec(spec: string, pageCount: number): number[] {
  const trimmed = spec.trim().toLowerCase();
  if (trimmed === "all" || trimmed === "*") return Array.from({ length: pageCount }, (_, index) => index);

  const result = new Set<number>();
  for (const part of spec.split(",")) {
    const item = part.trim();
    if (!item) continue;
    if (item.includes("-")) {
      const [startText, endText] = item.split("-", 2);
      const start = Number.parseInt(startText, 10);
      const end = Number.parseInt(endText, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(`Invalid page range: ${item}`);
      if (start <= 0 || end <= 0) throw new Error(`Page numbers must be 1-based positive integers: ${item}`);
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) result.add(page - 1);
    } else {
      const page = Number.parseInt(item, 10);
      if (!Number.isInteger(page)) throw new Error(`Invalid page number: ${item}`);
      if (page <= 0) throw new Error(`Page numbers must be 1-based positive integers: ${item}`);
      result.add(page - 1);
    }
  }

  if (result.size === 0) throw new Error("No pages selected");
  const outOfRange = [...result].filter((page) => page < 0 || page >= pageCount).map((page) => page + 1).sort((a, b) => a - b);
  if (outOfRange.length) throw new Error(`Page(s) out of range for document with ${pageCount} pages: ${outOfRange.join(", ")}`);
  return [...result].sort((a, b) => a - b);
}

export function inferKeyFromTokens(tokens: string[]): string | null {
  const candidates: string[] = [];
  for (const token of tokens) {
    const match = keyLineRe.exec(token.trim().replaceAll("♭", "b").replaceAll("♯", "#"));
    if (match?.groups) candidates.push(normalizeNoteName(match.groups.key));
  }
  return mostCommonPreservingFirst(candidates);
}

function mostCommonPreservingFirst(values: string[]): string | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const value of values) {
    if (!counts.has(value)) order.push(value);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let max = 0;
  counts.forEach((count) => {
    max = Math.max(max, count);
  });
  return order.find((value) => counts.get(value) === max) ?? null;
}

export function resolveTransformPreferences(fromKey: string, toKey: string, accidentalPreference: AccidentalsPreference) {
  const normalizedFromKey = normalizeNoteName(fromKey);
  const normalizedToKey = normalizeNoteName(toKey);
  const semitoneShift = (noteIndex(normalizedToKey) - noteIndex(normalizedFromKey) + 12) % 12;
  const preferFlatsChords = accidentalPreference === "auto" ? useFlats(normalizedToKey) : accidentalPreference === "flat";
  const preferFlatsNumbers = accidentalPreference === "auto" ? useFlats(normalizedFromKey) : accidentalPreference === "flat";
  return { normalizedFromKey, normalizedToKey, semitoneShift, preferFlatsChords, preferFlatsNumbers };
}
