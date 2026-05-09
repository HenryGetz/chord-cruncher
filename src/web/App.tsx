import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { convertPdfToChordPro } from "../pdf/chordpro.js";
import { convertSongselectPdf, inferKeyFromPdf, inspectSongselectPdf } from "../pdf/songselectPdf.js";
import type { ChartFormat, ChartInspection } from "../core/music.js";
import { renderSongSelectPreviewHtml } from "./songselectPreview.js";

const keys = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B", "C#", "F#"];

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [toKey, setToKey] = useState("G");
  const [chordProKey, setChordProKey] = useState("source");
  const [fromFormat, setFromFormat] = useState<"auto" | ChartFormat>("auto");
  const [toFormat, setToFormat] = useState<ChartFormat>("chords");
  const [pages, setPages] = useState("all");
  const [allFonts, setAllFonts] = useState(true);
  const [status, setStatus] = useState("Choose a SongSelect-style PDF to begin.");
  const [inspection, setInspection] = useState<ChartInspection | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [chordProUrl, setChordProUrl] = useState<string | null>(null);
  const [chordProPreviewHtml, setChordProPreviewHtml] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [inferredKey, setInferredKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"inspect" | "convert" | "chordpro" | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const chordProUrlRef = useRef<string | null>(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    chordProUrlRef.current = chordProUrl;
  }, [chordProUrl]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      if (chordProUrlRef.current) URL.revokeObjectURL(chordProUrlRef.current);
    };
  }, []);

  function replacePreviewUrl(url: string | null, name: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewName(name);
  }

  function replaceDownloadUrl(url: string | null) {
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    downloadUrlRef.current = url;
    setDownloadUrl(url);
  }

  function replaceChordProUrl(url: string | null) {
    if (chordProUrlRef.current) URL.revokeObjectURL(chordProUrlRef.current);
    chordProUrlRef.current = url;
    setChordProUrl(url);
  }

  const downloadName = useMemo(() => {
    if (!file) return "converted.pdf";
    const suffix = toFormat === "numbers" ? "to-numbers" : `key-${toKey.replaceAll("#", "sharp").replaceAll("b", "flat")}`;
    return file.name.replace(/\.pdf$/i, `.${suffix}.pdf`);
  }, [file, toFormat, toKey]);

  const chordProDownloadName = useMemo(() => {
    if (!file) return "converted.pro";
    const suffix = chordProKey === "numbers" ? "numbers" : chordProKey === "source" ? "chordpro" : `key-${chordProKey.replaceAll("#", "sharp").replaceAll("b", "flat")}`;
    return file.name.replace(/\.pdf$/i, `.${suffix}.pro`);
  }, [file, chordProKey]);

  function renderChordProPreview(chordProText: string): string {
    const html = renderSongSelectPreviewHtml(chordProText);
    const documentPreview = new DOMParser().parseFromString(html, "text/html");
    const allowedTags = new Set(["DIV", "SPAN"]);
    const allowedClasses = new Set([
      "ssguiSheet",
      "ssguiBodySheet",
      "ssguiTitleSheet",
      "ssguiTitle",
      "ssguiMetaLine",
      "ssguiNoteLine",
      "ssguiKeyLine",
      "ssguiBody",
      "ssguiSection",
      "ssguiColumnBreak",
      "ssguiSongLine",
      "ssguiColumn",
      "ssguiChord",
      "ssguiChordSup",
      "ssguiLyrics",
      "ssguiAnnotation",
      "ssguiInlineChord",
    ]);

    for (const element of [...documentPreview.body.querySelectorAll("*")]) {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(documentPreview.createTextNode(element.textContent ?? ""));
        continue;
      }
      const classNames = [...element.classList].filter((className) => allowedClasses.has(className));
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (classNames.length) element.setAttribute("class", classNames.join(" "));
    }

    return documentPreview.body.innerHTML;
  }

  async function readSelectedFile(): Promise<Uint8Array> {
    if (!file) throw new Error("Choose a PDF first.");
    return new Uint8Array(await file.arrayBuffer());
  }

  function selectFile(nextFile: File | null) {
    if (nextFile && nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setStatus("Choose a PDF file.");
      return;
    }
    setFile(nextFile);
    setInspection(null);
    setInferredKey(null);
    setChordProPreviewHtml(null);
    replaceDownloadUrl(null);
    replaceChordProUrl(null);
    replacePreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null, nextFile?.name ?? null);
    setStatus(nextFile ? "PDF ready. Source key will be inferred automatically." : "Choose a SongSelect-style PDF to begin.");
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    selectFile(event.dataTransfer.files[0] ?? null);
  }

  async function inspect() {
    setStatus("Inspecting PDF…");
    replaceDownloadUrl(null);
    replaceChordProUrl(null);
    setChordProPreviewHtml(null);
    setBusy("inspect");
    try {
      const data = await readSelectedFile();
      const [report, keyInference] = await Promise.all([inspectSongselectPdf(data, pages, !allFonts), inferKeyFromPdf(data, pages)]);
      setInspection(report);
      setInferredKey(keyInference.inferredKey);
      setStatus(`Detected ${report.detectedFormat}; inferred source key ${keyInference.inferredKey ?? "not found"}; sampled ${report.sampledTokens} tokens.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setStatus("Converting PDF in browser…");
    replaceDownloadUrl(null);
    replaceChordProUrl(null);
    setChordProPreviewHtml(null);
    setBusy("convert");
    try {
      const data = await readSelectedFile();
      const keyInference = await inferKeyFromPdf(data, pages);
      const sourceKey = keyInference.inferredKey ?? toKey;
      setInferredKey(keyInference.inferredKey);
      const result = await convertSongselectPdf({
        inputPdf: data,
        fromKey: sourceKey,
        toKey,
        fromFormat,
        toFormat,
        pages,
        boldOnly: !allFonts,
      });
      const bytes = new Uint8Array(result.bytes);
      const header = new TextDecoder().decode(bytes.slice(0, 4));
      if (header !== "%PDF") throw new Error("Conversion did not produce a valid PDF.");
      const blob = new Blob([bytes], { type: "application/pdf" });
      replaceDownloadUrl(URL.createObjectURL(blob));
      replacePreviewUrl(URL.createObjectURL(blob), downloadName);
      setStatus(`Converted from ${sourceKey} to ${toKey}: ${result.stats.changedSpans} token(s) across ${result.stats.touchedPages} page(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function convertChordPro() {
    setStatus("Converting PDF to ChordPro…");
    replaceChordProUrl(null);
    setBusy("chordpro");
    try {
      const data = await readSelectedFile();
      const result = await convertPdfToChordPro(data, { outputKey: chordProKey === "source" ? undefined : chordProKey });
      const blob = new Blob([result.chordproText], { type: "text/plain;charset=utf-8" });
      replaceChordProUrl(URL.createObjectURL(blob));
      setChordProPreviewHtml(renderChordProPreview(result.chordproText));
      setStatus(`Converted to ChordPro: ${result.sectionCount} section(s), ${result.lyricLines} lyric line(s), ${result.chordLines} chord-only line(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="heroTopline">
          <p className="eyebrow">SSCapo Browser</p>
        </div>
        <h1>Convert SongSelect PDFs without installing Python.</h1>
        <p>Upload a chart, then download a converted PDF or ChordPro file. All processing stays in your browser.</p>
      </section>

      <section className="panel" aria-label="PDF converter controls">
        <label
          className={isDraggingFile ? "fileDrop fileDropActive" : "fileDrop"}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleDrop}
        >
          <span>{file ? file.name : "Upload PDF"}</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="grid">
          <label>
            From format
            <select value={fromFormat} onChange={(event) => setFromFormat(event.target.value as "auto" | ChartFormat)}>
              <option value="auto">Auto detect</option>
              <option value="chords">Chords</option>
              <option value="numbers">Nashville numbers</option>
            </select>
          </label>
          <label>
            To format
            <select value={toFormat} onChange={(event) => setToFormat(event.target.value as ChartFormat)}>
              <option value="chords">Chords</option>
              <option value="numbers">Nashville numbers</option>
            </select>
          </label>
          <label>
            To key
            <select value={toKey} onChange={(event) => setToKey(event.target.value)}>
              {keys.map((key) => <option key={key}>{key}</option>)}
            </select>
          </label>
          <label>
            ChordPro key
            <select value={chordProKey} onChange={(event) => setChordProKey(event.target.value)}>
              <option value="source">Source key</option>
              <option value="numbers">Numbers</option>
              {keys.map((key) => <option key={key}>{key}</option>)}
            </select>
          </label>
          <label>
            Pages
            <input value={pages} onChange={(event) => setPages(event.target.value)} placeholder="all, 2, 1,3-4" />
          </label>
          <label className="check">
            <input type="checkbox" checked={allFonts} onChange={(event) => setAllFonts(event.target.checked)} />
            Process all fonts
          </label>
        </div>

        <div className="actions">
          <button onClick={inspect} disabled={!file || busy !== null}>{busy === "inspect" ? "Inspecting…" : "Inspect"}</button>
          <button className="primary" onClick={convert} disabled={!file || busy !== null}>{busy === "convert" ? "Converting…" : "Convert PDF"}</button>
          <button onClick={convertChordPro} disabled={!file || busy !== null}>{busy === "chordpro" ? "Converting…" : "Convert to ChordPro"}</button>
          {downloadUrl ? <a className="download" href={downloadUrl} download={downloadName}>Download converted PDF</a> : null}
          {chordProUrl ? <a className="download" href={chordProUrl} download={chordProDownloadName}>Download ChordPro</a> : null}
        </div>

        <div className="status" role="status">{busy ? <span className="spinner" aria-hidden="true" /> : null}{status}</div>
        {inspection ? (
          <dl className="stats">
            <div><dt>Detected</dt><dd>{inspection.detectedFormat}</dd></div>
            <div><dt>Source key</dt><dd>{inferredKey ?? "—"}</dd></div>
            <div><dt>Chord hits</dt><dd>{inspection.chordHits}</dd></div>
            <div><dt>Number hits</dt><dd>{inspection.numbersHits}</dd></div>
            <div><dt>Pages</dt><dd>{inspection.processedPages.join(", ")}</dd></div>
          </dl>
        ) : null}
      </section>

      {previewUrl ? (
        <section className="previewPanel" aria-label="PDF preview">
          <div className="previewHeader">
            <h2>PDF Preview</h2>
            <span>{previewName}</span>
          </div>
          <iframe src={previewUrl} title="PDF preview" />
        </section>
      ) : null}

      {chordProPreviewHtml ? (
        <section className="previewPanel" aria-label="ChordPro preview">
          <div className="previewHeader">
            <h2>ChordPro Preview</h2>
            <span>{chordProDownloadName}</span>
          </div>
          <div className="chordProPreview" dangerouslySetInnerHTML={{ __html: chordProPreviewHtml }} />
        </section>
      ) : null}
    </main>
  );
}
