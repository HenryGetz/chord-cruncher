#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { glob } from "node:fs/promises";
import { convertSongselectPdf, inferKeyFromPdf, inspectSongselectPdf } from "./pdf/songselectPdf.js";

type OutputMode = "human" | "json" | "quiet";

interface ConvertArgs {
  inputs: string[];
  out?: string;
  outputDir?: string;
  recursive: boolean;
  inPlace: boolean;
  backupInput: boolean;
  fromFormat: "auto" | "chords" | "numbers";
  toFormat: "chords" | "numbers";
  key?: string;
  fromKey?: string;
  toKey?: string;
  pages: string;
  fontScale: number;
  minFontSize: number;
  allFonts: boolean;
  noKeyLines: boolean;
  accidentals: "auto" | "sharp" | "flat";
  forceRewriteUnchanged: boolean;
  dryRun: boolean;
  failFast: boolean;
  output: OutputMode;
  reportJson?: string;
}

interface InspectArgs {
  inputPdf: string;
  pages: string;
  allFonts: boolean;
  output: OutputMode;
  reportJson?: string;
}

function help(): string {
  return `Usage:
  chord-cruncher inspect <input.pdf> [--pages all] [--all-fonts] [--output human|json|quiet] [--report-json path]
  chord-cruncher convert <input(s)> [--out path] [--output-dir dir] [--recursive] [--in-place] [--backup-input]
                      [--from-format auto|chords|numbers] [--to-format chords|numbers]
                      [--key G] [--from-key A] [--to-key G] [--pages all]
                      [--font-scale 1] [--min-font-size 6] [--all-fonts] [--no-key-lines]
                      [--accidentals auto|sharp|flat] [--dry-run] [--fail-fast]
                      [--output human|json|quiet] [--report-json path]`;
}

function parseFlagValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return [value, index + 1];
}

function parseConvert(args: string[]): ConvertArgs {
  const parsed: ConvertArgs = {
    inputs: [],
    recursive: false,
    inPlace: false,
    backupInput: false,
    fromFormat: "auto",
    toFormat: "chords",
    pages: "all",
    fontScale: 1,
    minFontSize: 6,
    allFonts: false,
    noKeyLines: false,
    accidentals: "auto",
    forceRewriteUnchanged: false,
    dryRun: false,
    failFast: false,
    output: "human",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      parsed.inputs.push(arg);
      continue;
    }
    if (["--recursive", "--in-place", "--backup-input", "--all-fonts", "--no-key-lines", "--force-rewrite-unchanged", "--dry-run", "--fail-fast"].includes(arg)) {
      if (arg === "--recursive") parsed.recursive = true;
      if (arg === "--in-place") parsed.inPlace = true;
      if (arg === "--backup-input") parsed.backupInput = true;
      if (arg === "--all-fonts") parsed.allFonts = true;
      if (arg === "--no-key-lines") parsed.noKeyLines = true;
      if (arg === "--force-rewrite-unchanged") parsed.forceRewriteUnchanged = true;
      if (arg === "--dry-run") parsed.dryRun = true;
      if (arg === "--fail-fast") parsed.failFast = true;
      continue;
    }
    const [value, nextIndex] = parseFlagValue(args, index, arg);
    index = nextIndex;
    if (arg === "--out") parsed.out = value;
    else if (arg === "--output-dir") parsed.outputDir = value;
    else if (arg === "--from-format" && ["auto", "chords", "numbers"].includes(value)) parsed.fromFormat = value as ConvertArgs["fromFormat"];
    else if (arg === "--to-format" && ["chords", "numbers"].includes(value)) parsed.toFormat = value as ConvertArgs["toFormat"];
    else if (arg === "--key") parsed.key = value;
    else if (arg === "--from-key") parsed.fromKey = value;
    else if (arg === "--to-key") parsed.toKey = value;
    else if (arg === "--pages") parsed.pages = value;
    else if (arg === "--font-scale") parsed.fontScale = Number(value);
    else if (arg === "--min-font-size") parsed.minFontSize = Number(value);
    else if (arg === "--accidentals" && ["auto", "sharp", "flat"].includes(value)) parsed.accidentals = value as ConvertArgs["accidentals"];
    else if (arg === "--output" && ["human", "json", "quiet"].includes(value)) parsed.output = value as OutputMode;
    else if (arg === "--report-json") parsed.reportJson = value;
    else throw new Error(`Unknown or invalid option: ${arg}`);
  }
  if (parsed.inputs.length === 0) throw new Error("No input PDFs found");
  return parsed;
}

