import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

const sampleBookPath = path.join(
  process.cwd(),
  "tests/e2e/fixtures/sample-book.txt",
);

const mockSettings = {
  providerLabel: "Playwright Mock",
  baseUrl: "http://127.0.0.1:8787/v1",
  model: "mock-literary-model",
  apiKey: "playwright-mock-api-key-12345",
};

const bookmarkNote =
  "这里的冬天气味和角色语气需要在后续复查时重点确认。";
const epubBookmarkNote = "Lantern Street 的回信伏笔要回头检查。";

async function createSampleEpub(testInfo: TestInfo) {
  const epubPath = testInfo.outputPath("playwright-sample.epub");
  const archive = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:playwright-epub-sample</dc:identifier>
    <dc:title>Playwright EPUB Sample</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter-1" />
    <itemref idref="chapter-2" />
  </spine>
</package>`),
    "OEBPS/text/chapter-1.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Opening Scene</title>
  </head>
  <body>
    <h1>Opening Scene</h1>
    <p>The clock in the hall struck six before anyone spoke.</p>
    <p>Outside the windows, winter fog pressed against the glass.</p>
  </body>
</html>`),
    "OEBPS/text/chapter-2.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Lantern Street</title>
  </head>
  <body>
    <h1>Lantern Street</h1>
    <p>Mira kept walking until the bakery lights came into view, the letter still warm in her pocket.</p>
    <p>She promised herself the letter would be delivered before dawn.</p>
  </body>
