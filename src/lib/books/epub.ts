import { strFromU8, unzipSync } from "fflate";
import {
  createBookParagraphs,
  deriveTitleFromFileName,
  splitPlainTextParagraphs,
} from "@/lib/books/parser";
import type { BookParagraph, BookSection } from "@/lib/books/types";

type ParsedEpubBook = {
  paragraphs: BookParagraph[];
  sections: BookSection[];
  title: string;
};

type ManifestItem = {
  href: string;
  id: string;
  mediaType: string;
  properties: string;
};

const PRIMARY_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre";
const FALLBACK_BLOCK_SELECTOR = "div, section, article";
const SUPPORTED_DOCUMENT_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "application/xml",
  "text/html",
  "text/xml",
]);

function normalizeArchivePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").split("#")[0].split("?")[0];
}

function resolveArchivePath(fromPath: string, relativePath: string) {
  const baseParts = normalizeArchivePath(fromPath).split("/");

  baseParts.pop();

  const resolvedParts = relativePath
    .split("/")
    .reduce<string[]>((parts, segment) => {
      if (!segment || segment === ".") {
        return parts;
      }

      if (segment === "..") {
        parts.pop();
        return parts;
      }

      parts.push(segment);
      return parts;
    }, [...baseParts]);

  return normalizeArchivePath(resolvedParts.join("/"));
}

function buildArchiveMap(archive: Record<string, Uint8Array>) {
  const archiveMap = new Map<string, Uint8Array>();

  for (const [path, content] of Object.entries(archive)) {
    const normalizedPath = normalizeArchivePath(path);

    archiveMap.set(normalizedPath, content);

    try {
      archiveMap.set(decodeURIComponent(normalizedPath), content);
    } catch {
      continue;
    }
  }

  return archiveMap;
}

function tryDecodeUriComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readArchiveText(archiveMap: Map<string, Uint8Array>, path: string) {
  const normalizedPath = normalizeArchivePath(path);
  const file =
    archiveMap.get(normalizedPath) ??
    archiveMap.get(tryDecodeUriComponent(normalizedPath)) ??
    archiveMap.get(encodeURI(normalizedPath));

  if (!file) {
    throw new Error(`EPUB 缺少必要文件：${normalizedPath}`);
  }

  return strFromU8(file);
}

