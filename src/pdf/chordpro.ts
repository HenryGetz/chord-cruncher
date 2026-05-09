import { normalizeNoteName, transformToken, useFlats } from "../core/music.js";
import { extractPdfText, type PdfSpan } from "./songselectPdf.js";

interface ChordProSpan {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fontName: string;
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
}

interface ChordProLine {
  spans: ChordProSpan[];
  y0: number;
  y1: number;
  pageIndex: number;
}

export interface ChordProMetadata {
  title: string;
  artists: string[];
  key: string;
  tempo: string;
  timeSignature: string;
  notes: string[];
}

export interface ChordProConversionResult {
  chordproText: string;
  metadata: ChordProMetadata;
  pages: number;
  sectionCount: number;
  lyricLines: number;
  chordLines: number;
}

export type ChordProOutputKey = string | "numbers";

export interface ConvertChordProOptions {
  outputKey?: ChordProOutputKey;
}

const sectionRe = /^(?:INTRO|OUTRO|TAG(?:\s+[0-9A-Z]+)?|TURN(?:AROUND)?|INSTR(?:UMENTAL)?(?:\s+\d+)?|INTERLUDE|ENDING|VERSE(?:\s+[0-9A-Z]+)?|VERSO(?:\s+[0-9A-Z]+)?|CHORUS(?:\s+[0-9A-Z]+)?|CORO(?:\s+[0-9A-Z]+)?|PRE[- ]?CHORUS(?:\s+[0-9A-Z]+)?|PRE[- ]?CORO(?:\s+[0-9A-Z]+)?|POST[- ]?CHORUS(?:\s+[0-9A-Z]+)?|PUENTE(?:\s+[0-9A-Z]+)?|BRIDGE(?:\s+[0-9A-Z]+)?|REFRAIN(?:\s+[0-9A-Z]+)?)$/i;
const keyLineRe = /(?:^|\|)\s*(?:Key|Tono)\s*-\s*(?<key>[A-G][#b]?)\b/i;
const tempoRe = /(?:^|\|)\s*Tempo\s*-\s*(?<tempo>\d+)\b/i;
const timeRe = /(?:^|\|)\s*(?:Time|Hora)\s*-\s*(?<time>\d+\/\d+)\b/i;
const chordNameRe = /^[A-G](?:#|b)?(?:maj|min|m|sus|add|dim|aug|°|\+|-)?[0-9A-Za-z()/#b+\-°]*$/;
const extensionFragmentRe = /^(?:2|4|5|6|7|9|11|13|sus|sus2|sus4|add\d+|\(4\))$/i;
const compactNashvilleRe = /[#b]?[1-7](?:m(?:aj)?\d*|maj\d*|sus\d*|\d+sus\d*|add\d+|dim|aug|°|\d+)?(?:\/[#b]?[1-7])?/y;
const annotationRe = /^\(.+\)$/;
const barTokens = new Set(["|", "||", "||:", ":||", "/", "|/", "/|"]);

function cleanPdfText(text: string): string {
  return text.replaceAll("\u0000", "fi");
}

function cleanSpace(text: string): string {
  return text.replaceAll("\u00a0", " ").replace(/\s+/g, " ");
}

function looksLikeFooter(text: string): boolean {
  const upper = text.toUpperCase();
  return upper.startsWith("PAGE ")
    || upper.startsWith("CCLI SONG #")
    || text.startsWith("©")
    || upper.includes("SONGSELECT")
    || upper.includes("WWW.CCLI.COM")
    || upper.includes("CCLI LICENSE")
    || upper.includes("FOR USE SOLELY")
    || upper.includes("TERMS OF USE")
    || upper.includes(" PUBLISHING")
    || upper === "UNAFFILIATED"
    || /^.+\s-\s\d+$/.test(text.trim());
}

function toChordProSpan(span: PdfSpan): ChordProSpan {
  return {
    text: cleanPdfText(span.text),
    x0: span.x,
    x1: span.x + span.width,
    y0: span.y,
    y1: span.y + span.height,
    fontName: span.fontName,
    fontSize: span.fontSize,
    isBold: span.isBold,
    isItalic: /italic/i.test(span.fontName),
  };
}

function lineText(line: ChordProLine): string {
  const spans = [...line.spans].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const out: string[] = [];
  let previousX1: number | null = null;
  for (const span of spans) {
    if (previousX1 !== null && span.x0 - previousX1 > 1.5 && out.length && !out[out.length - 1].endsWith(" ")) out.push(" ");
    out.push(span.text);
    previousX1 = span.x1;
  }
  return out.join("");
}

function lineX0(line: ChordProLine): number {
  return Math.min(...line.spans.map((span) => span.x0));
}

function lineX1(line: ChordProLine): number {
  return Math.max(...line.spans.map((span) => span.x1));
}

function lineSortKey(line: ChordProLine): [number, number, number] {
  return [line.pageIndex, Math.round(line.y0 / 2), lineX0(line)];
}

function sortLines(lines: ChordProLine[]): ChordProLine[] {
  return [...lines].sort((a, b) => {
    const left = lineSortKey(a);
    const right = lineSortKey(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  });
}

function buildChordProLines(spans: ChordProSpan[], pageIndex: number): ChordProLine[] {
  const sorted = [...spans].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const yGroups: ChordProSpan[][] = [];
  for (const span of sorted) {
    const group = yGroups.find((candidate) => Math.abs(candidate[0].y0 - span.y0) <= Math.max(2, span.fontSize * 0.35));
    if (group) group.push(span);
    else yGroups.push([span]);
  }

  const rawLines: ChordProLine[] = [];
  for (const group of yGroups) {
    let current: ChordProSpan[] = [];
    let previousX1: number | null = null;
    for (const span of [...group].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)) {
      if (current.length && previousX1 !== null && span.x0 - previousX1 > 120) {
        rawLines.push(makeLine(current, pageIndex));
        current = [];
      }
      current.push(span);
      previousX1 = span.x1;
    }
    if (current.length) rawLines.push(makeLine(current, pageIndex));
  }

  const mergedLines: ChordProLine[] = [];
  for (const line of sortLines(rawLines)) {
    const previous = mergedLines.at(-1);
    if (previous
      && line.pageIndex === previous.pageIndex
      && Math.abs(line.y0 - previous.y0) <= 1.5
      && Math.abs(line.y1 - previous.y1) <= 1.5
      && lineX0(line) - lineX1(previous) >= -5
      && lineX0(line) - lineX1(previous) <= 90) {
      previous.spans.push(...line.spans);
      previous.spans.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
      previous.y0 = Math.min(previous.y0, line.y0);
      previous.y1 = Math.max(previous.y1, line.y1);
      continue;
    }
    mergedLines.push(line);
  }

  const leftCount = mergedLines.filter((line) => lineX0(line) < 220).length;
  const rightCount = mergedLines.filter((line) => lineX0(line) >= 300).length;
  if (leftCount < 5 || rightCount < 5) return sortLines(mergedLines);

  const headerLines = mergedLines.filter((line) => line.y0 < 110);
  const bodyLines = mergedLines.filter((line) => line.y0 >= 110);
  return [...headerLines, ...bodyLines.filter((line) => lineX0(line) < 300), ...bodyLines.filter((line) => lineX0(line) >= 300)];
}

function extractChordProLines(spans: PdfSpan[], pageIndex: number): ChordProLine[] {
  const chordProSpans = spans.map(toChordProSpan);
  const firstSectionY = Math.min(
    ...chordProSpans
      .filter((span) => sectionRe.test(cleanSpace(span.text).trim()))
      .map((span) => span.y0),
  );
  const bodyStartY = Number.isFinite(firstSectionY) ? Math.min(110, firstSectionY) : 110;
  const bodySpans = chordProSpans.filter((span) => span.y0 >= bodyStartY);
  const hasLeftColumn = bodySpans.filter((span) => span.x0 < 220).length >= 5;
  const hasRightColumn = bodySpans.filter((span) => span.x0 >= 300).length >= 5;
  if (!hasLeftColumn || !hasRightColumn) return buildChordProLines(chordProSpans, pageIndex);

  const headerSpans = chordProSpans.filter((span) => span.y0 < bodyStartY);
  const leftSpans = bodySpans.filter((span) => span.x0 < 300);
  const rightSpans = bodySpans.filter((span) => span.x0 >= 300);
  return [
    ...buildChordProLines(headerSpans, pageIndex),
    ...buildChordProLines(leftSpans, pageIndex),
    ...buildChordProLines(rightSpans, pageIndex),
  ];
}

function makeLine(spans: ChordProSpan[], pageIndex: number): ChordProLine {
  return {
    spans,
    y0: Math.min(...spans.map((span) => span.y0)),
    y1: Math.max(...spans.map((span) => span.y1)),
    pageIndex,
  };
}

function splitCompactNashvilleTokens(text: string): string[] | null {
  const compact = text.trim();
  if (!compact || !/^[0-9A-Za-z#b°|:.()/\-]+$/.test(compact)) return null;

  const tokens: string[] = [];
  let index = 0;
  while (index < compact.length) {
    const char = compact[index];
    if ("|:./".includes(char)) {
      const start = index;
      while (index < compact.length && "|:./".includes(compact[index])) index += 1;
      tokens.push(compact.slice(start, index));
      continue;
    }

    compactNashvilleRe.lastIndex = index;
    const match = compactNashvilleRe.exec(compact);
    if (!match || match.index !== index) return null;
    tokens.push(match[0]);
    index = compactNashvilleRe.lastIndex;
  }

  return tokens.length > 1 ? tokens : null;
}

function normalizeNumericToken(token: string): string {
  return token.trim().replace(/^(?<prefix>[#b]?[1-7])\(4\)$/i, "$<prefix>sus");
}

function numericChordToChord(token: string, key: string): string {
  const normalizedToken = normalizeNumericToken(token);
  return transformToken(normalizedToken, {
    fromFormat: "numbers",
    toFormat: "chords",
    fromKey: key,
    toKey: key,
    semitoneShift: 0,
    preferFlatsChords: useFlats(key),
    preferFlatsNumbers: useFlats(key),
    transposeKeyLines: false,
  });
}

function isNumericChord(token: string, key: string): boolean {
  const stripped = token.trim();
  return Boolean(stripped) && numericChordToChord(stripped, key) !== stripped;
}

function isChordishText(token: string, key: string): boolean {
  const stripped = token.trim();
  if (!stripped) return false;
  if (barTokens.has(stripped) || stripped === "N.C." || annotationRe.test(stripped)) return true;
  if (isNumericChord(stripped, key)) return true;
  if (splitCompactNashvilleTokens(stripped)) return true;
  return chordNameRe.test(stripped);
}

function formatChordToken(token: string, key: string, preserveNumbers: boolean): string {
  const stripped = token.trim();
  if (!stripped) return "";
  const compactTokens = splitCompactNashvilleTokens(stripped);
  if (compactTokens) return compactTokens.map((part) => formatChordToken(part, key, preserveNumbers)).filter(Boolean).join(" ");
  if (barTokens.has(stripped)) return stripped;
  if (stripped === "N.C.") return "[N.C.]";
  if (isNumericChord(stripped, key)) return `[${preserveNumbers ? normalizeNumericToken(stripped) : numericChordToChord(stripped, key)}]`;
  if (chordNameRe.test(stripped)) return `[${stripped}]`;
  return stripped;
}

function mergeChordSpans(spans: ChordProSpan[], key: string): ChordProSpan[] {
  const merged: ChordProSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.x0 - b.x0)) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(span);
      continue;
    }
    const gap = span.x0 - previous.x1;
    const extensionFragment = extensionFragmentRe.test(span.text.trim());
    const closeExtension = gap <= 1.5 && Math.abs(span.y0 - previous.y0) <= 4;
    const superscriptExtension = gap <= 8 && span.fontSize < previous.fontSize && span.y0 <= previous.y0 && Math.abs(span.y0 - previous.y0) <= 8;
    if (extensionFragment && isChordishText(previous.text, key) && (closeExtension || superscriptExtension)) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + span.text,
        x1: span.x1,
        y0: Math.min(previous.y0, span.y0),
        y1: Math.max(previous.y1, span.y1),
        fontSize: Math.max(previous.fontSize, span.fontSize),
      };
      continue;
    }
    merged.push(span);
  }
  return merged;
}

function isSectionLine(line: ChordProLine): boolean {
  const text = cleanSpace(lineText(line)).trim();
  if (!text) return false;
  return sectionRe.test(text);
}

function classifyContentLine(line: ChordProLine, key: string): "blank" | "section" | "skip" | "chord" | "lyric" | "other" {
  const text = cleanSpace(lineText(line)).trim();
  if (!text) return "blank";
  if (isSectionLine(line)) return "section";
  if (looksLikeFooter(text)) return "skip";
  if (line.spans.every((span) => span.isBold || span.isItalic) && /[1-7]/.test(text)) return "chord";

  let chordish = 0;
  let lyricish = 0;
  let annotations = 0;
  for (const span of mergeChordSpans(line.spans, key)) {
    const token = span.text.trim();
    if (!token) continue;
    if (isInstructionAnnotation(token)) annotations += 1;
    else if (isChordishText(token, key)) chordish += 1;
    else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ']/.test(token)) lyricish += 1;
  }

  if (chordish && annotations && lyricish === 0) return "chord";
  if (chordish && lyricish === 0) return "chord";
  if (lyricish) return "lyric";
  return "other";
}

function hasChordLineAnnotation(line: ChordProLine): boolean {
  return line.spans.some((span) => isInstructionAnnotation(span.text.trim()));
}

function isInstructionAnnotation(token: string): boolean {
  return annotationRe.test(token) && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(token);
}

function cleanLyricFragment(text: string, isFirst: boolean): string {
  const normalized = cleanSpace(text);
  return isFirst ? normalized.trimStart() : normalized;
}

function splitLyricSpans(spans: ChordProSpan[]): ChordProSpan[] {
  const fragments: ChordProSpan[] = [];
  for (const span of spans) {
    const matches = [...span.text.matchAll(/\S+\s*/g)];
    if (matches.length <= 1) {
      fragments.push(span);
      continue;
    }
    const widthPerChar = span.text.length ? (span.x1 - span.x0) / span.text.length : 0;
    for (const match of matches) {
      const text = match[0];
      const start = match.index ?? 0;
      const x0 = span.x0 + start * widthPerChar;
      fragments.push({ ...span, text, x0, x1: x0 + text.length * widthPerChar });
    }
  }
  return fragments;
}

function renderChordProLyricLine(chordSpans: ChordProSpan[], lyricSpans: ChordProSpan[], key: string, preserveNumbers: boolean): string {
  const mergedChords = mergeChordSpans(chordSpans, key).sort((a, b) => a.x0 - b.x0);
  const lyrics = splitLyricSpans(lyricSpans).sort((a, b) => a.x0 - b.x0);
  const out: string[] = [];
  let chordIndex = 0;
  let previousLyricX1: number | null = null;

  lyrics.forEach((lyric, lyricIndex) => {
    let insertedChord = false;
    while (chordIndex < mergedChords.length && mergedChords[chordIndex].x0 <= lyric.x0 + 2) {
      if (previousLyricX1 !== null && mergedChords[chordIndex].x0 - previousLyricX1 > 1 && out.length && !out[out.length - 1].endsWith(" ")) {
        out.push(" ");
      }
      const formatted = formatChordToken(mergedChords[chordIndex].text, key, preserveNumbers);
      if (formatted) {
        out.push(formatted);
        insertedChord = true;
      }
      chordIndex += 1;
    }
    if (!insertedChord && previousLyricX1 !== null && lyric.x0 - previousLyricX1 > 1 && out.length && !out[out.length - 1].endsWith(" ")) {
      out.push(" ");
    }
    out.push(insertedChord ? cleanLyricFragment(lyric.text, lyricIndex === 0).trimStart() : cleanLyricFragment(lyric.text, lyricIndex === 0));
    previousLyricX1 = lyric.x1;
  });

  while (chordIndex < mergedChords.length) {
    if (previousLyricX1 !== null && mergedChords[chordIndex].x0 - previousLyricX1 > 1 && out.length && !out[out.length - 1].endsWith(" ")) {
      out.push(" ");
    }
    const formatted = formatChordToken(mergedChords[chordIndex].text, key, preserveNumbers);
    if (formatted) out.push(formatted);
    chordIndex += 1;
  }

  return out.join("").trimEnd().replace(/\s{2,}/g, " ");
}

function renderChordProChordLine(chordSpans: ChordProSpan[], key: string, preserveNumbers: boolean): string {
  const merged = mergeChordSpans(chordSpans, key);
  const chunks: string[] = [];
  merged.sort((a, b) => a.x0 - b.x0).forEach((span, index) => {
    if (index) {
      const gap = span.x0 - merged[index - 1].x1;
      if (gap > 8) chunks.push(" ");
    }
    chunks.push(formatChordToken(span.text, key, preserveNumbers));
  });
  return chunks.join("").replaceAll("|[", "| [").replaceAll("]|", "] |").trim().replace(/\s{2,}/g, " ").replaceAll("..", ". .");
}

function metadataLines(metadata: ChordProMetadata): string[] {
  const lines: string[] = [];
  if (metadata.title) lines.push(`{title: ${metadata.title}}`);
  if (metadata.artists.length) lines.push(`{artist: ${metadata.artists.join(" | ")}}`);
  if (metadata.key) lines.push(`{key: ${metadata.key}}`);
  if (metadata.tempo) lines.push(`{tempo: ${metadata.tempo}}`);
  if (metadata.timeSignature) lines.push(`{time: ${metadata.timeSignature}}`);
  for (const note of metadata.notes) lines.push(`{comment: ${note}}`);
  return lines;
}

function parseMetadata(lines: ChordProLine[]): { metadata: ChordProMetadata; consumed: number } {
  const metadata: ChordProMetadata = { title: "", artists: [], key: "", tempo: "", timeSignature: "", notes: [] };
  let consumed = 0;

  for (const [index, line] of lines.entries()) {
    const text = cleanSpace(lineText(line)).trim();
    if (!text) {
      consumed = index + 1;
      continue;
    }
    if (!metadata.title && line.spans.some((span) => span.fontSize >= 14)) {
      metadata.title = text;
      consumed = index + 1;
      continue;
    }
    const keyMatch = keyLineRe.exec(text);
    if (keyMatch?.groups) {
      metadata.key = normalizeNoteName(keyMatch.groups.key);
      metadata.tempo = tempoRe.exec(text)?.groups?.tempo ?? metadata.tempo;
      metadata.timeSignature = timeRe.exec(text)?.groups?.time ?? metadata.timeSignature;
      consumed = index + 1;
      continue;
    }
    if (sectionRe.test(text)) break;
    if (looksLikeFooter(text)) {
      consumed = index + 1;
      continue;
    }
    if (line.spans.some((span) => span.fontSize <= 8.5)) {
      if (text.startsWith("(") && text.endsWith(")")) metadata.notes.push(text);
      else metadata.artists.push(text.replace(/^\|\s*/, ""));
      consumed = index + 1;
      continue;
    }
    break;
  }

  metadata.artists = metadata.artists.filter(Boolean);
  metadata.notes = metadata.notes.filter(Boolean);
  return { metadata, consumed };
}

export async function convertPdfToChordPro(inputPdf: Uint8Array, options: ConvertChordProOptions = {}): Promise<ChordProConversionResult> {
  const extracted = await extractPdfText(inputPdf);
  const allLines = extracted.pages.flatMap((page) => extractChordProLines(page.spans, page.pageIndex));
  const { metadata, consumed } = parseMetadata(allLines);
  if (!metadata.key) metadata.key = "C";
  const preserveNumbers = options.outputKey === "numbers";
  const key = preserveNumbers ? metadata.key : options.outputKey ? normalizeNoteName(options.outputKey) : metadata.key;
  if (!preserveNumbers) metadata.key = key;
  const output = metadataLines(metadata);
  if (output.length) output.push("");

  let sectionCount = 0;
  let lyricLines = 0;
  let chordLines = 0;
  let previousBlank = Boolean(output.length && output.at(-1) === "");
  const lines = allLines.slice(consumed);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const kind = classifyContentLine(line, key);
    if (kind === "blank" || kind === "skip") {
      if (!previousBlank && output.length) {
        output.push("");
        previousBlank = true;
      }
      index += 1;
      continue;
    }
    if (kind === "section") {
      if (!previousBlank && output.length) output.push("");
      output.push(`{comment: ${cleanSpace(lineText(line)).trim()}}`);
      previousBlank = false;
      sectionCount += 1;
      index += 1;
      continue;
    }
    if (kind === "chord") {
      const nextLine = lines[index + 1];
      if (nextLine && !hasChordLineAnnotation(line)) {
        const nextKind = classifyContentLine(nextLine, key);
        const verticalGap = nextLine.y0 - line.y0;
        if (nextKind === "lyric" && verticalGap >= 4 && verticalGap <= 20) {
          const rendered = renderChordProLyricLine(line.spans, nextLine.spans, key, preserveNumbers);
          if (rendered) {
            output.push(rendered);
            previousBlank = false;
            lyricLines += 1;
          }
          index += 2;
          continue;
        }
      }
      const rendered = renderChordProChordLine(line.spans, key, preserveNumbers);
      if (rendered) {
        output.push(rendered);
        previousBlank = false;
        chordLines += 1;
      }
      index += 1;
      continue;
    }
    if (kind === "lyric") {
      const rendered = cleanSpace(lineText(line)).trim();
      if (rendered && !looksLikeFooter(rendered)) {
        output.push(rendered);
        previousBlank = false;
        lyricLines += 1;
      }
      index += 1;
      continue;
    }
    const rendered = cleanSpace(lineText(line)).trim();
    if (rendered && !looksLikeFooter(rendered)) {
      output.push(`{comment: ${rendered}}`);
      previousBlank = false;
    }
    index += 1;
  }

  return {
    chordproText: `${output.map((line) => line.trimEnd()).join("\n").trim()}\n`,
    metadata,
    pages: extracted.totalPages,
    sectionCount,
    lyricLines,
    chordLines,
  };
}
