import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { manualChapters, manualParts, manualPaths } from "../web/manual.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultOutputRoot = path.join(projectRoot, "dist", "pages");
const allowedOutputParent = path.join(projectRoot, "dist");
const defaultSiteUrl = "https://tsuyoshi-otake.github.io/computer-system/";
const allowedAssetExtensions = new Set([".png"]);
const expectedOutputFiles = new Set([
  ".nojekyll",
  "404.html",
  "index.html",
  "manual/app.js",
  "manual/index.html",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
]);
const templateTokens = [
  "BUILD_REVISION",
  "MANUAL_CHAPTERS",
  "MANUAL_PATHS",
  "MANUAL_TOC",
  "MANUAL_URL",
  "OG_IMAGE_URL",
  "SITE_URL",
];

export async function buildPages(options = {}) {
  const outputRoot = resolveOutputRoot(options.outputRoot ?? defaultOutputRoot);
  const siteUrl = normalizeSiteUrl(
    options.siteUrl ?? process.env.PAGES_SITE_URL ?? inferredSiteUrl(),
  );
  const manualUrl = new URL("manual/", siteUrl).href;
  const ogImageUrl = new URL(
    "assets/machines/cs-advanced-computer.png",
    siteUrl,
  ).href;
  const buildRevision = normalizeBuildRevision(
    options.buildRevision ?? process.env.GITHUB_SHA,
  );
  const sourceRoot = path.join(projectRoot, "site");
  const sourceFiles = [
    path.join(sourceRoot, "index.template.html"),
    path.join(sourceRoot, "manual", "index.template.html"),
    path.join(sourceRoot, "404.template.html"),
    path.join(sourceRoot, "styles.css"),
    path.join(sourceRoot, "manual", "app.js"),
  ];

  assertManualPublication();
  await allOrThrow(sourceFiles.map(assertRegularSourceFile));
  const replacements = {
    BUILD_REVISION: escapeHtml(buildRevision),
    MANUAL_CHAPTERS: renderManualChapters(),
    MANUAL_PATHS: renderManualPaths(),
    MANUAL_TOC: renderManualToc(),
    MANUAL_URL: escapeHtml(manualUrl),
    OG_IMAGE_URL: escapeHtml(ogImageUrl),
    SITE_URL: escapeHtml(siteUrl.href),
  };

  await rm(outputRoot, { force: true, recursive: true });
  try {
    await allOrThrow([
      mkdir(path.join(outputRoot, "manual"), { recursive: true }),
      mkdir(path.join(outputRoot, "assets"), { recursive: true }),
    ]);

    await allOrThrow([
      renderTemplateFile(
        path.join(sourceRoot, "index.template.html"),
        path.join(outputRoot, "index.html"),
        replacements,
      ),
      renderTemplateFile(
        path.join(sourceRoot, "manual", "index.template.html"),
        path.join(outputRoot, "manual", "index.html"),
        replacements,
      ),
      renderTemplateFile(
        path.join(sourceRoot, "404.template.html"),
        path.join(outputRoot, "404.html"),
        replacements,
      ),
      copyFile(
        path.join(sourceRoot, "styles.css"),
        path.join(outputRoot, "styles.css"),
      ),
      copyAssets(
        path.join(projectRoot, "web", "assets"),
        path.join(outputRoot, "assets"),
      ),
      build({
        bundle: true,
        entryPoints: [path.join(sourceRoot, "manual", "app.js")],
        format: "iife",
        logLevel: "silent",
        minify: true,
        outfile: path.join(outputRoot, "manual", "app.js"),
        platform: "browser",
        sourcemap: false,
        target: "es2022",
      }),
    ]);

    await allOrThrow([
      writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8"),
      writeFile(
        path.join(outputRoot, "robots.txt"),
        `User-agent: *\nAllow: ${siteUrl.pathname}\nSitemap: ${new URL("sitemap.xml", siteUrl).href}\n`,
        "utf8",
      ),
      writeFile(
        path.join(outputRoot, "sitemap.xml"),
        renderSitemap([siteUrl.href, manualUrl]),
        "utf8",
      ),
    ]);

    const files = await assertOutputAllowlist(outputRoot);
    return {
      chapterCount: manualChapters.length,
      files,
      outputRoot,
      siteUrl: siteUrl.href,
    };
  } catch (error) {
    await rm(outputRoot, { force: true, recursive: true });
    throw error;
  }
}