</html>`),
  });

  await fs.writeFile(epubPath, archive);

  return epubPath;
}

function buildMockTranslation(source: string) {
  return `【测试译文】${source
    .replace(/\bChapter\b/gi, "章节")
    .replace(/\bwinter\b/gi, "冬天")
    .replace(/\bHello\b/gi, "你好")
    .replace(/\bhouse\b/gi, "房子")}`;
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const filePath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(name, {
    path: filePath,
    contentType: "image/png",
  });
}

async function configureSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /先把翻译引擎/ })).toBeVisible();

  await page.getByLabel("服务商标签").fill(mockSettings.providerLabel);
  await page.getByLabel("模型名称").fill(mockSettings.model);
  await page.getByLabel("Base URL").fill(mockSettings.baseUrl);
  await page.locator("#apiKey").fill(mockSettings.apiKey);
  await page.getByRole("button", { name: "保存到本地" }).click();

  await expect(page.getByText("配置已保存到当前浏览器。")).toBeVisible();
  await expect(page.getByText("已完成基础配置")).toBeVisible();
}

async function installMockTranslationRoute(page: Page) {
  await page.route("http://127.0.0.1:8787/v1/chat/completions", async (route) => {
    const payload = route.request().postDataJSON() as {
      messages?: Array<{
        content?: string;
        role?: string;
      }>;
    };

    const userMessage = payload.messages?.find((message) => message.role === "user")
      ?.content;
    const match =
      typeof userMessage === "string"
        ? userMessage.match(/Current English paragraph:\n([\s\S]*?)\n\nTask:/)
        : null;
    const sourceText = match?.[1]?.trim() ?? "";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: buildMockTranslation(sourceText),
            },
          },
        ],
      }),
    });
  });
}

async function importSampleBook(
  page: Page,
  title: string,
  options?: {
    screenshotName?: string;
    testInfo?: TestInfo;
  },
) {
  await page.goto("/library");
  await page.getByLabel("导入英文原著文件").setInputFiles(sampleBookPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();

  await page.getByLabel("Book Title").fill(title);

  if (options?.testInfo && options.screenshotName) {
    await attachScreenshot(page, options.testInfo, options.screenshotName);
  }

  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(page.getByText(`已把《${title}》保存到本地书库`)).toBeVisible();
}

async function translateCurrentBook(
  page: Page,
  options?: {
    screenshotName?: string;
    testInfo?: TestInfo;
  },
) {
  await page
    .getByRole("button", {
      name: /开始批量翻译|继续翻译剩余段落|从阅读位置继续翻译/,
    })
    .click();

  await expect(page.getByText(/翻译完成：/)).toBeVisible();
  await expect(page.getByText("【测试译文】", { exact: false }).first()).toBeVisible();

  if (options?.testInfo && options.screenshotName) {
    await attachScreenshot(page, options.testInfo, options.screenshotName);
  }
}

test("core pages render without overflow on current viewport", async ({
  page,
}, testInfo) => {
  const routes = [
    {
      heading: /别让糟糕的翻译/,
      path: "/",
    },
    {
      heading: /先把翻译引擎/,
      path: "/settings",
    },
    {
      heading: /把书放进来/,
      path: "/library",
    },
    {
      heading: /终于可以把原文和译文/,
      path: "/reader",
    },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 4,
    );

    expect(hasOverflow).toBe(false);
    await attachScreenshot(
      page,
      testInfo,
      `${testInfo.project.name}-${route.path === "/" ? "home" : route.path.slice(1)}`,
    );
  }
});

test("settings persist after reload", async ({ page }, testInfo) => {
  await configureSettings(page);
  await attachScreenshot(page, testInfo, `${testInfo.project.name}-settings-saved`);

  await page.reload();

  await expect(page.getByLabel("服务商标签")).toHaveValue(
    mockSettings.providerLabel,
  );
  await expect(page.getByLabel("模型名称")).toHaveValue(mockSettings.model);
  await expect(page.getByLabel("Base URL")).toHaveValue(mockSettings.baseUrl);
  await expect(page.locator("#apiKey")).toHaveValue(mockSettings.apiKey);
});

test("desktop EPUB import reads metadata and preserves chapter structure", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The EPUB import workflow is covered on desktop to keep CI runtime focused.",
  );

  const epubPath = await createSampleEpub(testInfo);

  await page.goto("/library");
  await page.getByLabel("导入英文原著文件").setInputFiles(epubPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();

  await expect(page.getByLabel("Book Title")).toHaveValue("Playwright EPUB Sample");
  await expect(
    page.getByText(/已解析《Playwright EPUB Sample》，共 6 段。请先检查标题和切段结果，再保存到书库。/),
  ).toBeVisible();

  const chapterCountCard = page.getByText("章节数").locator("..");
  await expect(chapterCountCard.getByText("2", { exact: true })).toBeVisible();

  await expect(page.getByText("Opening Scene").first()).toBeVisible();
  await expect(
    page.getByText("The clock in the hall struck six before anyone spoke."),
  ).toBeVisible();
  await attachScreenshot(page, testInfo, "desktop-epub-import-draft");

  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(page.getByText("已把《Playwright EPUB Sample》保存到本地书库")).toBeVisible();
  await expect(page.getByText("Playwright EPUB Sample").first()).toBeVisible();

  await page
    .getByRole("button", { name: "删除 Playwright EPUB Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("EPUB reader section navigation keeps chapter-focused browsing", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The chapter navigation workflow is covered on desktop to keep CI runtime focused.",
  );

  const epubPath = await createSampleEpub(testInfo);

  await page.goto("/library");
  await page.getByLabel("导入英文原著文件").setInputFiles(epubPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();
  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(page.getByText("已把《Playwright EPUB Sample》保存到本地书库")).toBeVisible();

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);
  await expect(page.getByText(/当前读到第 1 段 · 当前章节「Opening Scene」/)).toBeVisible();
  await expect(page.getByText(/当前章节：Opening Scene · 共 2 节/)).toBeVisible();

  await page.getByRole("button", { name: "只看当前章节" }).click();
  await expect(page.getByText("已切到当前章节「Opening Scene」范围。")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");

  await page.getByRole("button", { name: /Lantern Street/ }).click();
  await expect(page.getByText("已切到章节「Lantern Street」，并聚焦本章内容。")).toBeVisible();
  await expect(page.getByText(/当前读到第 4 段 · 当前章节「Lantern Street」/)).toBeVisible();
  await expect(page.getByText("Lantern Street").first()).toBeVisible();
  await expect(
    page.getByText(
      "Mira kept walking until the bakery lights came into view, the letter still warm in her pocket.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("The clock in the hall struck six before anyone spoke."),
  ).not.toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("4");
  await attachScreenshot(page, testInfo, "desktop-epub-reader-section-scope");

  await page.reload();

  await expect(page.getByText(/当前读到第 4 段 · 当前章节「Lantern Street」/)).toBeVisible();
  await expect(
    page.getByText(
      "Mira kept walking until the bakery lights came into view, the letter still warm in her pocket.",
    ),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Playwright EPUB Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("EPUB chapter-scoped search links reopen the same filtered reading state", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The chapter-scoped search flow is covered on desktop to keep CI runtime focused.",
  );

  const epubPath = await createSampleEpub(testInfo);

  await page.goto("/library");
  await page.getByLabel("导入英文原著文件").setInputFiles(epubPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();
  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(page.getByText("已把《Playwright EPUB Sample》保存到本地书库")).toBeVisible();

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);

  await page.getByRole("button", { name: /Lantern Street/ }).click();
  await expect(page.getByText("已切到章节「Lantern Street」，并聚焦本章内容。")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("4");

  await page.getByLabel("站内搜索").fill("letter");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText("已更新搜索链接，当前命中 2 段。")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("letter");

  await page.getByRole("button", { name: "搜索命中 (2)" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("filter"))
    .toBe("search-results");
  await expect(page.getByText("当前读到第 5 段")).toBeVisible();

  await page.getByRole("button", { name: "下一处命中" }).click();
  await expect(page.getByText("当前读到第 6 段")).toBeVisible();
  await expect(
    page.getByText(
      "She promised herself the letter would be delivered before dawn.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("The clock in the hall struck six before anyone spoke."),
  ).not.toBeVisible();

  await page.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new URL(page.url()).origin },
  );
  await page.getByRole("button", { name: "复制当前位置链接" }).click();
  await expect(page.getByText("已复制第 6 段的阅读链接。")).toBeVisible();

  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  const parsedUrl = new URL(sharedUrl);

  expect(parsedUrl.searchParams.get("q")).toBe("letter");
  expect(parsedUrl.searchParams.get("filter")).toBe("search-results");
  expect(parsedUrl.searchParams.get("scope")).toBe("section");
  expect(parsedUrl.searchParams.get("p")).toBe("6");
  expect(parsedUrl.searchParams.get("book")).toBeTruthy();

  const sharedPage = await page.context().newPage();
  await sharedPage.goto(sharedUrl);
  await expect(sharedPage).toHaveURL(/\/reader/);
  await expect(sharedPage.getByLabel("站内搜索")).toHaveValue("letter");
  await expect(sharedPage.getByText(/当前读到第 6 段 · 当前章节「Lantern Street」/)).toBeVisible();
  await expect(sharedPage.getByText("搜索命中 (2)")).toBeVisible();
  await expect(
    sharedPage.getByText(
      "She promised herself the letter would be delivered before dawn.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    sharedPage.getByText("The clock in the hall struck six before anyone spoke."),
  ).not.toBeVisible();
  await expect
    .poll(() => new URL(sharedPage.url()).searchParams.get("filter"))
    .toBe("search-results");
  await expect
    .poll(() => new URL(sharedPage.url()).searchParams.get("scope"))
    .toBe("section");
  await attachScreenshot(sharedPage, testInfo, "desktop-epub-reader-shared-search-scope");
  await sharedPage.close();

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Playwright EPUB Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("EPUB chapter notes create bookmarks and survive reload", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The chapter note workflow is covered on desktop to keep CI runtime focused.",
  );

  const epubPath = await createSampleEpub(testInfo);

  await page.goto("/library");
  await page.getByLabel("导入英文原著文件").setInputFiles(epubPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();
  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(page.getByText("已把《Playwright EPUB Sample》保存到本地书库")).toBeVisible();

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);

  await page.getByRole("button", { name: /Lantern Street/ }).click();
  await expect(page.getByText("已切到章节「Lantern Street」，并聚焦本章内容。")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");

  await page.getByLabel("跳转到指定段落").fill("6");
  await page.getByRole("button", { name: "跳转到该段" }).click();
  await expect(page.getByText(/当前读到第 6 段 · 当前章节「Lantern Street」/)).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("6");

  await page.getByLabel("当前段落批注").fill(epubBookmarkNote);
  await page.getByRole("button", { name: "保存批注" }).click();
  await expect(page.getByText("已保存第 6 段批注。")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消当前书签" })).toBeVisible();
  await expect(page.getByText(epubBookmarkNote)).toBeVisible();
  await expect(page.getByText("Paragraph 6").last()).toBeVisible();
  await attachScreenshot(page, testInfo, "desktop-epub-bookmark-note-saved");

  await page.reload();

  await expect(page.getByText(/当前读到第 6 段 · 当前章节「Lantern Street」/)).toBeVisible();
  await expect(page.getByRole("button", { name: "取消当前书签" })).toBeVisible();
  await expect(page.getByLabel("当前段落批注")).toHaveValue(epubBookmarkNote);
  await expect(page.getByText(epubBookmarkNote)).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("scope"))
    .toBe("section");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("6");

  await page.getByRole("button", { name: "跳转" }).click();
  await expect(page.getByText(/当前读到第 6 段 · 当前章节「Lantern Street」/)).toBeVisible();

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Playwright EPUB Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("desktop workflow covers import, translation, notes, review checklist, and backup restore", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The full workflow is covered on desktop; mobile smoke coverage runs separately.",
  );
  test.setTimeout(120_000);

  page.on("dialog", (dialog) => void dialog.accept());

  await installMockTranslationRoute(page);
  await configureSettings(page);
  await importSampleBook(page, "Playwright Sample Book", {
    screenshotName: "desktop-import-draft",
    testInfo,
  });

  const [backupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出整书 JSON" }).click(),
  ]);
  const backupPath = testInfo.outputPath("book-backup.json");
  await backupDownload.saveAs(backupPath);

  const backupPayload = JSON.parse(await fs.readFile(backupPath, "utf8")) as {
    book?: {
      title?: string;
    };
    type?: string;
  };
  expect(backupPayload.type).toBe("rebabel-book");
  expect(backupPayload.book?.title).toBe("Playwright Sample Book");

  await translateCurrentBook(page, {
    screenshotName: "desktop-library-translated",
    testInfo,
  });

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);
  await expect(page.getByText("Playwright Sample Book").first()).toBeVisible();
  await expect(page.getByText("【测试译文】", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "收藏当前段落" }).click();
  await expect(page.getByRole("button", { name: "取消当前书签" })).toBeVisible();

  await page.getByLabel("当前段落批注").fill(bookmarkNote);
  await page.getByRole("button", { name: "保存批注" }).click();
  await expect(page.getByText(bookmarkNote).nth(1)).toBeVisible();

  const [notesDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出笔记" }).click(),
  ]);
  const notesPath = testInfo.outputPath("reading-notes.json");
  await notesDownload.saveAs(notesPath);

  await page.getByRole("button", { name: "取消当前书签" }).click();
  await expect(page.getByRole("button", { name: "收藏当前段落" })).toBeVisible();

  await page.getByLabel("导入阅读笔记 JSON").setInputFiles(notesPath);
  await expect(page.getByText(/已导入 1 条阅读笔记/)).toBeVisible();
  await expect(page.getByText(bookmarkNote).nth(1)).toBeVisible();

  await page.getByLabel("站内搜索").fill("冬天");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText(/已更新搜索链接，当前命中 \d+ 段。/)).toBeVisible();
  await expect(page.getByText("中文命中").first()).toBeVisible();

  await page
    .locator("button:enabled")
    .filter({ hasText: /^标记已复核$/ })
    .first()
    .click();
  await expect(page.getByText(/已将第 \d+ 段标记为已复核。/)).toBeVisible();

  const [checklistDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出当前清单 JSON" }).click(),
  ]);
  const checklistPath = testInfo.outputPath("review-checklist.json");
  await checklistDownload.saveAs(checklistPath);

  await page.getByRole("button", { name: /全部标记待修订/ }).click();
  await expect(
    page.getByText(/已将当前结果中的 \d+ 段已译内容标记为待修订/),
  ).toBeVisible();

  await page.getByLabel("导入复查清单 JSON").setInputFiles(checklistPath);
  await expect(page.getByText(/导入预览 ·/)).toBeVisible();
  await page.getByRole("button", { name: "确认导入到当前书" }).click();
  await expect(page.getByText(/已导入复查清单/)).toBeVisible();
  await attachScreenshot(page, testInfo, "desktop-reader-review-imported");

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);

  await page
    .getByRole("button", { name: "删除 Playwright Sample Book" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();

  await page.getByLabel("导入整书备份 JSON").setInputFiles(backupPath);
  await expect(page.getByText(/已导入《Playwright Sample Book》/)).toBeVisible();
  await expect(page.getByText("Playwright Sample Book").first()).toBeVisible();
});

test("reader keeps search filter and deep link after reload", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The deep-link workflow is covered on desktop to keep CI runtime controlled.",
  );
  test.setTimeout(120_000);

  await installMockTranslationRoute(page);
  await configureSettings(page);
  await importSampleBook(page, "Reader Deep Link Sample", {
    testInfo,
    screenshotName: "desktop-reader-deep-link-import",
  });
  await translateCurrentBook(page);

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);

  await page.getByLabel("站内搜索").fill("冬天");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText(/已更新搜索链接，当前命中 2 段。/)).toBeVisible();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("冬天");

  await page.getByRole("button", { name: /搜索命中 \(\d+\)/ }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("filter"))
    .toBe("search-results");
  await expect(page.getByText("当前读到第 2 段")).toBeVisible();

  await page.getByRole("button", { name: "下一处命中" }).click();
  await expect(page.getByText("当前读到第 5 段")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("5");

  await page.reload();

  await expect(page.getByLabel("站内搜索")).toHaveValue("冬天");
  await expect(page.getByText("当前读到第 5 段")).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("冬天");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("filter"))
    .toBe("search-results");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("p"))
    .toBe("5");
  await attachScreenshot(page, testInfo, "desktop-reader-deep-link-restored");

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Reader Deep Link Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("copied reader link reopens the same book state", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "The share-link flow is validated on desktop to keep runtime focused.",
  );
  test.setTimeout(120_000);

  await installMockTranslationRoute(page);
  await configureSettings(page);
  await importSampleBook(page, "Copied Link Sample");
  await translateCurrentBook(page);

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);

  await page.getByLabel("站内搜索").fill("冬天");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText(/已更新搜索链接，当前命中 2 段。/)).toBeVisible();
  await page.getByRole("button", { name: /搜索命中 \(\d+\)/ }).click();
  await page.getByRole("button", { name: "下一处命中" }).click();
  await expect(page.getByText("当前读到第 5 段")).toBeVisible();

  await page.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new URL(page.url()).origin },
  );
  await page.getByRole("button", { name: "复制当前位置链接" }).click();
  await expect(page.getByText("已复制第 5 段的阅读链接。")).toBeVisible();

  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  const parsedUrl = new URL(sharedUrl);

  expect(parsedUrl.pathname).toContain("/reader");
  expect(parsedUrl.searchParams.get("q")).toBe("冬天");
  expect(parsedUrl.searchParams.get("filter")).toBe("search-results");
  expect(parsedUrl.searchParams.get("p")).toBe("5");
  expect(parsedUrl.searchParams.get("book")).toBeTruthy();

  const sharedPage = await page.context().newPage();
  await sharedPage.goto(sharedUrl);
  await expect(sharedPage).toHaveURL(/\/reader/);
  await expect(sharedPage.getByText("Copied Link Sample").first()).toBeVisible();
  await expect(sharedPage.getByLabel("站内搜索")).toHaveValue("冬天");
  await expect(sharedPage.getByText("当前读到第 5 段")).toBeVisible();
  await expect
    .poll(() => new URL(sharedPage.url()).searchParams.get("filter"))
    .toBe("search-results");
  await attachScreenshot(sharedPage, testInfo, "desktop-reader-copied-link-opened");
  await sharedPage.close();

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Copied Link Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});

test("mobile workflow supports import, translation, and reader navigation", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes("mobile"),
    "This workflow targets the mobile viewport specifically.",
  );
  test.setTimeout(120_000);

  await installMockTranslationRoute(page);
  await configureSettings(page);
  await importSampleBook(page, "Mobile Workflow Sample", {
    testInfo,
    screenshotName: "mobile-import-draft",
  });

  await translateCurrentBook(page, {
    testInfo,
    screenshotName: "mobile-library-translated",
  });

  const hasLibraryOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 4,
  );
  expect(hasLibraryOverflow).toBe(false);

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);
  await expect(page.getByText("Mobile Workflow Sample").first()).toBeVisible();
  await expect(page.getByText("【测试译文】", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "跳到末尾" }).click();
  await expect(page.getByText("当前读到第 6 段")).toBeVisible();

  await page.getByLabel("站内搜索").fill("winter");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText(/已更新搜索链接，当前命中 2 段。/)).toBeVisible();

  await page.getByRole("button", { name: /搜索命中 \(\d+\)/ }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("filter"))
    .toBe("search-results");

  await page.getByRole("button", { name: "下一处命中" }).click();
  await expect(page.getByText(/当前读到第 [25] 段/)).toBeVisible();
  await attachScreenshot(page, testInfo, "mobile-reader-search-results");

  const hasReaderOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 4,
  );
  expect(hasReaderOverflow).toBe(false);

  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await page
    .getByRole("button", { name: "删除 Mobile Workflow Sample" })
    .click();
  await expect(page.getByText("书籍已从当前浏览器的本地书库删除。")).toBeVisible();
});
