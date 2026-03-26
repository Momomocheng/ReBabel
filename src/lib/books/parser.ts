import type { BookParagraph, BookStats } from "@/lib/books/types";

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function createParagraphId(index: number) {
  return `p-${index + 1}`;
}

function normalizeParagraphText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string) {
  const matches = text.match(/[A-Za-z0-9']+/g);
  return matches?.length ?? 0;
}

export function splitPlainTextParagraphs(text: string) {
  const normalized = normalizeLineEndings(text).trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" "),
    )
    .map(normalizeParagraphText)
    .filter(Boolean);
}

export function createBookParagraphs(paragraphTexts: string[]): BookParagraph[] {
  return paragraphTexts
    .map((sourceText, index) => ({
      id: createParagraphId(index),
      index,
      reviewStatus: "unreviewed" as const,
      sourceText,
      translatedText: null,
      translationStatus: "pending" as const,
      translationError: null,
    }));
}

export function parseTxtParagraphs(text: string): BookParagraph[] {
  return createBookParagraphs(splitPlainTextParagraphs(text));
}

export function buildBookStats(paragraphs: BookParagraph[]): BookStats {
  const sourceText = paragraphs.map((paragraph) => paragraph.sourceText).join("\n");

  return {
    paragraphCount: paragraphs.length,
    wordCount: countWords(sourceText),
    characterCount: sourceText.length,
  };
}

export function deriveTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Untitled Book";
}
