import { ChordProParser } from "chordsheetjs/lib/module.js";

type PreviewPair = { chord: string; lyrics: string };
type PreviewRow = { type: "section"; text: string } | { type: "line"; pairs: PreviewPair[] };

type PreviewModel = {
  title: string;
  artists: string[];
  key: string;
  tempo: string;
  time: string;
  notes: string[];
  rows: PreviewRow[];
  hasBody: boolean;
};

type ChordSheetSong = {
  title?: string | null;
  artist?: string | string[] | null;
  key?: string | null;
  tempo?: string | null;
  time?: string | null;
  lines?: Array<{ items?: ChordSheetItem[] }>;
  getSingleMetadataValue?: (name: string) => string | undefined;
};

type ChordSheetItem = {
  name?: string;
  value?: string;
  lyrics?: string;
  chords?: string;
};

export function renderSongSelectPreviewHtml(chordProText: string): string {
  const parsedSong = new ChordProParser().parse(chordProText) as ChordSheetSong;
  const model = buildRenderModel(parsedSong);
  return songSelectPreviewMarkup(model);
}

function buildRenderModel(song: ChordSheetSong): PreviewModel {
  const title = clean(song.title ?? song.getSingleMetadataValue?.("title") ?? "");
  const artist = clean(song.artist ?? song.getSingleMetadataValue?.("artist") ?? "");
  const key = clean(song.key ?? song.getSingleMetadataValue?.("key") ?? "");
  const tempo = clean(song.tempo ?? song.getSingleMetadataValue?.("tempo") ?? "");
  const time = clean(song.time ?? song.getSingleMetadataValue?.("time") ?? "");
  const rows = extractRows(song);
  const noteComments = rows.flatMap((row) => row.type === "section" && !isSectionName(row.text) ? [row.text] : []);
  const bodyRows = rows.filter((row) => row.type !== "section" || isSectionName(row.text));

  return {
    title,
    artists: artist ? artist.split(/\s*,\s*/).filter(Boolean) : [],
    key,
    tempo,
    time,
    notes: noteComments,
    rows: bodyRows,
    hasBody: bodyRows.some((row) => row.type === "line"),
  };
}

function extractRows(song: ChordSheetSong): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const line of song.lines ?? []) {
    const pairs: PreviewPair[] = [];
    const comments: string[] = [];
    for (const item of line.items ?? []) {
      if (typeof item.name === "string") {
        if (item.name.toLowerCase() === "comment" && item.value) comments.push(clean(item.value));
        continue;
      }
      if (typeof item.lyrics === "string" || typeof item.chords === "string") {
        pairs.push({ chord: clean(item.chords ?? ""), lyrics: item.lyrics ?? "" });
      }
    }
    for (const comment of comments) rows.push({ type: "section", text: comment });
    if (pairs.some((pair) => pair.chord || pair.lyrics.trim())) {
      const text = pairs.map((pair) => pair.lyrics).join("").trim();
      if (pairs.every((pair) => !pair.chord) && isSectionName(text)) rows.push({ type: "section", text: cleanSection(text) });
      else rows.push({ type: "line", pairs });
    }
  }
  return rows;
}

function songSelectPreviewMarkup(model: PreviewModel): string {
  return `<div class="ssguiSheet ${model.hasBody ? "ssguiBodySheet" : "ssguiTitleSheet"}">${model.hasBody ? bodyMarkup(model) : titleMarkup(model)}</div>`;
}

function titleMarkup(model: PreviewModel): string {
  const artistLine = escapeHtml(model.artists.join(" | "));
  const noteLine = escapeHtml(model.notes[0] ? normalizeNote(model.notes[0]) : "");
  const meta = [model.key && `Key - ${model.key}`, model.tempo && `Tempo - ${model.tempo}`, model.time && `Time - ${model.time}`].filter(Boolean).join(" | ");
  return `${model.title ? `<div class="ssguiTitle">${escapeHtml(model.title)}</div>` : ""}
${artistLine ? `<div class="ssguiMetaLine">${artistLine}</div>` : ""}
${noteLine ? `<div class="ssguiNoteLine">${noteLine}</div>` : ""}
${meta ? `<div class="ssguiMetaLine ssguiKeyLine">${escapeHtml(meta)}</div>` : ""}`;
}

function bodyMarkup(model: PreviewModel): string {
  return `${titleMarkup(model)}<div class="ssguiBody">${model.rows.map((row) => row.type === "section" ? sectionMarkup(row.text) : `<div class="ssguiSongLine">${lineMarkup(row.pairs)}</div>`).join("")}</div>`;
}

function sectionMarkup(text: string): string {
  const className = /^BRIDGE(?:\s|$)/i.test(text) ? "ssguiSection ssguiColumnBreak" : "ssguiSection";
  return `<div class="${className}">${escapeHtml(text)}</div>`;
}

