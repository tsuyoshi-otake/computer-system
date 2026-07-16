import { searchManual } from "../../web/manual.js";

const maximumSearchResults = 24;
const maximumSearchLength = 80;
const maximumSearchTerms = 8;

document.documentElement.classList.add("manual-js");

const chapters = [
  ...document.querySelectorAll(".manual-chapter[data-chapter-id]"),
];
const tocLinks = [
  ...document.querySelectorAll(".manual-toc-link[data-chapter-id]"),
];
const searchForm = document.querySelector(".manual-search");
const searchInput = document.querySelector("#manual-search-input");
const searchStatus = document.querySelector("#manual-search-status");
const searchResults = document.querySelector("#manual-search-results");
const position = document.querySelector("#manual-position");
const previousLinks = [
  document.querySelector("#manual-previous"),
  document.querySelector("#manual-previous-bottom"),
].filter(Boolean);
const nextLinks = [
  document.querySelector("#manual-next"),
  document.querySelector("#manual-next-bottom"),
].filter(Boolean);

if (searchInput instanceof HTMLInputElement) {
  searchInput.maxLength = maximumSearchLength;
  searchInput.value = searchQueryFromLocation();
  searchInput.addEventListener("input", () => {
    syncSearchQuery(searchInput.value);
    renderSearchResults();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || searchInput.value.length === 0) return;
    event.preventDefault();
    clearSearch();
  });
}

searchForm?.addEventListener("reset", () => {
  requestAnimationFrame(clearSearch);
});
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!(searchInput instanceof HTMLInputElement)) return;
  syncSearchQuery(searchInput.value);
  renderSearchResults();
});

window.addEventListener("hashchange", () => showChapterFromLocation(true));
window.addEventListener("popstate", scheduleLocationRestore);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) scheduleLocationRestore();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey)
    return;
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  event.preventDefault();
  searchInput?.focus();
});

if (chapters.length > 0) {
  showChapterFromLocation(window.location.hash.length > 1);
}
if (searchInput instanceof HTMLInputElement && searchInput.value.length > 0) {
  renderSearchResults();
}

function renderSearchResults() {
  if (!(searchInput instanceof HTMLInputElement) || searchResults === null)
    return;
  const query = searchInput.value.slice(0, maximumSearchLength).trim();
  if (query.length === 0) {
    clearSearchOutput();
    return;
  }

  const boundedQuery = query
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maximumSearchTerms)
    .join(" ");
  const matches = searchManual(boundedQuery, {
    limit: maximumSearchResults,
  }).slice(0, maximumSearchResults);
  const fragment = document.createDocumentFragment();
  for (const result of matches) fragment.append(createSearchResult(result));
  searchResults.replaceChildren(fragment);
  searchResults.hidden = false;
  if (searchStatus !== null) {
    searchStatus.textContent = `${String(matches.length)} ${matches.length === 1 ? "result" : "results"} for “${query}”.`;
  }
}

function createSearchResult(result) {
  const link = document.createElement("a");
  link.className = "manual-search-result";
  link.href = result.href.startsWith("#")
    ? result.href
    : `#${result.sectionId}`;

  const meta = document.createElement("span");
  meta.textContent = `${result.chapterNumber} · ${result.chapterTitle} · ${formatResultType(result.type)}`;
  const title = document.createElement("b");
  title.textContent = result.sectionTitle;
  const snippet = document.createElement("small");
  snippet.textContent = result.snippet;
  link.append(meta, title, snippet);
  return link;
}

function formatResultType(type) {
  return String(type)
    .replace(/-/gu, " ")
    .replace(/^./u, (character) => character.toLocaleUpperCase("en"));
}

function clearSearch() {
  if (searchInput instanceof HTMLInputElement) searchInput.value = "";
  syncSearchQuery("");
  clearSearchOutput();
}

