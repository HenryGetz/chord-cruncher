import {
  type PDFFont,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
} from "pdf-lib";
import {
  type AccidentalsPreference,
  type ChartFormat,
  type ChartInspection,
  type InputChartFormat,
  type KeyInference,
  type KeyShiftStats,
  countTokenHits,
  detectChartFormat,
  inferKeyFromTokens,
  parsePagesSpec,
  resolveTransformPreferences,
  transformToken,
} from "../core/music.js";

export interface PdfSpan {
  text: string;
  pageIndex: number;
  x: number;
  y: number;
  baselineY: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  isBold: boolean;
  rawTransform: number[];
}

interface EmbeddedFontEncoder {
  resourceName: PDFName;
  encode(text: string): string | null;
}

export interface PdfPageText {
  pageIndex: number;
  lines: string[];
  spans: PdfSpan[];
}

export interface ConvertPdfOptions {
  inputPdf: Uint8Array;
  fromKey: string;
  toKey: string;
  fromFormat?: InputChartFormat;
  toFormat?: ChartFormat;
  pages?: string;
  fontScale?: number;
  minFontSize?: number;
  boldOnly?: boolean;
  transposeKeyLines?: boolean;
  accidentalPreference?: AccidentalsPreference;
  forceRewriteUnchanged?: boolean;
}

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy?(): Promise<void>;
};

type PdfJsPage = {
  getTextContent(): Promise<{ items: unknown[]; styles?: Record<string, { fontFamily?: string }> }>;
  getViewport(options: { scale: number }): { height: number };
};

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

async function openPdf(data: Uint8Array): Promise<PdfJsDocument> {
  const pdfjs = await loadPdfJs();
  const documentOptions: Record<string, unknown> = {
    data: new Uint8Array(data),
    disableWorker: typeof window === "undefined",
  };
  if (typeof window === "undefined") {
    documentOptions.standardFontDataUrl = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
  }
  const loadingTask = pdfjs.getDocument(documentOptions);
  return (await loadingTask.promise) as PdfJsDocument;
}

export async function extractPdfText(inputPdf: Uint8Array): Promise<{ totalPages: number; pages: PdfPageText[] }> {
  const doc = await openPdf(inputPdf);
  try {
    const pages: PdfPageText[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const spans: PdfSpan[] = [];
      const lines: string[] = [];
      let previousY: number | null = null;
      let currentLine: string[] = [];

      for (const rawItem of textContent.items) {
        const item = rawItem as PdfTextItem;
        const text = item.str ?? "";
        if (!text.trim()) continue;
        const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
        const x = transform[4] ?? 0;
        const baselineY = transform[5] ?? 0;
        const fontSize = Math.abs(transform[3] ?? item.height ?? 10) || 10;
        const height = item.height ?? fontSize;
        const topY = viewport.height - baselineY - height;
        const fontName = item.fontName ?? "";
        const family = textContent.styles?.[fontName]?.fontFamily ?? "";
        const isBold = /bold/i.test(fontName) || /bold/i.test(family);

        if (previousY === null || Math.abs(topY - previousY) <= Math.max(2, fontSize * 0.45)) {
          currentLine.push(text.trim());
        } else {
          if (currentLine.length) lines.push(currentLine.join(" "));
          currentLine = [text.trim()];
        }
        previousY = topY;

        spans.push({
          text,
          pageIndex: pageNumber - 1,
          x,
          y: topY,
          baselineY,
          width: item.width ?? text.length * fontSize * 0.55,
          height,
          fontSize,
          fontName,
          isBold,
          rawTransform: transform,
        });
      }
      if (currentLine.length) lines.push(currentLine.join(" "));
      pages.push({ pageIndex: pageNumber - 1, lines, spans });
    }
    return { totalPages: doc.numPages, pages };
  } finally {
    await doc.destroy?.();
  }
}

export async function inspectSongselectPdf(inputPdf: Uint8Array, pages = "all", boldOnly = true): Promise<ChartInspection> {
  const extracted = await extractPdfText(inputPdf);
  const pageIndexes = parsePagesSpec(pages, extracted.totalPages);
  const sampledTokens = extracted.pages
    .filter((page) => pageIndexes.includes(page.pageIndex))
    .flatMap((page) => page.spans)
    .filter((span) => !boldOnly || span.isBold)
    .map((span) => span.text.trim())
    .filter(Boolean);
  const [chordHits, numbersHits] = countTokenHits(sampledTokens);
  return {
    totalPages: extracted.totalPages,
    processedPages: pageIndexes.map((index) => index + 1),
    boldOnly,
    sampledTokens: sampledTokens.length,
    chordHits,
    numbersHits,
    detectedFormat: numbersHits > chordHits ? "numbers" : "chords",
  };
}

