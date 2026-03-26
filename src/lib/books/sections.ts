import type { BookSection } from "@/lib/books/types";

type BookSectionLike = Partial<BookSection> | null | undefined;

const DEFAULT_SECTION_TITLE = "全文";

function getMaxParagraphIndex(paragraphCount: number) {
  return Math.max(Math.floor(paragraphCount) - 1, 0);
}

function clampParagraphIndex(index: number, paragraphCount: number) {
  return Math.min(Math.max(Math.floor(index), 0), getMaxParagraphIndex(paragraphCount));
}

function fallbackSectionTitle(index: number) {
  return index === 0 ? DEFAULT_SECTION_TITLE : `章节 ${index + 1}`;
}

export function createDefaultBookSections(
  paragraphCount: number,
  title = DEFAULT_SECTION_TITLE,
): BookSection[] {
  return [
    {
      id: "section-1",
      title: title.trim() || DEFAULT_SECTION_TITLE,
      startParagraphIndex: clampParagraphIndex(0, paragraphCount),
    },
  ];
}

export function normalizeBookSections(
  sections: BookSectionLike[] | null | undefined,
  paragraphCount: number,
): BookSection[] {
  const normalizedSections = (sections ?? [])
    .filter((section): section is Partial<BookSection> => Boolean(section))
    .map((section, index) => ({
      id: section.id?.trim() || `section-${index + 1}`,
      title: section.title?.trim() || fallbackSectionTitle(index),
      startParagraphIndex: Number.isFinite(section.startParagraphIndex)
        ? clampParagraphIndex(section.startParagraphIndex ?? 0, paragraphCount)
        : 0,
    }))
    .sort((left, right) => left.startParagraphIndex - right.startParagraphIndex)
    .filter(
      (section, index, current) =>
        index === 0 ||
        section.startParagraphIndex !== current[index - 1]?.startParagraphIndex,
    );

  const nextSections =
    normalizedSections.length === 0
      ? createDefaultBookSections(paragraphCount)
      : normalizedSections[0]?.startParagraphIndex === 0
        ? normalizedSections
        : [
            createDefaultBookSections(paragraphCount)[0],
            ...normalizedSections,
          ];

  return nextSections.map((section, index) => ({
    ...section,
    id: section.id || `section-${index + 1}`,
    title: section.title || fallbackSectionTitle(index),
  }));
}

export function buildParagraphSectionIds(
  paragraphCount: number,
  sections: BookSectionLike[] | null | undefined,
): string[] {
  const normalizedSections = normalizeBookSections(sections, paragraphCount);
  const paragraphSectionIds: string[] = [];
  let sectionIndex = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
    while (
      sectionIndex + 1 < normalizedSections.length &&
      normalizedSections[sectionIndex + 1]!.startParagraphIndex <= paragraphIndex
    ) {
      sectionIndex += 1;
    }

    paragraphSectionIds.push(normalizedSections[sectionIndex]!.id);
  }

  return paragraphSectionIds;
}

export function buildSectionsFromParagraphSectionIds(
  paragraphSectionIds: string[],
  knownSections: BookSectionLike[] | null | undefined,
): BookSection[] {
  if (paragraphSectionIds.length === 0) {
    return createDefaultBookSections(0);
  }

  const titleBySectionId = new Map(
    normalizeBookSections(knownSections, paragraphSectionIds.length).map((section) => [
      section.id,
      section.title,
    ]),
  );
  const nextSections: BookSection[] = [];

  paragraphSectionIds.forEach((sectionId, paragraphIndex) => {
    const normalizedSectionId =
      sectionId.trim() || nextSections[nextSections.length - 1]?.id || `section-${paragraphIndex + 1}`;
    const currentSection = nextSections[nextSections.length - 1];

    if (currentSection?.id === normalizedSectionId) {
      return;
    }

    nextSections.push({
      id: normalizedSectionId,
      title:
        titleBySectionId.get(normalizedSectionId) ||
        fallbackSectionTitle(nextSections.length),
      startParagraphIndex: paragraphIndex,
    });
  });

  return normalizeBookSections(nextSections, paragraphSectionIds.length);
}

export function getSectionIndexForParagraph(
  sections: BookSection[],
  paragraphIndex: number,
): number {
  let activeSectionIndex = 0;

  sections.forEach((section, index) => {
    if (section.startParagraphIndex <= paragraphIndex) {
      activeSectionIndex = index;
    }
  });

  return activeSectionIndex;
}

export function getSectionParagraphRange(
  sections: BookSection[],
  sectionIndex: number,
  paragraphCount: number,
): {
  endParagraphIndex: number;
  startParagraphIndex: number;
} {
  const safeIndex = Math.min(Math.max(sectionIndex, 0), sections.length - 1);
  const start = sections[safeIndex]?.startParagraphIndex ?? 0;
  const end =
    safeIndex + 1 < sections.length
      ? sections[safeIndex + 1]!.startParagraphIndex - 1
      : Math.max(paragraphCount - 1, 0);

  return {
    endParagraphIndex: Math.max(end, start),
    startParagraphIndex: start,
  };
}
