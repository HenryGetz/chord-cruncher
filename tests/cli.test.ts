import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { main } from "../src/cli.js";

async function makePdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 240]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Key - A", { x: 40, y: 190, size: 16, font });
  page.drawText("A", { x: 40, y: 150, size: 16, font });
  await writeFile(path, await doc.save());
}

describe("CLI", () => {
  it("runs inspect and convert commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sscapo-node-"));
    try {
      const input = join(dir, "chart.pdf");
      const output = join(dir, "out.pdf");
      await makePdf(input);
      await expect(main(["inspect", input, "--all-fonts", "--output", "quiet"])).resolves.toBe(0);
      await expect(main(["convert", input, "--out", output, "--from-key", "A", "--to-key", "G", "--all-fonts", "--output", "quiet"])).resolves.toBe(0);
      const converted = await readFile(output);
      const loaded = await PDFDocument.load(converted);
      expect(loaded.getPageCount()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