function parseInspect(args: string[]): InspectArgs {
  const inputPdf = args.find((arg) => !arg.startsWith("--"));
  if (!inputPdf) throw new Error("Missing input PDF");
  const parsed: InspectArgs = { inputPdf, pages: "all", allFonts: false, output: "human" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    if (arg === "--all-fonts") {
      parsed.allFonts = true;
      continue;
    }
    const [value, nextIndex] = parseFlagValue(args, index, arg);
    index = nextIndex;
    if (arg === "--pages") parsed.pages = value;
    else if (arg === "--output" && ["human", "json", "quiet"].includes(value)) parsed.output = value as OutputMode;
    else if (arg === "--report-json") parsed.reportJson = value;
    else throw new Error(`Unknown or invalid option: ${arg}`);
  }
  return parsed;
}

function hasGlobChars(value: string): boolean {
  return /[*?\[\]]/.test(value);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function expandInputs(specs: string[], recursive: boolean): Promise<string[]> {
  const found: string[] = [];
  const errors: string[] = [];
  for (const spec of specs) {
    if (hasGlobChars(spec)) {
      const matched: string[] = [];
      for await (const path of glob(spec)) if (path.toLowerCase().endsWith(".pdf") && (await isFile(path))) matched.push(path);
      if (!matched.length) errors.push(`No PDFs matched glob: ${spec}`);
      found.push(...matched.sort());
      continue;
    }

    const info = existsSync(spec) ? await stat(spec) : null;
    if (info?.isDirectory()) {
      const pattern = recursive ? join(spec, "**", "*.pdf") : join(spec, "*.pdf");
      const matched: string[] = [];
      for await (const path of glob(pattern)) if (await isFile(path)) matched.push(path);
      if (!matched.length) errors.push(`No PDFs found in directory: ${spec}`);
      found.push(...matched.sort());
    } else if (info?.isFile() && extname(spec).toLowerCase() === ".pdf") {
      found.push(spec);
    } else if (info) {
      errors.push(`Not a PDF file: ${spec}`);
    } else {
      errors.push(`Missing path: ${spec}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
  const seen = new Set<string>();
  return found.filter((path) => {
    const absolute = resolve(path);
    if (seen.has(absolute)) return false;
    seen.add(absolute);
    return true;
  });
}

function defaultOutputPath(inputPdf: string, toFormat: string, toKey: string): string {
  const suffix = toFormat === "numbers" ? "to-numbers" : `key-${toKey.replaceAll("#", "sharp").replaceAll("b", "flat")}`;
  return join(dirname(inputPdf), `${basename(inputPdf, extname(inputPdf))}.${suffix}.pdf`);
}

function dedupeDestination(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dir = dirname(path);
  const stem = basename(path, extname(path));
  const ext = extname(path);
  let counter = 2;
  while (true) {
    const candidate = join(dir, `${stem}-${counter}${ext}`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

async function resolveKeys(args: ConvertArgs, inputPdf: string): Promise<{ fromKey: string; toKey: string; inference: unknown | null }> {
  let fromKey = args.fromKey ?? args.key;
  let toKey = args.toKey ?? args.key;
  let inference: unknown | null = null;
  if (!fromKey || !toKey) {
    inference = await inferKeyFromPdf(new Uint8Array(await readFile(inputPdf)), args.pages);
    const inferred = (inference as { inferredKey: string | null }).inferredKey;
    if (inferred) {
      fromKey ??= inferred;
      toKey ??= inferred;
    }
  }
  if (!toKey && fromKey) toKey = fromKey;
  if (!fromKey && toKey) fromKey = toKey;
  if (!fromKey || !toKey) throw new Error("Unable to infer keys. Add key labels like 'Key - X' on selected pages or provide --key/--from-key/--to-key.");
  return { fromKey, toKey, inference };
}

async function writeJsonReport(path: string | undefined, payload: unknown): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2));
}

async function runInspect(args: InspectArgs): Promise<number> {
  if (!(await isFile(args.inputPdf))) {
    console.error(`Missing input PDF: ${args.inputPdf}`);
    return 2;
  }
  const report = await inspectSongselectPdf(new Uint8Array(await readFile(args.inputPdf)), args.pages, !args.allFonts);
  const payload = { mode: "inspect", input_pdf: args.inputPdf, pages: args.pages, bold_only: !args.allFonts, inspection: report };
  if (args.output === "human") {
    console.log(`total_pages=${report.totalPages}`);
    console.log(`processed_pages=${report.processedPages.join(",")}`);
    console.log(`bold_only=${report.boldOnly}`);
    console.log(`sampled_tokens=${report.sampledTokens}`);
    console.log(`chord_hits=${report.chordHits}`);
    console.log(`numbers_hits=${report.numbersHits}`);
    console.log(`detected_format=${report.detectedFormat}`);
  } else if (args.output === "json") {
    console.log(JSON.stringify(payload, null, 2));
  }
  await writeJsonReport(args.reportJson, payload);
  return 0;
}

async function runConvert(args: ConvertArgs): Promise<number> {
  const legacyOut = args.inputs.length === 2 && args.inputs[0].toLowerCase().endsWith(".pdf") && args.inputs[1].toLowerCase().endsWith(".pdf") && !existsSync(args.inputs[1]) ? args.inputs[1] : undefined;
  const inputSpecs = legacyOut ? [args.inputs[0]] : args.inputs;
  if (args.inPlace && (args.out || legacyOut || args.outputDir)) throw new Error("--in-place cannot be combined with --out, legacy output path, or --output-dir.");
  const inputs = await expandInputs(inputSpecs, args.recursive);
  const explicitOut = args.out ?? legacyOut;
  if (explicitOut && inputs.length !== 1) throw new Error("--out (or legacy output path) only supports a single input PDF.");

  const runItems: unknown[] = [];
  let failures = 0;
  const used = new Set<string>();
  for (const inputPdf of inputs) {
    try {
      const { fromKey, toKey, inference } = await resolveKeys(args, inputPdf);
      let outputPdf = explicitOut ?? (args.inPlace ? inputPdf : defaultOutputPath(inputPdf, args.toFormat, toKey));
      if (!explicitOut && !args.inPlace && args.outputDir) outputPdf = join(args.outputDir, basename(outputPdf));
      if (inputs.length > 1) outputPdf = dedupeDestination(outputPdf, used);
      if (args.output === "human") console.log(`input=${inputPdf}`);

      if (args.backupInput && !args.dryRun) {
        const backup = `${inputPdf}.bak`;
        await copyFile(inputPdf, backup);
        if (args.output === "human") console.log(`backup=${backup}`);
      }
      const conversion = await convertSongselectPdf({
        inputPdf: new Uint8Array(await readFile(inputPdf)),
        fromKey,
        toKey,
        fromFormat: args.fromFormat,
        toFormat: args.toFormat,
        pages: args.pages,
        fontScale: args.fontScale,
        minFontSize: args.minFontSize,
        boldOnly: !args.allFonts,
        transposeKeyLines: !args.noKeyLines,
        accidentalPreference: args.accidentals,
        forceRewriteUnchanged: args.forceRewriteUnchanged,
      });
      if (!args.dryRun) {
        await mkdir(dirname(outputPdf), { recursive: true });
        const temp = args.inPlace ? `${outputPdf}.tmp-${Date.now()}` : outputPdf;
        await writeFile(temp, conversion.bytes);
        if (args.inPlace) await rename(temp, outputPdf);
      }
      const item = { status: "ok", input_pdf: inputPdf, output_pdf: outputPdf, dry_run: args.dryRun, from_key: fromKey, to_key: toKey, stats: conversion.stats, key_inference: inference };
      runItems.push(item);
      if (args.output === "human") {
        console.log(`${args.dryRun ? "would_write" : "wrote"}=${outputPdf}`);
        console.log(`from_format=${conversion.stats.fromFormat}`);
        console.log(`to_format=${conversion.stats.toFormat}`);
        console.log(`from_key=${conversion.stats.fromKey}`);
        console.log(`to_key=${conversion.stats.toKey}`);
        console.log(`semitone_shift=${conversion.stats.semitoneShift}`);
        console.log(`total_pages=${conversion.stats.totalPages}`);
        console.log(`processed_pages=${conversion.stats.processedPages.join(",")}`);
        console.log(`touched_pages=${conversion.stats.touchedPages}`);
        console.log(`changed_spans=${conversion.stats.changedSpans}`);
        console.log(`fallback_font_uses=${conversion.stats.fallbackFontUses}`);
      }
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      runItems.push({ status: "error", input_pdf: inputPdf, error: message });
      console.error(`Error (${inputPdf}): ${message}`);
      if (args.failFast) break;
    }
  }
  const payload = { mode: "convert", output_mode: args.output, input_count: inputs.length, success_count: runItems.length - failures, failure_count: failures, items: runItems };
  if (args.output === "json") console.log(JSON.stringify(payload, null, 2));
  await writeJsonReport(args.reportJson, payload);
  return failures ? 1 : 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (!command || command === "--help" || command === "-h") {
      console.log(help());
      return 0;
    }
    if (command === "inspect") return await runInspect(parseInspect(rest));
    if (command === "convert") return await runConvert(parseConvert(rest));
    console.error(`Unknown command: ${command}`);
    return 2;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
