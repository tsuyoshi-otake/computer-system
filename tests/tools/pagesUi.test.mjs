import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("GitHub Pages presentation source", () => {
  let landing;
  let manual;
  let fallback;
  let styles;
  let manualClient;

  beforeAll(async () => {
    [landing, manual, fallback, styles, manualClient] = await Promise.all([
      read("site/index.template.html"),
      read("site/manual/index.template.html"),
      read("site/404.template.html"),
      read("site/styles.css"),
      read("site/manual/app.js"),
    ]);
  });

  it("uses a semantic, keyboard-reachable publication structure", () => {
    expect(occurrences(landing, "<h1")).toBe(1);
    expect(occurrences(manual, "<h1")).toBe(1);
    expect(landing).toContain('class="skip-link"');
    expect(manual).toContain('class="skip-link"');
    expect(landing).toContain('<nav class="site-nav"');
    expect(manual).toContain('role="search"');
    expect(manual).toContain('aria-live="polite"');
    expect(landing).toContain('scope="col"');
    expect(landing).toContain('scope="row"');
    expect(fallback).toContain('<main id="main-content"');
  });

  it("keeps the established technical-publication design language", () => {
    for (const token of [
      "--black: #080a0b",
      "--green: #7dff8a",
      "--amber: #ffc857",
      "--paper: #d9d5c5",
      "--ink: #1d211e",
      "--rust: #8f321c",
      "--font-mono:",
      "--space-9: 64px",
    ]) {
      expect(styles).toContain(token);
    }
    expect(styles).toContain("border-radius: 0");
    expect(styles).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/u);
    expect(styles).not.toMatch(/font-size:\s*(?:10|11)px/u);
  });

  it("provides visible focus, full-size targets, and reduced-motion behavior", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toMatch(/scroll-behavior:\s*auto/u);
  });

  it("uses the canonical bounded manual search without an active-content path", () => {
    expect(manualClient).toContain(
      'import { searchManual } from "../../web/manual.js"',
    );
    expect(manualClient).toContain("maximumSearchLength = 80");
    expect(manualClient).toContain("maximumSearchTerms = 8");
    expect(manualClient).toContain("maximumSearchResults = 24");
    expect(manualClient).toContain("searchManual(boundedQuery");
    expect(manualClient).toContain("history.replaceState");
    expect(manualClient).toContain('window.addEventListener("hashchange"');
    expect(manualClient).toContain('window.addEventListener("popstate"');
    expect(manualClient).toContain('addEventListener("submit"');
    expect(manualClient).toContain("event.preventDefault()");
    expect(manualClient).toContain("searchParams.set");
    expect(manualClient).toContain("textContent");
    expect(manualClient).toContain("replaceChildren");
    expect(manualClient).not.toMatch(/\b(?:fetch|EventSource)\s*\(/u);
    expect(manualClient).not.toMatch(/\.(?:innerHTML|outerHTML)\s*=/u);
  });

  it("keeps static documentation distinct from the live Web Terminal", () => {
    const publication = `${landing}\n${manual}\n${fallback}\n${manualClient}`;
    expect(publication).toContain(
      "This Pages site publishes documentation only",
    );
    expect(publication).toContain(
      "live Web Terminal access requires the local BDS companion",
    );
    for (const forbidden of [
      "/api/",
      "EventSource(",
      'id="handoff-code"',
      'id="command-input"',
      'id="terminal-output"',
      "sessionStorage",
    ]) {
      expect(publication).not.toContain(forbidden);
    }
  });

  it("reserves intrinsic space for authored images", () => {
    for (const template of [landing]) {
      const images = [...template.matchAll(/<img\b[^>]*>/gu)].map(
        ([image]) => image,
      );
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(image).toMatch(/\bwidth="\d+"/u);
        expect(image).toMatch(/\bheight="\d+"/u);
        expect(image).toMatch(/\balt="[^"]*"/u);
      }
    }
  });
});

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
