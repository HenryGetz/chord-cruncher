# Chord Cruncher

Chord Cruncher is a React app for importing SongSelect-style song PDFs and doing the painful chart cleanup work that worship teams usually have to do by hand.

It can take a SongSelect song in one key and convert it to another, extract the whole chart as downloadable ChordPro, and render a SongSelect-style ChordPro preview that helps validate whether the lyrics, chords, sections, and Nashville numbers came through correctly. The goal is simple: get the song into the key and format you actually need without manually rebuilding the whole chart.

This is a game changer for the common Sunday-planning workflow: transpose the chart, pull out ChordPro, preserve chords and lyrics, and make dense charts easier to fit onto a single usable page.

## What it does

- Upload a SongSelect-style PDF in the browser.
- Infer the source key from the chart.
- Convert PDF chord charts from one key to another.
- Convert between chords and Nashville numbers.
- Extract a downloadable `.pro` ChordPro file.
- Preview extracted ChordPro in a SongSelect-like layout with compact fonts, columns, sections, bold chords, superscripts, and annotations.
- Run entirely in the browser for the main UI workflow.

## Development

```bash
npm install
npm run dev
```

Then open the local Vite URL and upload a SongSelect-style PDF.

## Verification

```bash
npm test
npm run build
```

The test suite includes regression coverage for key transposition, Nashville-number handling, PDF-to-ChordPro extraction, chord superscripts, and generated SongSelect-style edge cases. Optional local fixture tests also run when you provide compatible SongSelect PDFs, but PDF fixtures are intentionally ignored and not committed.

## Deployment

Pushing to `main` automatically builds and deploys the web app to GitHub Pages:

```txt
https://henrygetz.github.io/chord-cruncher/
```

The deployment workflow runs `npm ci`, `npm test`, and `npm run build`, then publishes the generated `web-dist/` directory through GitHub Pages.

## CLI

The browser app is the main workflow, but the repo also includes a local CLI entrypoint for conversion checks:

```bash
npm run cli -- --help
```

## Notes

This project is designed around SongSelect-style chord charts. PDF extraction is layout-sensitive, so keep any real chart PDFs local and untracked.
