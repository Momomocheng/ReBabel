import type { TranslationReviewStatus } from "@/lib/books/types";

export function normalizeTranslationReviewStatus(
  value: string | null | undefined,
): TranslationReviewStatus {
  switch (value) {
    case "reviewed":
    case "needs-revision":
      return value;
    default:
      return "unreviewed";
  }
}

export function getTranslationReviewStatusLabel(
  status: TranslationReviewStatus,
) {
  switch (status) {
    case "reviewed":
      return "已复核";
    case "needs-revision":
      return "待修订";
    default:
      return "待复查";
  }
}

export function getTranslationReviewStatusClassName(
  status: TranslationReviewStatus,
) {
  switch (status) {
    case "reviewed":
      return "bg-sky-100 text-sky-800";
    case "needs-revision":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-violet-100 text-violet-800";
  }
}
