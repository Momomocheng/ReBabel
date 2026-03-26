const COPYRIGHT_PATTERNS = [
  /\ball rights reserved\b/i,
  /\bcopyright\b/i,
  /\bisbn(?:-1[03])?\b/i,
  /\blibrary of congress\b/i,
  /\bprinted in\b/i,
  /\bpublished by\b/i,
  /\bcover design\b/i,
  /\bebook edition\b/i,
  /\bfirst published\b/i,
  /\bvisit us at\b/i,
  /\bwww\./i,
];

const CONTENTS_PATTERNS = [
  /^contents$/i,
  /^table of contents$/i,
  /(\.{2,}|…{2,})\s*\d+\s*$/i,
];

export function normalizeImportDraftParagraph(paragraph: string) {
  return paragraph.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isPageMarker(text: string) {
  return /^(page\s+)?\d{1,4}$/i.test(text) || /^[ivxlcdm]{1,8}$/i.test(text);
}

function looksLikeContentsEntry(text: string) {
  if (CONTENTS_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return (
    /^[a-z0-9][a-z0-9 ,.'&:;!?()-]{0,100}\s+\d{1,4}$/i.test(text) &&
    !/[.!?]["']?$/u.test(text) &&
    text.split(/\s+/).length <= 14
  );
}

export function normalizeImportDraftParagraphs(paragraphs: string[]) {
  return paragraphs.map(normalizeImportDraftParagraph).filter(Boolean);
}

export function matchesImportDraftSearch(paragraph: string, search: string) {
  const query = search.trim().toLocaleLowerCase();

  if (!query) {
    return true;
  }

  return normalizeImportDraftParagraph(paragraph).toLocaleLowerCase().includes(query);
}

export function isLikelyNoiseParagraph(paragraph: string) {
  const normalized = normalizeImportDraftParagraph(paragraph);

  if (!normalized) {
    return true;
  }

  if (isPageMarker(normalized)) {
    return true;
  }

  if (looksLikeContentsEntry(normalized)) {
    return true;
  }

  return COPYRIGHT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function countLikelyNoiseParagraphs(paragraphs: string[]) {
  return paragraphs.filter(isLikelyNoiseParagraph).length;
}

export function removeLikelyNoiseParagraphs(paragraphs: string[]) {
  const nextParagraphs = paragraphs.filter((paragraph) => !isLikelyNoiseParagraph(paragraph));

  return {
    nextParagraphs,
    removedCount: paragraphs.length - nextParagraphs.length,
  };
}

export function countShortParagraphs(paragraphs: string[], minLength: number) {
  const threshold = Math.max(1, Math.floor(minLength));

  return paragraphs.filter((paragraph) => isShortParagraph(paragraph, threshold)).length;
}

export function removeShortParagraphs(paragraphs: string[], minLength: number) {
  const threshold = Math.max(1, Math.floor(minLength));
  const nextParagraphs = paragraphs.filter(
    (paragraph) => !isShortParagraph(paragraph, threshold),
  );

  return {
    nextParagraphs,
    removedCount: paragraphs.length - nextParagraphs.length,
  };
}

export function isShortParagraph(paragraph: string, minLength: number) {
  const threshold = Math.max(1, Math.floor(minLength));

  return normalizeImportDraftParagraph(paragraph).length < threshold;
}
