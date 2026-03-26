import { normalizeBaseUrl, type SettingsInput } from "@/lib/settings/schema";
import type { BookRecord } from "@/lib/books/types";
import { getEffectiveGlossaryTerms } from "@/lib/translation/glossary";
import type { GlossaryTerm } from "@/lib/translation/types";

type TranslationSettings = Pick<
  SettingsInput,
  "apiKey" | "baseUrl" | "model" | "providerLabel"
>;

type TranslateParagraphInput = {
  book: BookRecord;
  contextSize?: number;
  extraInstructions?: string;
  glossaryTerms?: GlossaryTerm[];
  index: number;
  revisionMode?: boolean;
  settings: TranslationSettings;
  signal?: AbortSignal;
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item === "object" &&
          item &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function buildContext(book: BookRecord, index: number, contextSize: number) {
  return book.paragraphs
    .slice(Math.max(0, index - contextSize), index)
    .map((paragraph) => {
      const translated = paragraph.translatedText
        ? `中文参考：${paragraph.translatedText}`
        : "中文参考：暂无";

      return [
        `上一段 #${paragraph.index + 1}`,
        `英文原文：${paragraph.sourceText}`,
        translated,
      ].join("\n");
    })
    .join("\n\n");
}

function buildGlossary(glossaryTerms?: GlossaryTerm[]) {
  const terms = glossaryTerms ? getEffectiveGlossaryTerms(glossaryTerms) : [];

  if (!terms.length) {
    return "";
  }

  return [
    "Glossary:",
    ...terms.map((term) =>
      `- ${term.source} => ${term.target}${term.note ? ` (${term.note})` : ""}`,
    ),
    "Apply these preferred mappings consistently when the English source terms appear.",
  ].join("\n");
}

async function getErrorMessage(response: Response) {
  const fallback = `请求失败，HTTP ${response.status}`;

  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };

    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function translateParagraph({
  book,
  contextSize = 2,
  extraInstructions,
  glossaryTerms,
  index,
  revisionMode = false,
  settings,
  signal,
}: TranslateParagraphInput) {
  const paragraph = book.paragraphs[index];

  if (!paragraph) {
    throw new Error("找不到要翻译的段落。");
  }

  const contextText = buildContext(book, index, contextSize);
  const currentDraft = paragraph.translatedText?.trim() || "";
  const glossaryText = buildGlossary(glossaryTerms);

  const response = await fetch(
    `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "You are a literary translator working from English to Simplified Chinese.",
              "Produce fluent, natural Chinese while preserving tone, pacing, imagery, dialogue voice, and implied meaning.",
              "Keep names, formatting, and paragraph boundaries stable.",
              "If glossary terms are provided, treat them as the preferred translations unless the source meaning clearly requires otherwise.",
              "If the user provides extra translation guidance, follow it when it does not conflict with fidelity and fluency.",
              "Return only the translated Chinese paragraph with no notes, labels, or explanations.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Book title: ${book.title}`,
              `Current paragraph: ${index + 1}/${book.paragraphs.length}`,
              settings.providerLabel
                ? `Provider label: ${settings.providerLabel}`
                : "",
              contextText
                ? `Previous context:\n${contextText}`
                : "Previous context: none",
              glossaryText,
              extraInstructions?.trim()
                ? `Extra guidance:\n${extraInstructions.trim()}`
                : "",
              revisionMode && currentDraft
                ? `Current Chinese draft to revise:\n${currentDraft}`
                : "",
              `Current English paragraph:\n${paragraph.sourceText}`,
              revisionMode && currentDraft
                ? "Task: revise the current Chinese draft so it reads better while remaining faithful to the English paragraph and previous context."
                : "Task: translate the English paragraph into natural Simplified Chinese.",
              "Output rule: return only the final Simplified Chinese paragraph.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      }),
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const translation = extractTextContent(payload.choices?.[0]?.message?.content);

  if (!translation) {
    throw new Error("模型返回为空，未拿到有效译文。");
  }

  return translation;
}
