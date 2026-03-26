# ReBabel

别让糟糕的翻译，毁了一本好书。AI 赋能重译，沉浸式对照阅读。

Don't let a bad translation ruin a good book. Re-translate with AI. Read side-by-side.

## Local Development

```bash
pnpm install
pnpm dev
```

## GitHub Pages

ReBabel 现在按纯前端静态站点方式设计，适合部署到 GitHub Pages：

- 页面必须可以静态导出，不能依赖 Next.js 服务端运行时。
- 用户的 API Key、书籍内容和翻译结果都保存在浏览器本地。
- 当前已支持 `.txt` 与 `.epub` 导入，解析也在浏览器内完成。
- 如果后面接模型调用，优先走用户直连兼容 API，避免服务端中转依赖。

仓库已经包含 GitHub Pages 工作流，推送到 `main` 会自动构建并部署。

### Deploy Steps

1. 把仓库推到 GitHub，并确保默认分支是 `main`。
2. 打开仓库 `Settings -> Pages`。
3. 在 `Build and deployment` 里把 `Source` 设为 `GitHub Actions`。
4. 推送一次到 `main`，等待 `.github/workflows/deploy-pages.yml` 跑完。

如果第一次跑工作流时看到 `Get Pages site failed` / `HttpError: Not Found`，说明这个仓库还没有启用 Pages 站点。处理方式有两种：

- 最直接：按上面的步骤先去 `Settings -> Pages` 手动把 `Source` 设为 `GitHub Actions`，然后重新运行 workflow。
- 自动启用：在仓库里新增一个 `PAGES_ENABLEMENT_TOKEN` secret，值为一个拥有该仓库管理权限的 PAT。工作流会在首次部署时尝试自动启用 Pages。

### Base Path Rules

- 如果仓库名是普通项目仓库，例如 `ReBabel`，站点会自动部署到 `/<repo-name>`，也就是 `/ReBabel`。
- 如果仓库名是用户或组织主页仓库，例如 `<owner>.github.io`，站点会自动部署到根路径 `/`。

### Local Verification

本地想复现 GitHub Pages 构建，直接运行：

```bash
pnpm build:pages
```

默认会按当前仓库使用 `/ReBabel` 作为 `basePath`。如果你在 fork 或改了仓库名，可以临时覆盖：

```bash
NEXT_PUBLIC_BASE_PATH=/your-repo-name pnpm build:pages
```