async function allOrThrow(operations) {
  const outcomes = await Promise.allSettled(operations);
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure !== undefined) throw failure.reason;
  return outcomes.map((outcome) => outcome.value);
}

async function assertRegularSourceFile(source) {
  let metadata;
  try {
    metadata = await lstat(source);
  } catch (error) {
    throw new Error(`Missing GitHub Pages source file: ${source}`, {
      cause: error,
    });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`GitHub Pages source must be a regular file: ${source}`);
  }
}

function assertManualPublication() {
  if (manualChapters.length !== 16) {
    throw new Error(
      `GitHub Pages requires the canonical 16-chapter manual; found ${String(manualChapters.length)}`,
    );
  }

  const chapterIds = new Set(manualChapters.map(({ id }) => id));
  if (chapterIds.size !== manualChapters.length) {
    throw new Error(
      "GitHub Pages cannot publish duplicate manual chapter IDs.",
    );
  }
  for (const part of manualParts) {
    for (const chapterId of part.chapterIds) {
      if (!chapterIds.has(chapterId)) {
        throw new Error(
          `Manual part ${part.id} references unknown chapter ${chapterId}.`,
        );
      }
    }
  }
  for (const readingPath of manualPaths) {
    for (const chapterId of readingPath.chapterIds) {
      if (!chapterIds.has(chapterId)) {
        throw new Error(
          `Manual path ${readingPath.id} references unknown chapter ${chapterId}.`,
        );
      }
    }
  }
}

function renderManualToc() {
  const chaptersById = new Map(
    manualChapters.map((chapter) => [chapter.id, chapter]),
  );
  return manualParts
    .map((part) => {
      const links = part.chapterIds
        .map((chapterId) => {
          const chapter = chaptersById.get(chapterId);
          return `<li><a class="manual-toc-link" data-chapter-id="${escapeAttribute(chapter.id)}" href="#chapter-${escapeAttribute(chapter.id)}"><span>${escapeHtml(chapter.number)}</span>${escapeHtml(chapter.title)}</a></li>`;
        })
        .join("");
      return `<section class="manual-part" data-part-id="${escapeAttribute(part.id)}"><h2 class="manual-part-title"><span>Part ${escapeHtml(part.number)}</span>${escapeHtml(part.title)}</h2><p>${escapeHtml(part.summary)}</p><ol>${links}</ol></section>`;
    })
    .join("");
}

function renderManualPaths() {
  const chaptersById = new Map(
    manualChapters.map((chapter) => [chapter.id, chapter]),
  );
  return manualPaths
    .map((readingPath) => {
      const links = readingPath.chapterIds
        .map((chapterId) => {
          const chapter = chaptersById.get(chapterId);
          return `<li><a href="#chapter-${escapeAttribute(chapter.id)}">${escapeHtml(chapter.number)} ${escapeHtml(chapter.title)}</a></li>`;
        })
        .join("");
      return `<section class="reading-path" data-path-id="${escapeAttribute(readingPath.id)}"><h3>${escapeHtml(readingPath.title)}</h3><p>${escapeHtml(readingPath.summary)}</p><ol>${links}</ol></section>`;
    })
    .join("");
}

function renderManualChapters() {
  return manualChapters
    .map((chapter) => {
      const html = makeManualAssetsRelative(chapter.html, chapter.id);
      return `<article class="manual-chapter" id="chapter-${escapeAttribute(chapter.id)}" data-chapter-id="${escapeAttribute(chapter.id)}" data-chapter-number="${escapeAttribute(chapter.number)}" data-chapter-title="${escapeAttribute(chapter.title)}">${html}</article>`;
    })
    .join("\n");
}

