import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

export const chordCruncherChordProMetadataKey = "X-ChordCruncher-Payload";

const pageWidth = 612;
const pageHeight = 792;
const margin = 48;
const fontSize = 10;
const lineHeight = 13;

export async function createChordProPdf(chordProText: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(readChordProTitle(chordProText) ?? "ChordPro Chart");
  pdfDoc.setProducer("Chord Cruncher");
  pdfDoc.setCreator("Chord Cruncher");

  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const title = readChordProTitle(chordProText);

  if (title) {
    page.drawText(title, { x: margin, y, size: 16, font: titleFont, color: rgb(0, 0, 0) });
    y -= lineHeight * 2;
  }

  for (const rawLine of chordProText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    for (const line of wrapLine(rawLine, font, fontSize, pageWidth - margin * 2)) {
      if (y < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line || " ", { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
  }

  setEmbeddedChordPro(pdfDoc, chordProText);
  return pdfDoc.save();
}

export async function extractEmbeddedChordPro(inputPdf: Uint8Array): Promise<string | null> {
  const pdfDoc = await PDFDocument.load(inputPdf);
  const infoDict = pdfDoc.context.lookupMaybe(pdfDoc.context.trailerInfo.Info, PDFDict);
  const payload = infoDict?.lookupMaybe(PDFName.of(chordCruncherChordProMetadataKey), PDFString, PDFHexString);
  if (!payload) return null;
  return base64ToText(payload.decodeText());
}

function setEmbeddedChordPro(pdfDoc: PDFDocument, chordProText: string) {
  let infoDict = pdfDoc.context.lookupMaybe(pdfDoc.context.trailerInfo.Info, PDFDict);
  if (!infoDict) {
    infoDict = pdfDoc.context.obj({});
    pdfDoc.context.trailerInfo.Info = pdfDoc.context.register(infoDict);
  }
  infoDict.set(PDFName.of(chordCruncherChordProMetadataKey), PDFString.of(textToBase64(chordProText)));
}

function readChordProTitle(chordProText: string): string | null {
  const title = chordProText.match(/^\s*\{(?:title|t):\s*(?<title>[^}]+)\}/im)?.groups?.title?.trim();
  return title || null;
}

function wrapLine(line: string, font: { widthOfTextAtSize(text: string, size: number): number }, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(line, size) <= maxWidth) return [line];

  const wrapped: string[] = [];
  let remaining = line;
  while (font.widthOfTextAtSize(remaining, size) > maxWidth) {
    let splitAt = remaining.length;
    while (splitAt > 1 && font.widthOfTextAtSize(remaining.slice(0, splitAt), size) > maxWidth) splitAt -= 1;
    const whitespace = remaining.lastIndexOf(" ", splitAt);
    if (whitespace > 0) splitAt = whitespace;
    wrapped.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  wrapped.push(remaining);
  return wrapped;
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToText(base64: string): string {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return new TextDecoder().decode(Buffer.from(base64, "base64"));
}
