import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPages } from "../../tools/build-pages.mjs";
import { manualChapters, manualParts, manualPaths } from "../../web/manual.js";

const root = path.resolve(import.meta.dirname, "../..");
const siteUrl = new URL("https://example.test/nested/computer-system/");
const buildRevision = "0123456789abcdef";
const coreOutputFiles = [
  ".nojekyll",
  "404.html",
  "index.html",
  "manual/app.js",
  "manual/index.html",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
];

describe("GitHub Pages publication", () => {
  let result;
  let outputRoot;
  let landing;
  let manual;
  let fallback;
  let client;
  let stylesheet;

  beforeAll(async () => {
    outputRoot = path.join(
      root,
      "dist",
      `pages-test-${String(process.pid)}-${randomUUID()}`,
    );
    result = await buildPages({
      buildRevision,
      outputRoot,
      siteUrl: siteUrl.href,
    });
    [landing, manual, fallback, client, stylesheet] = await Promise.all([
      read("index.html"),
      read("manual/index.html"),
      read("404.html"),
      read("manual/app.js"),
      read("styles.css"),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (outputRoot !== undefined) {
      await rm(outputRoot, { force: true, recursive: true });
    }
  });

  it("rejects a recursive output target outside the repository dist boundary", async () => {
    await expect(
      buildPages({
        buildRevision,
        outputRoot: path.join(root, "pages-output-must-not-be-created"),
        siteUrl: siteUrl.href,
      }),
    ).rejects.toThrow("output must be a child of");
  });

  it("publishes only the explicit static-site and image allowlist", async () => {
    const assetFiles = await listFiles(path.join(root, "web", "assets"));
    const sourceAssets = assetFiles
      .filter((file) => path.extname(file).toLowerCase() === ".png")
      .map((file) => `assets/${file}`);
    const privateGuidance = assetFiles
      .filter((file) => path.basename(file) === "CLAUDE.md")
      .map((file) => `assets/${file}`);
    const expectedFiles = [...coreOutputFiles, ...sourceAssets].sort();

    expect(result).toMatchObject({
      chapterCount: 16,
      outputRoot,
      siteUrl: siteUrl.href,
    });
    expect([...result.files].sort()).toEqual(expectedFiles);
    expect(result.files.filter((file) => file.startsWith("assets/"))).toEqual(
      expect.arrayContaining(sourceAssets),
    );
    expect(privateGuidance.length).toBeGreaterThan(0);
    expect(result.files).not.toEqual(expect.arrayContaining(privateGuidance));
    expect(result.files).not.toEqual(
      expect.arrayContaining([
        "app.js",
        "manual.js",
        "terminal-input.js",
        "terminal-layout.js",
      ]),
    );

    const publicCode = `${landing}\n${manual}\n${client}`;
    for (const forbidden of [
      'id="handoff-code"',
      'id="command-input"',
      'id="terminal-output"',
      "/api/handoff",
      "/api/session",
      "/api/events",
      "/api/input",
      "EventSource(",
      "sessionStorage",
      "computer-system.web-terminal-token",
    ]) {
      expect(publicCode).not.toContain(forbidden);
    }
    expect(landing).toContain("This Pages site publishes documentation only");
    expect(manual).toContain(
      "live Web Terminal access requires the local BDS companion",
    );
  });

  it("pre-renders the exact canonical manual and its stable navigation", () => {
    expect(attributeValues(manual, "data-chapter-id")).toEqual([
      ...manualChapters.map(({ id }) => id),
      ...manualChapters.map(({ id }) => id),
    ]);
    expect(
      attributeValues(manual, "data-chapter-id").slice(manualChapters.length),
    ).toEqual(manualChapters.map(({ id }) => id));
    expect(attributeValues(manual, "data-part-id")).toEqual(
      manualParts.map(({ id }) => id),
    );
    expect(attributeValues(manual, "data-path-id")).toEqual(
      manualPaths.map(({ id }) => id),
    );

    for (const chapter of manualChapters) {
      expect(occurrences(manual, `id="chapter-${chapter.id}"`)).toBe(1);
      expect(manual).toContain(`data-chapter-number="${chapter.number}"`);
      for (const section of chapter.sections) {
        expect(occurrences(manual, `id="${section.id}"`)).toBe(1);
      }
    }

    expect(manual).toContain('id="manual-search-input"');
    expect(manual).toContain('maxlength="80"');
    expect(manual).toContain('id="manual-search-results"');
    expect(manual).toContain('id="manual-previous"');
    expect(manual).toContain('id="manual-next"');
    expect(manual).toContain("The complete manual remains available below");
    expect(manual).toContain(
      'id="terminal-editor-static-github-pages-reference"',
    );
    expect(manual).toContain(
      "The Pages site is documentation only. It cannot connect to BDS",
    );
  });

  it("keeps CS QBASIC 1.0 exclusive to the CS-DOS profile", () => {
    const desktopLanguages = "Python, CS ASM 1.0, CS C/C++ 1.0; no BASIC";
    expect(landing).toContain(desktopLanguages);
    expect(occurrences(landing, desktopLanguages)).toBe(2);
    expect(landing).toContain(
      "CS ASM 1.0, CS C/C++ 1.0, CS QBASIC 1.0; no user Python",
    );
    expect(landing).toContain("C:\\&gt;PWB HELLO.CPP");
    expect(landing).toContain("C:\\&gt;QBASIC /RUN HELLO.BAS");
    expect(landing).not.toContain("Python, ASM, BASIC, C, C++");
    expect(landing).not.toContain("C:\\&gt;BASICC HELLO.BAS");
  });

  it("keeps links and assets under an arbitrary repository base path", async () => {
    await expectDocumentLinks(landing, siteUrl);
    await expectDocumentLinks(manual, new URL("manual/", siteUrl));

    expect(rootRelativeLocalUrls(landing)).toEqual([]);
    expect(rootRelativeLocalUrls(manual)).toEqual([]);
    expect(stylesheet).not.toMatch(/(?:url|@import)\s*\([^)]*["']?\/(?!\/)/iu);
    expect(landing).toContain('href="./manual/"');
    expect(manual).toContain('href="../styles.css"');
    expect(manual).toContain('src="../assets/');

    const deepMissingUrl = new URL("missing/nested/publication", siteUrl);
    for (const value of localNavigationValues(fallback)) {
      const resolved = new URL(value, deepMissingUrl);
      expect(resolved.pathname.startsWith(siteUrl.pathname)).toBe(true);
      expect(resolved.pathname).not.toContain("/missing/nested/");
    }
  });

  it("emits canonical metadata, discovery files, and bounded enhancement hooks", async () => {
    const [robots, sitemap, workflow, packageSource, clientSource] =
      await Promise.all([
        read("robots.txt"),
        read("sitemap.xml"),
        readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8"),
        readFile(path.join(root, "package.json"), "utf8"),
        readFile(path.join(root, "site", "manual", "app.js"), "utf8"),
      ]);
    const packageJson = JSON.parse(packageSource);

    expect(landing).toContain(`rel="canonical" href="${siteUrl.href}"`);
    expect(landing).toContain(`property="og:url" content="${siteUrl.href}"`);
    expect(manual).toContain(
      `rel="canonical" href="${new URL("manual/", siteUrl).href}"`,
    );
    expect(landing).toContain(
      `name="build-revision" content="${buildRevision.slice(0, 12)}"`,
    );
    expect(robots).toContain(
      `Sitemap: ${new URL("sitemap.xml", siteUrl).href}`,
    );
    expect(sitemap).toContain(`<loc>${siteUrl.href}</loc>`);
    expect(sitemap).toContain(`<loc>${new URL("manual/", siteUrl).href}</loc>`);
    expect(fallback).toContain('name="robots" content="noindex"');
    expect(client).toContain("hashchange");
    expect(client).not.toMatch(/\bfetch\s*\(|\bEventSource\s*\(/u);
    expect(clientSource).toContain("const maximumSearchLength = 80;");
    expect(clientSource).toContain("const maximumSearchTerms = 8;");
    expect(clientSource).toContain("const maximumSearchResults = 24;");
    expect(clientSource).toMatch(
      /\.slice\(\s*0,\s*maximumSearchResults,?\s*\)/u,
    );

    expect(packageJson.scripts["build:pages"]).toBe(
      "node tools/build-pages.mjs",
    );
    expect(packageJson.scripts["test:pages"]).toContain(
      "tests/tools/pagesBuild.test.mjs",
    );
    expect(workflow).toContain("- main");
    expect(workflow).not.toContain("- phase-2/computer-vertical-slice");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("actions/configure-pages@");
    expect(workflow).toContain("PAGES_SITE_URL:");
    expect(workflow).toContain("path: dist/pages");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("actions/deploy-pages@");
  });

  async function read(relativePath) {
    return readFile(path.join(outputRoot, relativePath), "utf8");
  }

  async function expectDocumentLinks(html, documentUrl) {
    const documentIds = new Set(attributeValues(html, "id"));
    for (const value of localNavigationValues(html)) {
      if (value.startsWith("#")) {
        expect(documentIds.has(value.slice(1))).toBe(true);
        continue;
      }
      const resolved = new URL(value, documentUrl);
      if (resolved.origin !== siteUrl.origin) continue;
      expect(resolved.pathname.startsWith(siteUrl.pathname)).toBe(true);
      const relativePath = decodeURIComponent(
        resolved.pathname.slice(siteUrl.pathname.length),
      );
      const artifactPath =
        relativePath === "" || relativePath.endsWith("/")
          ? `${relativePath}index.html`
          : relativePath;
      expect(
        (await stat(path.join(outputRoot, artifactPath))).isFile(),
        `${value} resolved to ${artifactPath || "<artifact root>"}`,
      ).toBe(true);
    }
  }
});

function attributeValues(html, attribute) {
  const pattern = new RegExp(`(?:^|\\s)${attribute}="([^"]+)"`, "gu");
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

function localNavigationValues(html) {
  return [
    ...attributeValues(html, "href"),
    ...attributeValues(html, "src"),
  ].filter(
    (value) =>
      !value.startsWith("https://github.com/") &&
      !value.startsWith("mailto:") &&
      !value.startsWith("data:"),
  );
}

function rootRelativeLocalUrls(html) {
  return localNavigationValues(html).filter(
    (value) => value.startsWith("/") && !value.startsWith("//"),
  );
}

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

async function listFiles(rootDirectory, relative = "") {
  const result = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(relative, entry.name).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      result.push(
        ...(await listFiles(path.join(rootDirectory, entry.name), child)),
      );
    } else if (entry.isFile()) {
      result.push(child);
    }
  }
  return result.sort();
}
