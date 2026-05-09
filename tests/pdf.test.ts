/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { convertPdfToChordPro } from "../src/pdf/chordpro.js";
import { createChordProPdf, extractEmbeddedChordPro } from "../src/pdf/chordproPdf.js";
import { convertSongselectPdf, inferKeyFromPdf, inspectSongselectPdf } from "../src/pdf/songselectPdf.js";

const christFixture = "Christ And Christ Crucified - NUM (1).pdf";
const windFixture = "When Wind Meets Fire NUM (1).pdf";

async function makeChartPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 300]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Key - A", { x: 48, y: 250, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("A", { x: 48, y: 210, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("Dsus/G#", { x: 110, y: 210, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("BRIDGE", { x: 48, y: 170, size: 18, font, color: rgb(0, 0, 0) });
  return doc.save();
}

async function makeChordProChartPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 420]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Be Thou My Vision", { x: 48, y: 370, size: 20, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Traditional", { x: 48, y: 346, size: 8, font: regular, color: rgb(0, 0, 0) });
  page.drawText("Key - G | Tempo - 97 | Time - 3/4", { x: 48, y: 322, size: 10, font: regular, color: rgb(0, 0, 0) });
  page.drawText("VERSE 1", { x: 48, y: 282, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("G", { x: 48, y: 250, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("C", { x: 92, y: 250, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Be thou my vision", { x: 48, y: 236, size: 12, font: regular, color: rgb(0, 0, 0) });
  page.drawText("D", { x: 48, y: 206, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("G/B", { x: 108, y: 206, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("O Lord of my heart", { x: 48, y: 192, size: 12, font: regular, color: rgb(0, 0, 0) });
  return doc.save();
}

async function makeSplitSuperscriptChartPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 260]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Split Superscript", { x: 48, y: 220, size: 18, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Key - A", { x: 48, y: 198, size: 10, font: regular, color: rgb(0, 0, 0) });
  page.drawText("CHORUS", { x: 48, y: 164, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("2m", { x: 48, y: 134, size: 12, font: bold, color: rgb(0, 0, 0) });
  page.drawText("7", { x: 68, y: 139, size: 8, font: bold, color: rgb(0, 0, 0) });
  page.drawText("Fire again", { x: 48, y: 120, size: 12, font: regular, color: rgb(0, 0, 0) });
  return doc.save();
}

describe("PDF engine", () => {
  it("inspects and infers key from generated PDF", async () => {
    const pdf = await makeChartPdf();
    const inspection = await inspectSongselectPdf(pdf, "all", false);
    expect(inspection.totalPages).toBe(1);
    expect(inspection.detectedFormat).toBe("chords");
    expect(inspection.chordHits).toBeGreaterThanOrEqual(2);

    const inference = await inferKeyFromPdf(pdf, "all");
    expect(inference.inferredKey).toBe("A");
    expect(inference.matchedKeyLines).toBe(1);
  });

  it("converts PDF chord tokens and keeps a valid output PDF", async () => {
    const pdf = await makeChartPdf();
    const result = await convertSongselectPdf({ inputPdf: pdf, fromKey: "A", toKey: "G", fromFormat: "chords", toFormat: "chords", boldOnly: false });
    expect(result.stats.changedSpans).toBeGreaterThanOrEqual(3);
    expect(result.stats.touchedPages).toBe(1);
    expect(result.stats.fromKey).toBe("A");
    expect(result.stats.toKey).toBe("G");
    const loaded = await PDFDocument.load(result.bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("can force same-key rewrites for visual fidelity QA without reporting semantic changes", async () => {
    const pdf = await makeChartPdf();
    const defaultResult = await convertSongselectPdf({ inputPdf: pdf, fromKey: "A", toKey: "A", fromFormat: "chords", toFormat: "chords", boldOnly: false });
    expect(defaultResult.stats.changedSpans).toBe(0);
    expect(defaultResult.stats.touchedPages).toBe(0);

    const forcedResult = await convertSongselectPdf({
      inputPdf: pdf,
      fromKey: "A",
      toKey: "A",
      fromFormat: "chords",
      toFormat: "chords",
      boldOnly: false,
      forceRewriteUnchanged: true,
    });
    expect(forcedResult.stats.changedSpans).toBe(0);
    expect(forcedResult.stats.touchedPages).toBe(0);
    const loaded = await PDFDocument.load(forcedResult.bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("converts a SongSelect-style PDF to ChordPro", async () => {
    const pdf = await makeChordProChartPdf();
    const result = await convertPdfToChordPro(pdf);
    expect(result.metadata.title).toBe("Be Thou My Vision");
    expect(result.metadata.artists).toEqual(["Traditional"]);
    expect(result.metadata.key).toBe("G");
    expect(result.metadata.tempo).toBe("97");
    expect(result.metadata.timeSignature).toBe("3/4");
    expect(result.sectionCount).toBe(1);
    expect(result.lyricLines).toBe(2);
    expect(result.chordproText).toContain("{title: Be Thou My Vision}");
    expect(result.chordproText).toContain("{artist: Traditional}");
    expect(result.chordproText).toContain("{key: G}");
    expect(result.chordproText).toContain("{comment: VERSE 1}");
    expect(result.chordproText).toContain("[G]Be thou [C]my vision");
    expect(result.chordproText).toContain("[D]O Lord of my [G/B]heart");
  });

  it("embeds original ChordPro source in generated ChordPro PDFs", async () => {
    const chordproText = "{title: Café Song}\n{key: G}\n{comment: VERSE}\n[G]Hallelujah ñ\n";
    const pdf = await createChordProPdf(chordproText);
    const header = new TextDecoder().decode(pdf.slice(0, 4));

    expect(header).toBe("%PDF");
    await expect(extractEmbeddedChordPro(pdf)).resolves.toBe(chordproText);
  });

  (existsSync(christFixture) ? it : it.skip)("keeps dual-column SongSelect sections in column reading order", async () => {
    const pdf = new Uint8Array(await readFile(christFixture));
    const result = await convertPdfToChordPro(pdf);
    const text = result.chordproText;
    expect(result.metadata.title).toBe("Christ And Christ Crucified");
    expect(result.metadata.key).toBe("A");
    expect(text.indexOf("{comment: VERSE 1}")).toBeLessThan(text.indexOf("{comment: VERSE 2}"));
    expect(text.indexOf("{comment: VERSE 2}")).toBeLessThan(text.indexOf("{comment: CHORUS 1A}"));
    expect(text.indexOf("{comment: CHORUS 1A}")).toBeLessThan(text.indexOf("{comment: VERSE 3}"));
    expect(text.indexOf("{comment: VERSE 3}")).toBeLessThan(text.indexOf("{comment: VERSE 4}"));
    expect(text.indexOf("{comment: VERSE 4}")).toBeLessThan(text.indexOf("{comment: CHORUS 1B}"));
    expect(text).toContain("{comment: INSTRUMENTAL}");
    expect(text).toContain("{comment: BRIDGE}");
    expect(text).not.toContain("[BRIDGE]");
    expect(text).not.toContain("1/342");
    expect(text).not.toContain("6m71/5");
  });

  (existsSync(windFixture) ? it : it.skip)("preserves fi ligatures and handles suspended Nashville output", async () => {
    const pdf = new Uint8Array(await readFile(windFixture));
    const chordResult = await convertPdfToChordPro(pdf);
    expect(chordResult.metadata.title).toBe("When Wind Meets Fire");
    expect(chordResult.metadata.key).toBe("A");
    expect(chordResult.chordproText).toContain("wind meets [A]fire");
    expect(chordResult.chordproText).toContain("[Esus]altar");
    expect(chordResult.chordproText).not.toContain("\u0000");
    expect(chordResult.chordproText).not.toContain("[(4)]");
    expect(chordResult.chordproText).not.toContain("[E(4)]");

    const numbersResult = await convertPdfToChordPro(pdf, { outputKey: "numbers" });
    expect(numbersResult.chordproText).toContain("wind meets [1]fire");
    expect(numbersResult.chordproText).toContain("[5sus]altar");
    expect(numbersResult.chordproText).toContain("[4]Come on in [1]come on in [5]");
    expect(numbersResult.chordproText).toContain("[4]Light up my [1]lungs with Your [5sus]praise [5]");
    expect(numbersResult.chordproText).toContain("{comment: INTERLUDE}\n[6]Oh oh [b7]oh [5]");
    expect(numbersResult.chordproText).toContain("{comment: ENDING}\nYou [6]ask can these [b7]bones live a [5]- gain");
    expect(numbersResult.chordproText).not.toContain("INTERLUDE\n[ENDING]");
    expect(numbersResult.chordproText).not.toContain("When Wind Meets Fire - 2");
    expect(numbersResult.chordproText).not.toContain("unaffiliated");
    expect(numbersResult.chordproText).toContain("{comment: TAG 2}");
    expect(numbersResult.chordproText).toContain("[5] (To Chorus)\nBlow again");
    expect(numbersResult.chordproText).not.toContain("[5]Blow again (To Chorus)");
    expect(numbersResult.chordproText).not.toContain("[(4)]");
  });

  it("merges split superscript seventh fragments into the previous chord", async () => {
    const pdf = await makeSplitSuperscriptChartPdf();
    const chordResult = await convertPdfToChordPro(pdf);
    expect(chordResult.chordproText).toContain("[Bm7]Fire again");
    expect(chordResult.chordproText).not.toContain("[Bm][G#]");

    const numbersResult = await convertPdfToChordPro(pdf, { outputKey: "numbers" });
    expect(numbersResult.chordproText).toContain("[2m7]Fire again");
    expect(numbersResult.chordproText).not.toContain("[2m][7]");
  });
});
