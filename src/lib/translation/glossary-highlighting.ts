import type { GlossaryTerm } from "@/lib/translation/types";

export type GlossaryMatchVariant = "source" | "target";

export type GlossaryMatch = {
  end: number;
  matchedText: string;
  start: number;
  term: GlossaryTerm;
  variant: GlossaryMatchVariant;
};

function containsLatinWordCharacters(value: string) {
  return /[A-Za-z0-9]/.test(value);
}

function isWordBoundaryCharacter(value: string | undefined) {
  return !value || !/[A-Za-z0-9]/.test(value);
}

function respectsWordBoundaries(text: string, start: number, end: number) {
  return (
    isWordBoundaryCharacter(text[start - 1]) && isWordBoundaryCharacter(text[end])
  );
}

export function findGlossaryMatches(
  text: string | null | undefined,
  glossaryTerms: GlossaryTerm[],
  variant: GlossaryMatchVariant,
): GlossaryMatch[] {
  if (!text || glossaryTerms.length === 0) {
    return [];
  }

  const normalizedText = text.toLocaleLowerCase();
  const candidates = glossaryTerms
    .map((term) => {
      const needle = (variant === "source" ? term.source : term.target).trim();

      return {
        needle,
        normalizedNeedle: needle.toLocaleLowerCase(),
        requiresWordBoundary: variant === "source" && containsLatinWordCharacters(needle),
        term,
      };
    })
    .filter((candidate) => candidate.needle)
    .sort((left, right) => right.needle.length - left.needle.length);
  const occupied = Array.from({ length: text.length }, () => false);
  const matches: GlossaryMatch[] = [];

  candidates.forEach((candidate) => {
    let searchStartIndex = 0;

    while (searchStartIndex < normalizedText.length) {
      const matchStartIndex = normalizedText.indexOf(
        candidate.normalizedNeedle,
        searchStartIndex,
      );

      if (matchStartIndex < 0) {
        break;
      }

      const matchEndIndex = matchStartIndex + candidate.needle.length;
      const overlaps = occupied
        .slice(matchStartIndex, matchEndIndex)
        .some(Boolean);

      if (
        !overlaps &&
        (!candidate.requiresWordBoundary ||
          respectsWordBoundaries(text, matchStartIndex, matchEndIndex))
      ) {
        for (let index = matchStartIndex; index < matchEndIndex; index += 1) {
          occupied[index] = true;
        }

        matches.push({
          end: matchEndIndex,
          matchedText: text.slice(matchStartIndex, matchEndIndex),
          start: matchStartIndex,
          term: candidate.term,
          variant,
        });
      }

      searchStartIndex = matchStartIndex + candidate.needle.length;
    }
  });

  return matches.sort((left, right) => left.start - right.start);
}
