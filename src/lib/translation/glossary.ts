import { ZodError, z } from "zod";
import type { GlossaryTerm } from "@/lib/translation/types";

const GLOSSARY_FILE_TYPE = "rebabel-glossary";
const GLOSSARY_FILE_VERSION = 1;

const glossaryImportTermSchema = z.object({
  note: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
});

const glossaryFileSchema = z.object({
  exportedAt: z.string().optional(),
  terms: z.array(glossaryImportTermSchema),
  type: z.literal(GLOSSARY_FILE_TYPE),
  version: z.literal(GLOSSARY_FILE_VERSION),
});

const glossaryTermArraySchema = z.array(glossaryImportTermSchema);

function normalizeGlossaryText(value: string | undefined) {
  return value?.trim() ?? "";
}

export function createGlossaryTermId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `glossary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGlossaryTerm(): GlossaryTerm {
  return {
    id: createGlossaryTermId(),
    note: "",
    source: "",
    target: "",
  };
}

export function normalizeGlossaryTerms(
  glossaryTerms: Array<Partial<Pick<GlossaryTerm, "note" | "source" | "target">>>,
) {
  return glossaryTerms.map((term) => ({
    id: createGlossaryTermId(),
    note: normalizeGlossaryText(term.note),
    source: normalizeGlossaryText(term.source),
    target: normalizeGlossaryText(term.target),
  }));
}

export function getEffectiveGlossaryTerms(glossaryTerms: GlossaryTerm[]) {
  return glossaryTerms
    .map((term) => ({
      ...term,
      note: normalizeGlossaryText(term.note),
      source: normalizeGlossaryText(term.source),
      target: normalizeGlossaryText(term.target),
    }))
    .filter((term) => term.source && term.target);
}

export function buildGlossaryExport(glossaryTerms: GlossaryTerm[]) {
  return {
    exportedAt: new Date().toISOString(),
    terms: glossaryTerms.map((term) => ({
      note: normalizeGlossaryText(term.note),
      source: normalizeGlossaryText(term.source),
      target: normalizeGlossaryText(term.target),
    })),
    type: GLOSSARY_FILE_TYPE,
    version: GLOSSARY_FILE_VERSION,
  };
}

export function parseGlossaryImport(jsonText: string) {
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const parsedTerms = Array.isArray(raw)
      ? glossaryTermArraySchema.parse(raw)
      : glossaryFileSchema.parse(raw).terms;

    if (parsedTerms.length === 0) {
      throw new Error("术语表文件里没有任何条目。");
    }

    return normalizeGlossaryTerms(parsedTerms);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("术语表文件不是有效的 JSON。");
    }

    if (error instanceof ZodError) {
      throw new Error(
        "术语表格式不正确。请导入 ReBabel 导出的 JSON，或只包含 source、target、note 数组的 JSON。",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("读取术语表失败。");
  }
}
