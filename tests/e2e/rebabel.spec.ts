import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

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
  await page.goto("/library");

  await page.getByLabel("导入英文原著文件").setInputFiles(sampleBookPath);
  await expect(page.getByRole("heading", { name: "导入预览与清洗" })).toBeVisible();

  await page.getByLabel("Book Title").fill("Playwright Sample Book");
  await attachScreenshot(page, testInfo, "desktop-import-draft");

  await page.getByRole("button", { name: "保存到本地书库" }).click();
  await expect(
    page.getByText("已把《Playwright Sample Book》保存到本地书库"),
  ).toBeVisible();

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

  await page
    .getByRole("button", {
      name: /开始批量翻译|继续翻译剩余段落|从阅读位置继续翻译/,
    })
    .click();

  await expect(page.getByText(/翻译完成/)).toBeVisible();
  await expect(page.getByText("【测试译文】", { exact: false }).first()).toBeVisible();
  await attachScreenshot(page, testInfo, "desktop-library-translated");

  await page.getByRole("link", { name: "进入阅读器" }).click();
  await expect(page).toHaveURL(/\/reader/);
  await expect(page.getByText("Playwright Sample Book").first()).toBeVisible();
  await expect(page.getByText("【测试译文】", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "收藏当前段落" }).click();
  await expect(page.getByText("已收藏第 1 段。")).toBeVisible();

  await page.getByLabel("当前段落批注").fill(bookmarkNote);
  await page.getByRole("button", { name: "保存批注" }).click();
  await expect(page.getByText("已保存第 1 段批注。")).toBeVisible();
  await expect(page.getByText(bookmarkNote)).toBeVisible();

  const [notesDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出笔记" }).click(),
  ]);
  const notesPath = testInfo.outputPath("reading-notes.json");
  await notesDownload.saveAs(notesPath);

  await page.getByRole("button", { name: "取消当前书签" }).click();
  await expect(page.getByText("已移除第 1 段书签。")).toBeVisible();

  await page.getByLabel("导入阅读笔记 JSON").setInputFiles(notesPath);
  await expect(page.getByText(/已导入 1 条阅读笔记/)).toBeVisible();
  await expect(page.getByText(bookmarkNote)).toBeVisible();

  await page.getByLabel("站内搜索").fill("冬天");
  await page.getByRole("button", { name: "更新搜索链接" }).click();
  await expect(page.getByText(/当前命中 \d+ 段/)).toBeVisible();
  await expect(page.getByText("中文命中")).toBeVisible();

  await page.getByRole("button", { name: "标记已复核" }).first().click();
  await expect(page.getByText("已将第 1 段标记为已复核。")).toBeVisible();

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
  await expect(page.getByText(/导入预览/)).toBeVisible();
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
