import type { BookRecord } from "@/lib/books/types";

export type TranslationReviewReason = {
  code:
    | "copied-source"
    | "english-leak"
    | "english-phrases"
    | "needs-revision"
    | "too-short"
    | "dialogue-mismatch"
    | "number-mismatch"
    | "question-mismatch"
    | "long-paragraph";
  label: string;
  weight: number;
};

export type TranslationReviewCandidate = {
  paragraphIndex: number;
  sampleKind: "coverage" | "high-risk";
  score: number;
  sourceText: string;
  translatedText: string;
  reasons: TranslationReviewReason[];
};

export type TranslationReviewSample = {
  candidates: TranslationReviewCandidate[];
  eligibleParagraphCount: number;
  highRiskCandidateCount: number;
  skippedReviewedCount: number;
};

const LATIN_LETTER_PATTERN = /[A-Za-z]/g;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const SOURCE_WORD_PATTERN = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
const DIGIT_PATTERN = /\d/g;
const NUMBER_HINT_PATTERN = /[零一二三四五六七八九十百千万两\d]/;
const QUESTION_PATTERN = /[?？]/;
const QUOTE_PATTERN = /["“”„‟'‘’]/;

function normalizeComparableText(text: string) {
  return text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function getMatchCount(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function buildCandidate(
  paragraph: BookRecord["paragraphs"][number],
): TranslationReviewCandidate | null {
  const sourceText = paragraph.sourceText.trim();
  const translatedText = paragraph.translatedText?.trim() ?? "";

  if (
    !sourceText ||
    !translatedText ||
    paragraph.translationStatus !== "done" ||
    paragraph.reviewStatus === "reviewed"
  ) {
    return null;
  }

  const sourceWordCount = getMatchCount(sourceText, SOURCE_WORD_PATTERN);
  const translatedEnglishWordCount = getMatchCount(
    translatedText,
    ENGLISH_WORD_PATTERN,
  );
  const translatedLatinLetterCount = getMatchCount(
    translatedText,
    LATIN_LETTER_PATTERN,
  );
  const translatedLength = translatedText.replace(/\s+/g, "").length;
  const translatedLatinRatio =
    translatedLength > 0 ? translatedLatinLetterCount / translatedLength : 0;
  const reasons: TranslationReviewReason[] = [];

  const normalizedSource = normalizeComparableText(sourceText);
  const normalizedTarget = normalizeComparableText(translatedText);

  if (paragraph.reviewStatus === "needs-revision") {
    reasons.push({
      code: "needs-revision",
      label: "人工标记待修订",
      weight: 120,
    });
  }

  if (
    normalizedSource.length > 0 &&
    normalizedTarget.length > 0 &&
    normalizedSource === normalizedTarget
  ) {
    reasons.push({
      code: "copied-source",
      label: "译文几乎等于原文",
      weight: 100,
    });
  }

  if (translatedLatinRatio >= 0.28) {
    reasons.push({
      code: "english-leak",
      label: "译文里残留英文过多",
      weight: 58,
    });
  } else if (translatedEnglishWordCount >= 4) {
    reasons.push({
      code: "english-phrases",
      label: "译文里出现多处英文词组",
      weight: 34,
    });
  }

  if (
    sourceWordCount >= 40 &&
    translatedLength < Math.max(Math.round(sourceWordCount * 0.42), 18)
  ) {
    reasons.push({
      code: "too-short",
      label: "长段译文偏短",
      weight: 42,
    });
  }

  if (
    getMatchCount(sourceText, QUOTE_PATTERN) >= 2 &&
    getMatchCount(translatedText, QUOTE_PATTERN) === 0
  ) {
    reasons.push({
      code: "dialogue-mismatch",
      label: "疑似对话格式丢失",
      weight: 18,
    });
  }

  if (
    getMatchCount(sourceText, DIGIT_PATTERN) > 0 &&
    !NUMBER_HINT_PATTERN.test(translatedText)
  ) {
    reasons.push({
      code: "number-mismatch",
      label: "数字信息可能遗漏",
      weight: 16,
    });
  }

  if (QUESTION_PATTERN.test(sourceText) && !QUESTION_PATTERN.test(translatedText)) {
    reasons.push({
      code: "question-mismatch",
      label: "问句语气可能丢失",
      weight: 12,
    });
  }

  if (sourceWordCount >= 120) {
    reasons.push({
      code: "long-paragraph",
      label: "超长段落值得抽检",
      weight: 10,
    });
  }

  const score = reasons.reduce((sum, reason) => sum + reason.weight, 0);

  return {
    paragraphIndex: paragraph.index,
    sampleKind: "high-risk",
    score,
    sourceText,
    translatedText,
    reasons: reasons.sort((left, right) => right.weight - left.weight).slice(0, 3),
  };
}

function pickCoverageCandidates(
  candidates: TranslationReviewCandidate[],
  selectedIndexes: Set<number>,
  count: number,
) {
  if (count <= 0 || candidates.length === 0) {
    return [] as TranslationReviewCandidate[];
  }

  const availableCandidates = candidates.filter(
    (candidate) => !selectedIndexes.has(candidate.paragraphIndex),
  );

  if (availableCandidates.length === 0) {
    return [] as TranslationReviewCandidate[];
  }

  const pickedCandidates: TranslationReviewCandidate[] = [];
  const pickedIndexes = new Set<number>();

  for (let step = 0; step < count; step += 1) {
    const fraction = count === 1 ? 0.5 : step / (count - 1);
    const targetIndex = Math.round((availableCandidates.length - 1) * fraction);
    const candidate = availableCandidates[targetIndex];

    if (!candidate || pickedIndexes.has(candidate.paragraphIndex)) {
      continue;
    }

    pickedIndexes.add(candidate.paragraphIndex);
    pickedCandidates.push({
      ...candidate,
      reasons:
        candidate.reasons.length > 0
          ? candidate.reasons
          : [
              {
                code: "long-paragraph",
                label: "覆盖性抽样",
                weight: 0,
              },
            ],
      sampleKind: "coverage",
    });
  }

  return pickedCandidates;
}

export function buildTranslationReviewSample(
  book: BookRecord,
  options?: {
    coverageCount?: number;
    limit?: number;
  },
): TranslationReviewSample {
  const limit = Math.max(options?.limit ?? 6, 1);
  const coverageCount = Math.max(Math.min(options?.coverageCount ?? 2, limit), 0);

  const analyzedCandidates = book.paragraphs
    .map((paragraph) => buildCandidate(paragraph))
    .filter((candidate): candidate is TranslationReviewCandidate => candidate !== null);

  const highRiskCandidates = analyzedCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.paragraphIndex - right.paragraphIndex;
    });

  const selectedHighRiskCandidates = highRiskCandidates.slice(0, limit - coverageCount);
  const selectedIndexes = new Set(
    selectedHighRiskCandidates.map((candidate) => candidate.paragraphIndex),
  );
  const sortedByParagraphCandidates = analyzedCandidates.sort(
    (left, right) => left.paragraphIndex - right.paragraphIndex,
  );
  const coverageCandidates = pickCoverageCandidates(
    sortedByParagraphCandidates,
    selectedIndexes,
    coverageCount,
  );

  return {
    candidates: [...selectedHighRiskCandidates, ...coverageCandidates].sort((left, right) => {
      if (left.sampleKind !== right.sampleKind) {
        return left.sampleKind === "high-risk" ? -1 : 1;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.paragraphIndex - right.paragraphIndex;
    }),
    eligibleParagraphCount: analyzedCandidates.length,
    highRiskCandidateCount: highRiskCandidates.length,
    skippedReviewedCount: book.paragraphs.filter(
      (paragraph) =>
        paragraph.translationStatus === "done" && paragraph.reviewStatus === "reviewed",
    ).length,
  };
}