function makeManualAssetsRelative(html, chapterId) {
  const rewritten = html
    .replaceAll('src="/assets/', 'src="../assets/')
    .replaceAll("src='/assets/", "src='../assets/")
    .replaceAll('href="/assets/', 'href="../assets/')
    .replaceAll("href='/assets/", "href='../assets/");
  if (/\b(?:href|src)\s*=\s*["']\/(?!\/)/iu.test(rewritten)) {
    throw new Error(
      `Manual chapter ${chapterId} contains a root-relative local asset URL.`,
    );
  }
  return rewritten;
}

async function renderTemplateFile(source, target, replacements) {
  let template;
  try {
    template = await readFile(source, "utf8");
  } catch (error) {
    throw new Error(`Missing GitHub Pages template: ${source}`, {
      cause: error,
    });
  }
  const rendered = renderTemplate(template, replacements, source);
  await writeFile(target, rendered, "utf8");
}

function renderTemplate(template, replacements, source) {
  const knownTokens = new Set(templateTokens);
  return template.replace(
    /\{\{([A-Z][A-Z0-9_]*)\}\}/gu,
    (_placeholder, token) => {
      if (!knownTokens.has(token)) {
        throw new Error(
          `Unknown GitHub Pages template token in ${source}: ${token}`,
        );
      }
      return replacements[token];
    },
  );
}

async function copyAssets(source, target, relative = "") {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    if (entry.name.startsWith(".")) {
      throw new Error(
        `Hidden files are not allowed in the public Pages assets: ${path.join(relative, entry.name)}`,
      );
    }
    const sourcePath = path.join(source, entry.name);
    const relativePath = path.join(relative, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in the public Pages assets: ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyAssets(sourcePath, targetPath, relativePath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported Pages asset type: ${relativePath}`);
    }
    if (entry.name === "CLAUDE.md") continue;
    if (!allowedAssetExtensions.has(path.extname(entry.name).toLowerCase())) {
      throw new Error(`Unsupported public Pages asset: ${relativePath}`);
    }
    await copyFile(sourcePath, targetPath);
  }
}

async function assertOutputAllowlist(outputRoot) {
  const files = await listFiles(outputRoot);
  for (const file of files) {
    if (!expectedOutputFiles.has(file) && !file.startsWith("assets/")) {
      throw new Error(`Unexpected file in the public Pages artifact: ${file}`);
    }
  }
  for (const expected of expectedOutputFiles) {
    if (!files.includes(expected)) {
      throw new Error(`Missing file in the public Pages artifact: ${expected}`);
    }
  }
  return files;
}

async function listFiles(root, relative = "") {
  const result = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const absolute = path.join(root, entry.name);
    const child = path.join(relative, entry.name).replaceAll(path.sep, "/");
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Pages output must not contain symbolic links: ${child}`);
    }
    if (metadata.isDirectory()) {
      result.push(...(await listFiles(absolute, child)));
    } else if (metadata.isFile()) {
      result.push(child);
    } else {
      throw new Error(`Pages output contains an unsupported entry: ${child}`);
    }
  }
  return result;
}

function renderSitemap(urls) {
  const entries = urls
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function inferredSiteUrl() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository === undefined) return defaultSiteUrl;
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra !== undefined) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  }
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

function resolveOutputRoot(value) {
  const resolved = path.resolve(value);
  const relative = path.relative(allowedOutputParent, resolved);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `GitHub Pages output must be a child of ${allowedOutputParent}: ${resolved}`,
    );
  }
  return resolved;
}

function normalizeSiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(
      `PAGES_SITE_URL must be an absolute URL: ${String(value)}`,
      {
        cause: error,
      },
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("PAGES_SITE_URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "PAGES_SITE_URL must not contain credentials, a query, or a fragment.",
    );
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  return parsed;
}

function normalizeBuildRevision(value) {
  if (value === undefined || value === "") return "development";
  if (!/^[0-9a-f]{7,64}$/iu.test(value)) {
    throw new Error("BUILD_REVISION must be a 7-64 character hexadecimal SHA.");
  }
  return value.slice(0, 12).toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const escapeAttribute = escapeHtml;
const escapeXml = escapeHtml;

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  const result = await buildPages();
  console.log(
    `Built ${String(result.chapterCount)}-chapter GitHub Pages site in ${result.outputRoot}`,
  );
}