function clearSearchOutput() {
  searchResults?.replaceChildren();
  if (searchResults !== null) searchResults.hidden = true;
  if (searchStatus !== null)
    searchStatus.textContent = `${String(chapters.length)} chapters in 4 parts.`;
}

function syncSearchQuery(value) {
  const url = new URL(window.location.href);
  const query = String(value).slice(0, maximumSearchLength).trim();
  if (query.length === 0) url.searchParams.delete("q");
  else url.searchParams.set("q", query);
  history.replaceState(null, "", url);
}

function searchQueryFromLocation() {
  return (
    new URL(window.location.href).searchParams
      .get("q")
      ?.slice(0, maximumSearchLength) ?? ""
  );
}

function restoreSearchFromLocation() {
  if (!(searchInput instanceof HTMLInputElement)) return;
  searchInput.value = searchQueryFromLocation();
  if (searchInput.value.length > 0) renderSearchResults();
  else clearSearchOutput();
}

let pendingLocationRestore;
function scheduleLocationRestore() {
  if (pendingLocationRestore !== undefined) {
    window.clearTimeout(pendingLocationRestore);
  }
  pendingLocationRestore = window.setTimeout(() => {
    pendingLocationRestore = undefined;
    restoreSearchFromLocation();
    showChapterFromLocation(true);
  }, 0);
}

function showChapterFromLocation(focusTarget) {
  if (chapters.length === 0) return;
  const requestedId = decodeHash(window.location.hash);
  const requestedTarget =
    requestedId.length > 0 ? document.getElementById(requestedId) : null;
  const selectedChapter =
    requestedTarget?.closest(".manual-chapter[data-chapter-id]") ??
    chapters.find(({ id }) => id === requestedId) ??
    chapters[0];
  const chapterIndex = chapters.indexOf(selectedChapter);

  for (const chapter of chapters) chapter.hidden = chapter !== selectedChapter;
  for (const link of tocLinks) {
    if (link.dataset.chapterId === selectedChapter.dataset.chapterId) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  const chapterNumber =
    selectedChapter.dataset.chapterNumber ??
    String(chapterIndex + 1).padStart(2, "0");
  const chapterTitle =
    selectedChapter.dataset.chapterTitle ??
    selectedChapter.querySelector("h2")?.textContent?.trim() ??
    "Field Manual";
  if (position !== null) {
    position.textContent = `${chapterNumber} / ${String(chapters.length).padStart(2, "0")}`;
  }
  document.title = `${chapterNumber} · ${chapterTitle} — Computer System Field Manual`;
  updateChapterLink(previousLinks, chapters[chapterIndex - 1], "Previous");
  updateChapterLink(nextLinks, chapters[chapterIndex + 1], "Next");

  if (requestedId.length === 0) {
    const url = new URL(window.location.href);
    url.hash = selectedChapter.id;
    history.replaceState(null, "", url);
    return;
  }
  if (!focusTarget || requestedTarget === null) return;
  requestAnimationFrame(() => {
    const focusElement = requestedTarget.matches("h1, h2, h3, h4, h5, h6")
      ? requestedTarget
      : requestedTarget.querySelector("h2, h3");
    if (focusElement instanceof HTMLElement) {
      focusElement.tabIndex = -1;
      focusElement.focus({ preventScroll: true });
    }
    requestedTarget.scrollIntoView({ block: "start" });
  });
}

function updateChapterLink(links, chapter, label) {
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    if (chapter === undefined) {
      link.setAttribute("aria-disabled", "true");
      link.removeAttribute("href");
      link.title = `Already at the ${label === "Previous" ? "first" : "final"} chapter`;
    } else {
      link.removeAttribute("aria-disabled");
      link.href = `#${chapter.id}`;
      link.title = `${label}: ${chapter.dataset.chapterTitle ?? chapter.dataset.chapterId ?? "chapter"}`;
    }
  }
}

function decodeHash(hash) {
  if (hash.length <= 1) return "";
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}