export async function inferKeyFromPdf(inputPdf: Uint8Array, pages = "all"): Promise<KeyInference> {
  const extracted = await extractPdfText(inputPdf);
  const pageIndexes = parsePagesSpec(pages, extracted.totalPages);
  const lines = extracted.pages.filter((page) => pageIndexes.includes(page.pageIndex)).flatMap((page) => page.lines.map((line) => line.trim()).filter(Boolean));
  const keyCandidates = lines
    .map((line) => inferKeyFromTokens([line]))
    .filter((key): key is string => key !== null);
  return {
    totalPages: extracted.totalPages,
    processedPages: pageIndexes.map((index) => index + 1),
    sampledLines: lines.length,
    matchedKeyLines: keyCandidates.length,
    keyCandidates,
    inferredKey: inferKeyFromTokens(lines),
  };
}

function measureTextWidth(font: PDFFont, text: string, fontSize: number): number {
  return font.widthOfTextAtSize(text, fontSize);
}

function parseReverseToUnicodeMap(cmap: string): Map<string, string> {
  const reverse = new Map<string, string>();
  const rangePattern = /<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>\s+\[((?:\s*<[^>]+>)+)\]/g;
  for (const match of cmap.matchAll(rangePattern)) {
    const startCid = Number.parseInt(match[1], 16);
    const unicodeValues = [...match[3].matchAll(/<([0-9A-Fa-f]{4,6})>/g)].map((valueMatch) => valueMatch[1]);
    unicodeValues.forEach((unicodeHex, index) => {
      const char = String.fromCodePoint(Number.parseInt(unicodeHex, 16));
      const cidHex = (startCid + index).toString(16).padStart(4, "0").toUpperCase();
      if (!reverse.has(char)) reverse.set(char, cidHex);
    });
  }
  return reverse;
}

function getEmbeddedFontEncoder(pdfDoc: PDFDocument): EmbeddedFontEncoder | null {
  const page = pdfDoc.getPage(0);
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of("Font"));
  if (!(fonts instanceof PDFDict)) return null;

  for (const key of fonts.keys()) {
    const fontObject = pdfDoc.context.lookup(fonts.get(key));
    if (!(fontObject instanceof PDFDict)) continue;
    const baseFont = fontObject.lookup(PDFName.of("BaseFont"));
    if (!baseFont?.toString().toLowerCase().includes("verdana")) continue;
    const toUnicode = fontObject.lookup(PDFName.of("ToUnicode"));
    if (!(toUnicode instanceof PDFRawStream)) continue;
    const reverseMap = parseReverseToUnicodeMap(toUnicode.getContentsString());
    return {
      resourceName: key,
      encode(text: string): string | null {
        let encoded = "";
        for (const char of text) {
          const cidHex = reverseMap.get(char);
          if (!cidHex) return null;
          encoded += cidHex;
        }
        return encoded;
      },
    };
  }
  return null;
}

