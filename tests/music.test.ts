import { describe, expect, it } from "vitest";
import { detectChartFormat, inferKeyFromTokens, parsePagesSpec, transformToken } from "../src/core/music.js";

const baseOptions = {
  fromFormat: "chords" as const,
  toFormat: "chords" as const,
  fromKey: "A",
  toKey: "G",
  semitoneShift: 10,
  preferFlatsChords: false,
  preferFlatsNumbers: false,
  transposeKeyLines: true,
};

describe("music core parity", () => {
  it("transposes simple chords", () => {
    expect(transformToken("A", baseOptions)).toBe("G");
  });

  it("transposes chord quality and slash bass", () => {
    expect(transformToken("Dsus/G#", baseOptions)).toBe("Csus/F#");
  });

  it("converts chords to Nashville numbers", () => {
    expect(transformToken("Dsus/F#", { ...baseOptions, fromKey: "G", toKey: "G", semitoneShift: 0, toFormat: "numbers" })).toBe("5sus/7");
  });

  it("converts Nashville numbers to chords", () => {
    expect(transformToken("5sus/7", { ...baseOptions, fromFormat: "numbers", fromKey: "G", toKey: "G", semitoneShift: 0 })).toBe("Dsus/F#");
  });

  it("transposes key lines", () => {
    expect(transformToken("Key - A", baseOptions)).toBe("Key - G");
    expect(transformToken("Key - A | Tempo - 97 | Time - 3/4", baseOptions)).toBe("Key - G | Tempo - 97 | Time - 3/4");
  });

  it("spells Gb transpositions with Cb instead of B", () => {
    const gbOptions = {
      ...baseOptions,
      fromKey: "G",
      toKey: "Gb",
      semitoneShift: 11,
      preferFlatsChords: true,
    };
    expect(transformToken("C", gbOptions)).toBe("Cb");
    expect(transformToken("C/E", gbOptions)).toBe("Cb/Eb");
  });

  it("uses target key for numbers-to-chords key lines", () => {
    expect(transformToken("Key - A", { ...baseOptions, fromFormat: "numbers", toKey: "G" })).toBe("Key - G");
  });

  it("keeps key lines when disabled", () => {
    expect(transformToken("Key - A", { ...baseOptions, transposeKeyLines: false })).toBe("Key - A");
  });

  it("does not convert headings", () => {
    expect(transformToken("BRIDGE", baseOptions)).toBe("BRIDGE");
  });

  it("detects chart formats", () => {
    expect(detectChartFormat(["1", "4", "5sus/7", "(6m)"])).toBe("numbers");
    expect(detectChartFormat(["G", "C", "Dsus/F#", "(Em)"])).toBe("chords");
  });

  it("parses page specs", () => {
    expect(parsePagesSpec("all", 3)).toEqual([0, 1, 2]);
    expect(parsePagesSpec("2,4-5", 6)).toEqual([1, 3, 4]);
    expect(() => parsePagesSpec("2-4", 3)).toThrow(/out of range/);
  });

  it("infers keys from most common key line", () => {
    expect(inferKeyFromTokens(["Key - A", "Verse", "Key - G", "Key - G"])).toBe("G");
    expect(inferKeyFromTokens(["Key - G | Tempo - 97 | Time - 3/4"])).toBe("G");
    expect(inferKeyFromTokens(["VERSE", "CHORUS", "Bridge"])).toBeNull();
  });
});
