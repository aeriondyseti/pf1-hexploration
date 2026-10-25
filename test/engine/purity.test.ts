// Invariant 3: the engine has no Foundry or pf1 globals and imports only domain types/contracts.
import { describe, expect, it } from "vitest";

// Vite's import.meta.glob (no node or vite/client types in this project, so declared locally).
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

const sources = import.meta.glob("../../src/engine/**/*.{ts,js,mjs}", { query: "?raw", import: "default", eager: true });

const FORBIDDEN = [/\bgame\./, /\bcanvas\./, /\bfoundry\./, /\bHooks\b/, /\bCONFIG\b/, /\bfromUuid\b/, /\bChatMessage\b/, /\bPIXI\b/, /\bpf1\./];
const ALLOWED_IMPORT = /^(\.\.\/types|\.\.\/contracts|\.\/[\w./-]+)$/;

describe("engine purity", () => {
  it("has source files to check", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  for (const [file, raw] of Object.entries(sources)) {
    const name = file.replace("../../src/engine/", "");
    // Strip comments so prose like "no Foundry globals" doesn't trip the check.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it(`${name} references no Foundry/pf1 globals`, () => {
      for (const re of FORBIDDEN) expect(code, `${name} matches ${re}`).not.toMatch(re);
    });

    it(`${name} imports only types, contracts or sibling engine files`, () => {
      const specs = [...code.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']/g)]
        .map((m) => m[1] ?? m[2] ?? m[3]);
      for (const spec of specs) expect(spec, `${name} imports ${spec}`).toMatch(ALLOWED_IMPORT);
    });
  }
});
