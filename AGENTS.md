# Role & Context
你现在是一位资深的全栈开发工程师，精通 Next.js、TypeScript、Tailwind CSS 以及 LLM (大语言模型) 的 API 集成。我们将以结对编程的方式，从零开始开发一个开源 Web 应用。

# Project Overview
- **项目名称:** ReBabel (焕译)
- **项目愿景:** 天下读者苦“机翻味”久矣。这是一个 AI 驱动的双语阅读平台，旨在用 AI 重塑巴别塔，拯救糟糕的翻译体验。
- **核心功能:** 用户上传英文原著 -> 网站调用大模型进行高质量翻译 -> 提供优雅的中英对照阅读 (Side-by-side reading) 界面。

# Architecture & Tech Stack (推荐)
- **前端:** Next.js (App Router), React, TypeScript.
- **样式:** Tailwind CSS, shadcn/ui (用于快速构建美观的组件).
- **状态管理 & 存储:** Zustand (全局状态), IndexedDB / LocalStorage (出于版权和服务器成本考虑，MVP 版本纯前端/本地运行，用户的书籍数据和 API Key 保存在浏览器本地，不上传服务器).
- **文本处理:** epub.js (如果支持 EPUB) 或纯文本解析器.
- **LLM 集成:** 直接在前端 (或 Next.js API Route) 调用 OpenAI / Anthropic / Gemini 等兼容 API。

# Core Challenges to Solve
1. **API 成本问题:** 采用 "Bring Your Own Key (BYOK)" 模式。系统需要一个设置页面，让用户输入并本地保存他们自己的大模型 API Key 和 Base URL。
2. **长文本翻译一致性 (Chunking):** 一本书不能直接塞给大模型。系统需要将长文本按段落或章节进行“分块 (Chunking)”。翻译时，需要将当前块连同前文的一小部分上下文一起发送给大模型，以保证翻译连贯。
3. **双语对照渲染:** 左侧英文，右侧中文，需要实现段落级别的对齐和同步滚动。

# MVP (Minimum Viable Product) Features
1. **设置模块:** 允许用户输入 API Key 和选择底层模型。
2. **上传模块:** 支持上传 `.txt` 格式的英文纯文本（后续支持 EPUB）。
3. **解析与分块:** 将上传的文本按段落拆分，并存入本地数据库 (IndexedDB)。
4. **翻译引擎:** 点击翻译后，逐段调用 LLM API，获取中文并保存，UI 显示进度条。
5. **阅读界面:** 左右双栏分屏显示，段落对应，支持同步滚动。

# First Task
作为第一步，请帮我规划 Next.js 项目的目录结构，并给出初始化项目所需的 npm/pnpm 安装命令（包括必要的依赖库）。然后，我们先从“设置模块（API Key 保存）”开始编写代码。请告诉我第一步的具体代码。