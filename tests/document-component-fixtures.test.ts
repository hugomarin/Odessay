import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = join(process.cwd(), "tests/fixtures/document-components");

type Profile = {
  version: number;
  families: string[];
  surfaces: string[];
  kinds: Array<{
    kind: string;
    family: string;
    form: string;
    attributes: string[];
    required: string[];
  }>;
};

type Catalog = {
  fixtures: Array<{
    path: string;
    classification: string;
    covers: string[];
    componentCount?: number;
  }>;
};

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(join(fixtureRoot, path), "utf8")) as T;

describe("ODE-528 document component fixtures", () => {
  const profile = readJson<Profile>("profile.json");
  const catalog = readJson<Catalog>("catalog.json");

  it("defines unique canonical kinds and valid required attributes", () => {
    expect(profile.version).toBe(1);
    expect(new Set(profile.kinds.map(({ kind }) => kind)).size).toBe(
      profile.kinds.length,
    );

    for (const spec of profile.kinds) {
      expect(spec.kind).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(profile.families).toContain(spec.family);
      expect(spec.required.every((name) => spec.attributes.includes(name))).toBe(
        true,
      );
    }
  });

  it("declares every required projection surface", () => {
    expect(profile.surfaces).toEqual([
      "rich",
      "source",
      "preview",
      "shared",
      "public",
      "body_text",
      "ai_context",
      "clean_markdown",
      "pdf",
      "docx",
    ]);
  });

  it("indexes readable fixtures for every required corpus class", () => {
    const requiredCoverage = [
      "markdown",
      "semantic-inline",
      "registered-block",
      "nesting",
      "escaping",
      "assets",
      "annotation-compatibility",
      "unbalanced",
      "unknown-kind",
      "invalid-attributes",
      "scale",
    ];
    const coverage = new Set(catalog.fixtures.flatMap(({ covers }) => covers));

    for (const fixture of catalog.fixtures) {
      expect(readFileSync(join(fixtureRoot, fixture.path), "utf8").length).toBeGreaterThan(0);
    }
    for (const required of requiredCoverage) expect(coverage).toContain(required);
  });

  it.each([10, 100, 1000])("contains the declared %i-component scale fixture", (count) => {
    const fixture = catalog.fixtures.find(
      (entry) => entry.componentCount === count,
    );
    expect(fixture).toBeDefined();
    const source = readFileSync(join(fixtureRoot, fixture!.path), "utf8");
    expect(source.match(/<Tip title="Fixture \d+">/g)).toHaveLength(count);
    expect(source.match(/<\/Tip>/g)).toHaveLength(count);
  });
});