export async function convertSongselectPdf(options: ConvertPdfOptions): Promise<{ bytes: Uint8Array; stats: KeyShiftStats }> {
  const fromFormat = options.fromFormat ?? "auto";
  const toFormat = options.toFormat ?? "chords";
  const pages = options.pages ?? "all";
  const fontScale = options.fontScale ?? 1;
  const minFontSize = options.minFontSize ?? 6;
  const boldOnly = options.boldOnly ?? true;
  const transposeKeyLines = options.transposeKeyLines ?? true;
  const accidentalPreference = options.accidentalPreference ?? "auto";
  const forceRewriteUnchanged = options.forceRewriteUnchanged ?? false;

  if (fontScale <= 0) throw new Error("font_scale must be > 0");
  if (minFontSize <= 0) throw new Error("min_font_size must be > 0");
  if (!["auto", "sharp", "flat"].includes(accidentalPreference)) throw new Error("accidental_preference must be one of: auto, sharp, flat");

  const extracted = await extractPdfText(options.inputPdf);
  const pdfDoc = await PDFDocument.load(options.inputPdf.slice());
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const embeddedFontEncoder = getEmbeddedFontEncoder(pdfDoc);
  const pageIndexes = parsePagesSpec(pages, extracted.totalPages);
  const sampledTokens = extracted.pages
    .filter((page) => pageIndexes.includes(page.pageIndex))
    .flatMap((page) => page.spans)
    .filter((span) => !boldOnly || span.isBold)
    .map((span) => span.text.trim())
    .filter(Boolean);
  const detectedFromFormat = fromFormat === "auto" ? detectChartFormat(sampledTokens) : fromFormat;
  const prefs = resolveTransformPreferences(options.fromKey, options.toKey, accidentalPreference);
  const replacements: Array<PdfSpan & { original: string; converted: string; drawSize: number; drawWidth: number; changed: boolean }> = [];

  for (const page of extracted.pages) {
    if (!pageIndexes.includes(page.pageIndex)) continue;
    for (const span of page.spans) {
      const compact = span.text.trim();
      if (!compact) continue;
      if (boldOnly && !span.isBold) continue;
      const converted = transformToken(compact, {
        fromFormat: detectedFromFormat,
        toFormat,
        fromKey: prefs.normalizedFromKey,
        toKey: prefs.normalizedToKey,
        semitoneShift: prefs.semitoneShift,
        preferFlatsChords: prefs.preferFlatsChords,
        preferFlatsNumbers: prefs.preferFlatsNumbers,
        transposeKeyLines,
      });
      const changed = converted !== compact;
      const [chordHits, numbersHits] = countTokenHits([compact]);
      const isNotationCandidate = chordHits > 0 || numbersHits > 0;
      if (!changed && (!forceRewriteUnchanged || !isNotationCandidate)) continue;
      if (!changed) continue;
      let drawSize = Math.max(minFontSize, span.fontSize * fontScale);
      let drawWidth = measureTextWidth(font, converted, drawSize);
      const oldWidth = Math.max(span.width, measureTextWidth(font, compact, drawSize));
      const maxWidth = oldWidth > 0 ? oldWidth * 1.03 : drawWidth;
      if (drawWidth > maxWidth && drawWidth > 0) {
        const smallestReadableSize = span.fontSize * fontScale * 0.88;
        drawSize = Math.max(minFontSize, smallestReadableSize, drawSize * (maxWidth / drawWidth) * 0.99);
        drawWidth = measureTextWidth(font, converted, drawSize);
      }
      replacements.push({ ...span, original: compact, converted, drawSize, drawWidth, changed });
    }
  }

  const changedPages = new Set<number>();
  for (const replacement of replacements) {
    const page = pdfDoc.getPage(replacement.pageIndex);
    const baselineY = replacement.baselineY;
    const drawX = replacement.changed ? replacement.x + (replacement.width - replacement.drawWidth) / 2 : replacement.x;
    const encodedOriginal = embeddedFontEncoder?.encode(replacement.original) ?? null;
    const encodedConverted = embeddedFontEncoder?.encode(replacement.converted) ?? null;

    if (embeddedFontEncoder && encodedOriginal && encodedConverted) {
      const [a, b, c, d] = replacement.rawTransform;
      const matrixScale = replacement.fontSize || 1;
      const matrixA = (a ?? matrixScale) / matrixScale;
      const matrixB = (b ?? 0) / matrixScale;
      const matrixC = (c ?? 0) / matrixScale;
      const matrixD = (d ?? matrixScale) / matrixScale;
      const operators = [pushGraphicsState()];
      if (replacement.changed) {
        operators.push(
          setFillingRgbColor(1, 1, 1),
          beginText(),
          setFontAndSize(embeddedFontEncoder.resourceName, replacement.drawSize),
          setTextMatrix(matrixA, matrixB, matrixC, matrixD, replacement.x, baselineY),
          showText(PDFHexString.of(encodedOriginal)),
          endText(),
        );
      }
      operators.push(
        setFillingRgbColor(0, 0, 0),
        beginText(),
        setFontAndSize(embeddedFontEncoder.resourceName, replacement.drawSize),
        setTextMatrix(matrixA, matrixB, matrixC, matrixD, drawX, baselineY),
        showText(PDFHexString.of(encodedConverted)),
        endText(),
        popGraphicsState(),
      );
      page.pushOperators(...operators);
    } else {
      page.drawRectangle({
        x: replacement.x - 0.1,
        y: baselineY - 0.1,
        width: Math.max(replacement.width, replacement.drawWidth) + 0.2,
        height: replacement.height + 0.2,
        color: rgb(1, 1, 1),
        opacity: 1,
      });
      page.drawText(replacement.converted, {
        x: drawX,
        y: baselineY,
        size: replacement.drawSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
    if (replacement.changed) changedPages.add(replacement.pageIndex);
  }
  const changedSpans = replacements.filter((replacement) => replacement.changed).length;

  return {
    bytes: await pdfDoc.save(),
    stats: {
      totalPages: extracted.totalPages,
      processedPages: pageIndexes.map((index) => index + 1),
      touchedPages: changedPages.size,
      changedSpans,
      fallbackFontUses: 0,
      fromFormat: detectedFromFormat,
      toFormat,
      fromKey: prefs.normalizedFromKey,
      toKey: prefs.normalizedToKey,
      semitoneShift: prefs.semitoneShift,
    },
  };
}