function parseXmlDocument(text: string, label: string) {
  const document = new DOMParser().parseFromString(text, "application/xml");

  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${label} 解析失败。`);
  }

  return document;
}

function getElementsByLocalName(parent: Document | Element, localName: string) {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function getFirstElementByLocalName(parent: Document | Element, localName: string) {
  return getElementsByLocalName(parent, localName)[0] ?? null;
}

function normalizeBlockText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function deriveSectionTitleFromPath(path: string, fallbackIndex: number) {
  const fileName = tryDecodeUriComponent(normalizeArchivePath(path).split("/").pop() ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

  return fileName || `章节 ${fallbackIndex + 1}`;
}

function extractSectionContentFromDocument(
  htmlText: string,
  documentPath: string,
  fallbackIndex: number,
) {
  const document = new DOMParser().parseFromString(htmlText, "text/html");
  const body = document.body;

  if (!body) {
    return {
      paragraphs: [],
      title: deriveSectionTitleFromPath(documentPath, fallbackIndex),
    };
  }

  const primaryBlocks = Array.from(body.querySelectorAll(PRIMARY_BLOCK_SELECTOR)).filter(
    (element) => !element.querySelector(PRIMARY_BLOCK_SELECTOR),
  );
  const fallbackBlocks =
    primaryBlocks.length > 0
      ? []
      : Array.from(body.querySelectorAll(FALLBACK_BLOCK_SELECTOR)).filter(
          (element) => !element.querySelector(FALLBACK_BLOCK_SELECTOR),
        );
  const textBlocks = (primaryBlocks.length > 0 ? primaryBlocks : fallbackBlocks)
    .map((element) => normalizeBlockText(element.textContent ?? ""))
    .filter(Boolean);
  const title =
    Array.from(body.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .map((element) => normalizeBlockText(element.textContent ?? ""))
      .find(Boolean) || deriveSectionTitleFromPath(documentPath, fallbackIndex);

  if (textBlocks.length > 0) {
    return {
      paragraphs: textBlocks,
      title,
    };
  }

  const fallbackText = body.innerText || body.textContent || "";

  return {
    paragraphs: splitPlainTextParagraphs(fallbackText),
    title,
  };
}

function parseEpubPackageMetadata(opfDocument: Document, fallbackTitle: string) {
  const metadata = getFirstElementByLocalName(opfDocument, "metadata");
  const title =
    metadata &&
    getElementsByLocalName(metadata, "title")
      .map((element) => (element.textContent ?? "").trim())
      .find(Boolean);

  return title || fallbackTitle;
}

function isManifestItem(item: ManifestItem | undefined): item is ManifestItem {
  return Boolean(item);
}

function getSpineDocumentPaths(opfDocument: Document, rootFilePath: string) {
  const manifest = getFirstElementByLocalName(opfDocument, "manifest");
  const spine = getFirstElementByLocalName(opfDocument, "spine");

  if (!manifest || !spine) {
    throw new Error("EPUB 缺少 manifest 或 spine。");
  }

  const manifestItemEntries = getElementsByLocalName(manifest, "item")
    .map((item) => ({
      href: item.getAttribute("href")?.trim() ?? "",
      id: item.getAttribute("id")?.trim() ?? "",
      mediaType: item.getAttribute("media-type")?.trim() ?? "",
      properties: item.getAttribute("properties")?.trim() ?? "",
    }))
    .filter((item) => item.id && item.href)
    .map((item) => [item.id, item] as const);
  const manifestItemById = new Map(manifestItemEntries);

  return getElementsByLocalName(spine, "itemref")
    .map((itemRef) => manifestItemById.get(itemRef.getAttribute("idref")?.trim() ?? ""))
    .filter(isManifestItem)
    .filter((item) => {
      if (!SUPPORTED_DOCUMENT_MEDIA_TYPES.has(item.mediaType)) {
        return false;
      }

      return !item.properties.split(/\s+/).includes("nav");
    })
    .map((item) => resolveArchivePath(rootFilePath, item.href));
}

export async function parseEpubFile(file: File): Promise<ParsedEpubBook> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const archiveMap = buildArchiveMap(archive);
  const containerDocument = parseXmlDocument(
    readArchiveText(archiveMap, "META-INF/container.xml"),
    "container.xml",
  );
  const rootFilePath =
    getFirstElementByLocalName(containerDocument, "rootfile")
      ?.getAttribute("full-path")
      ?.trim() ?? "";

  if (!rootFilePath) {
    throw new Error("EPUB 缺少 OPF 根文件路径。");
  }

  const opfDocument = parseXmlDocument(
    readArchiveText(archiveMap, rootFilePath),
    "OPF package",
  );
  const sectionGroups = getSpineDocumentPaths(opfDocument, rootFilePath)
    .map((documentPath, index) =>
      extractSectionContentFromDocument(
        readArchiveText(archiveMap, documentPath),
        documentPath,
        index,
      ),
    )
    .filter((section) => section.paragraphs.length > 0);
  const sections: BookSection[] = [];
  const chapterParagraphs: string[] = [];
  let paragraphIndex = 0;

  sectionGroups.forEach((section, index) => {
    sections.push({
      id: `section-${index + 1}`,
      title: section.title,
      startParagraphIndex: paragraphIndex,
    });
    chapterParagraphs.push(...section.paragraphs);
    paragraphIndex += section.paragraphs.length;
  });
  const paragraphs = createBookParagraphs(chapterParagraphs);

  if (paragraphs.length === 0) {
    throw new Error("EPUB 内容为空，或者没有解析出可翻译段落。");
  }

  return {
    paragraphs,
    sections,
    title: parseEpubPackageMetadata(opfDocument, deriveTitleFromFileName(file.name)),
  };
}