function lineMarkup(pairs: PreviewPair[]): string {
  const columns = pairs.map((pair) => {
    const chord = pair.chord ? `<div class="ssguiChord">${formatChordHtml(pair.chord)}</div>` : "<div class=\"ssguiChord\"></div>";
    return `<span class="ssguiColumn">${chord}<span class="ssguiLyrics">${formatLyricsHtml(pair.lyrics)}</span></span>`;
  });
  return columns.join("");
}

function formatChordHtml(chord: string): string {
  const normalizedChord = normalizePreviewSuperscript(chord);
  if (normalizedChord !== chord) return formatChordHtml(normalizedChord);
  const caret = chord.indexOf("^");
  if (caret < 0) return escapeHtml(chord);
  const slash = chord.indexOf("/", caret + 1);
  const base = chord.slice(0, caret);
  const extension = slash < 0 ? chord.slice(caret + 1) : chord.slice(caret + 1, slash);
  const suffix = slash < 0 ? "" : chord.slice(slash);
  return `${escapeHtml(base)}<span class="ssguiChordSup">${escapeHtml(extension)}</span>${escapeHtml(suffix)}`;
}

function formatLyricsHtml(lyrics: string): string {
  if (isInstrumentalBarLine(lyrics)) return formatInstrumentalBarLineHtml(lyrics);
  return escapeHtml(lyrics).replace(/\(([^()]*)\)/g, '<span class="ssguiAnnotation">($1)</span>');
}

function normalizePreviewSuperscript(chord: string): string {
  if (chord.includes("^")) return chord;
  return chord
    .replace(/^(?<degree>[#b]?[1-7])sus4?(?<suffix>\/.+)?$/i, "$<degree>^(4)$<suffix>")
    .replace(/^(?<degree>[#b]?[1-7])2(?<suffix>\/.+)?$/i, "$<degree>^2$<suffix>")
    .replace(/^(?<degree>[#b]?[1-7](?:m|maj|min|dim|aug))(?<extension>2|4|5|6|7|9|11|13)(?<suffix>\/.+)?$/i, "$<degree>^$<extension>$<suffix>")
    .replace(/^(?<root>[A-G](?:#|b)?)sus4?(?<suffix>\/.+)?$/, "$<root>^(4)$<suffix>")
    .replace(/^(?<root>[A-G](?:#|b)?)2(?<suffix>\/.+)?$/, "$<root>^2$<suffix>")
    .replace(/^(?<root>[A-G](?:#|b)?(?:m|maj|min|dim|aug)?)(?<extension>4|5|6|7|9|11|13)(?<suffix>\/.+)?$/, "$<root>^$<extension>$<suffix>");
}

function isInstrumentalBarLine(lyrics: string): boolean {
  const compact = lyrics.trim();
  return Boolean(compact) && /^[\s|:/.#bA-Ga-g0-9mM()+-]+$/.test(compact) && /(?:^|\s)[#b]?[1-7](?:m(?:aj)?|sus|dim|aug)?(?:\d+|\(4\))?(?:\/[#b]?[1-7])?(?=\s|$)/i.test(compact);
}

function formatInstrumentalBarLineHtml(lyrics: string): string {
  return lyrics.split(/(\s+|\|\|:|:\|\||\|)/).map((token) => {
    if (isInlineInstrumentalChord(token)) return `<span class="ssguiInlineChord">${formatChordHtml(token)}</span>`;
    return escapeHtml(token);
  }).join("");
}

function isInlineInstrumentalChord(token: string): boolean {
  return /^(?:[#b]?[1-7](?:m(?:aj)?|sus|dim|aug)?(?:\d+|\(4\))?(?:\/[#b]?[1-7])?|[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug)?(?:\d+|\(4\))?(?:\/[A-G](?:#|b)?)?)$/.test(token);
}

function clean(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => clean(item)).join(" | ");
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanSection(value: unknown): string {
  return clean(value).replace(/^\((.*)\)$/u, "$1").toUpperCase();
}

function isSectionName(value: string): boolean {
  return /^(?:INTRO|OUTRO|TAG(?:\s+\S+)?|TURNAROUND|TURN|INSTRUMENTAL|VERSE(?:\s+\S+)?|CHORUS(?:\s+\S+)?|PRE[- ]?CHORUS(?:\s+\S+)?|POST[- ]?CHORUS(?:\s+\S+)?|BRIDGE(?:\s+\S+)?|REFRAIN|INTERLUDE|ENDING)$/i.test(value.trim());
}

function lowerFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function normalizeNote(value: string): string {
  const note = lowerFirst(value.replace(/^\((.*)\)$/u, "$1"));
  return note ? `(${note})` : "";
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
