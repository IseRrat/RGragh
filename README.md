# Inference Lineage

一张可编辑的大模型推理系统技术演进图与领域图，附个人论文库。代码和仓库中的数据快照采用 [MIT License](LICENSE)。

## 使用

- **演进图**：从顶部向下分叉阅读工作脉络。卡片显示工作名称、诞生时间和细分方向 tag；滚轮上下滚动，Ctrl＋滚轮缩放，拖动画布可平移。
- **领域图**：顶栏切换至领域图，中心为“大模型推理系统”，向外展示一级与二级研究方向。节点支持中英文名称、颜色、新增和删除；修改会同步到演进图的 tag 和侧栏筛选。
- **维护地图**：悬停节点，点击下方加号添加子节点；点击节点打开大窗口，编辑名称、时间和介绍，点击“查看”进入该工作的空白独立页面。点击卡片底部的 tag，可选择已有 tag、新增 tag 和设置字体颜色。删除含子节点的节点时，可选择保留子节点或连同子树删除。
- **检索**：搜索名称、时间、介绍和 tag。左侧栏可用顶部菜单按钮收起。
- **保存与备份**：运行 MySQL 服务端时，修改会自动同步到数据库；浏览器仍保留备份。右上角菜单可导出或导入 JSON。
- **研究方向**：树的父子边表示技术演进；节点 tag 表示主要优化对象，初始包含 8 个一级方向和 33 个二级分类，可在领域图编辑。同组 tag 共用颜色。地图左栏按一级方向筛选，筛选时保留祖先节点作为脉络。
- **个人论文库**：地图右上角进入全库；从节点的“查看”进入该节点关联的论文列表。直接上传 PDF 后，服务端提取文字并调用所选模型，自动识别论文、查重、填充论文库，并根据发展脉络关联现有节点或创建新节点。处理结果、理由、失败重试和撤销入图都显示在论文库左侧；无法可靠定位的论文仍会入库。PDF 保存在本机 `data/papers/`，可在阅读页打开。

首次打开是一张只有“LLM Infra”根节点的空地图。已有本地 MySQL 地图中的旧年份、简介和首个标签会迁入新字段。迁移前的旧数据快照已单独保存，方便回看。

## 本机 MySQL 运行

需要 Node.js 和正在运行的 MySQL 8。首次运行：

```powershell
npm ci
npm run start:local
```

程序会询问本机 MySQL 密码和模型 API Key，默认使用 `root@127.0.0.1:3306`，创建 `inference_lineage` 数据库、`map_documents` 与 `paper_imports` 表，然后在 `http://127.0.0.1:4173` 提供页面和 API。密码与 Key 只存在于当前服务器进程内，退出后再次启动需重新输入。若用户名或端口不同，启动前设置 `DB_USER` / `DB_PORT` 环境变量。没有 Key 时可按 Enter 跳过；首次上传 PDF 会弹出设置窗口，填入后自动继续上传。

仓库的 [`database/seed.sql`](database/seed.sql) 是公开的数据快照，包含地图、tag、论文库元数据和导入记录。要在**新建的空数据库**中恢复快照，先创建数据库，再导入 SQL，之后运行服务：

```text
mysql -u root -p
CREATE DATABASE inference_lineage CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inference_lineage;
SOURCE database/seed.sql;
EXIT;
```

随后运行 `npm run start:local`。数据库快照不包含 MySQL 用户、密码、模型 API Key 或 PDF 文件；PDF 需另行由版权许可允许的来源获取。

在论文库的“模型设置”中选择 DeepSeek（`deepseek-flash`）或 OpenAI（`gpt-4.1`）并输入对应的 Key。也可以在启动前设置 `AI_PROVIDER`、`AI_MODEL` 和 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 或 `AI_API_KEY`。上传的 PDF 留在本机，但提取出的论文文本会发送给所选模型服务处理。Key 不写入 MySQL，重启服务后需重新输入。PDF 限 40 MB，扫描版若无法提取文字会显示失败并允许重试。

`GET /api/map` 读取地图；`PUT /api/map` 保存地图及版本号。并发修改采用版本检测：发生冲突时停止覆盖，提示导出本地 JSON。

## 使用已有 MySQL 数据库

`npm start` 需要这些环境变量：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。默认启用 TLS 证书验证；自签名 CA 可用 `DB_CA_CERT` 传入 PEM 内容。只在本机使用时，可设 `DB_SSL=false`。不要把密码或证书提交到仓库。

服务器默认仅监听 `127.0.0.1`。对外开放时需设置 `HOST`、`APP_PASSWORD`（以及可选的 `APP_USER`，默认 `map`），并在前面配置 HTTPS 反向代理。浏览器通过同一服务地址访问页面和 API；单独部署 `dist/` 为静态网站时，只能使用浏览器本地存储，状态栏会明确显示“数据库未连接”。

## 文件

- `dist/index.html`：页面结构。
- `dist/styles.css`：响应式视觉样式。
- `dist/document-schema.js`：节点和 tag 数据校验、旧数据迁移。
- `dist/migrate.js`：旧地图中的问题节点兼容迁移。
- `dist/app.js`：树图、编辑、浏览器备份与 MySQL 同步。
- `dist/domain.html` / `dist/domain.js` / `dist/domain.css`：领域图及分类编辑。
- `database/seed.sql`：可导入 MySQL 8 的公开数据快照。
- `dist/work.html`：节点相关论文和个人论文库页面。
- `dist/work.js` / `dist/work.css`：论文列表、详情、阅读页、自动导入状态与本地 PDF 上传。
- `server/pdf-files.mjs`：本地 PDF 文件读写。
- `server/paper-analyzer.mjs`：PDF 文字提取与模型分析。
- `server/paper-import.mjs`：去重、谱系定位、入库与撤销入图。
- `server/index.mjs`：同源 HTTP API 和静态文件服务。
- `server/mysql-store.mjs`：MySQL 建表、读写与版本冲突检测。
- `server/document.mjs`：地图数据校验。
- `server/run-local.mjs`：本机连接并创建数据库的启动入口。

## 数据与隐私

本机 MySQL 数据不会自动同步到现有线上静态预览。要从其他设备访问同一份地图，需要部署 Node 服务，并使用可从该服务访问的 MySQL 实例。JSON 导出包含笔记内容，分享文件前请自行检查。

备份论文库时，除了导出的 JSON 或 MySQL 数据，也要复制 `data/papers/` 中的 PDF；JSON 不包含 PDF 文件本身。

`render.yaml` 提供免费 Node 服务的部署配置，但它不会自动创建云 MySQL。部署前需要先有可联网的 MySQL，并在部署平台的安全环境变量中填写连接信息；不要把本机 `127.0.0.1` 填成线上数据库地址。
