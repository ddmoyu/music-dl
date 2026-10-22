# music-dl

面向 music-service 的音乐下载桌面工具。**当前仅保存可运行的交互原型，尚未开始正式前端实现；原型界面不代表最终产品效果。**

原型使用原生 HTML、CSS、JavaScript ES Modules，配合 Vite 开发与打包，Neutralinojs 封装桌面窗口。项目统一使用 pnpm，不使用 Vue 或 React。

## 项目结构

```text
music-dl/
├── prototype/              # 独立的原型区域，不是正式前端 src
│   ├── index.html          # Vite HTML 入口
│   ├── app/                # 原型页面、交互、模拟队列
│   ├── public/             # 图标、占位封面和素材来源
│   └── tests/              # 队列、DOM、交互和动效测试
├── docs/                   # 原型范围与后续实现边界
├── .github/workflows/      # 安装、格式、测试和构建检查
├── package.json
├── pnpm-lock.yaml
├── vite.config.js
└── neutralino.config.json
```

根目录目前没有正式应用的 `src/`。今后启动正式前端开发时，需单独确认产品设计、应用架构与后端契约；不能直接将此原型当成已确定的最终界面。

## 开发

使用 Node.js 24 和 pnpm 12.14.0（版本固定在 `packageManager`）。在仓库根目录执行：

```sh
pnpm install
pnpm dev
```

浏览器地址为 `http://127.0.0.1:5173/`。Vite 的根目录是 `prototype/`；构建输出到 `dist/prototype/`。

```sh
pnpm test          # 原型测试
pnpm build         # 构建原型静态资源
pnpm preview       # 预览构建结果
pnpm format        # 统一代码格式
pnpm check         # 格式检查、测试和构建
```

## 桌面原型

```sh
pnpm desktop:setup # 首次下载固定版本 Neutralinojs 运行时
pnpm desktop:dev   # 构建并打开桌面窗口
pnpm desktop:build # 生成便携包
```

Windows 程序位于 `release/shiyin/shiyin-win_x64.exe`，需保留同目录的 `resources.neu`；完整便携包位于 `release/shiyin-release.zip`。运行时、依赖、构建结果与用户存储不提交到 Git。

默认窗口为 820 × 820，可调整大小，最小 720 × 640。Windows 使用 WebView2；macOS / Linux 的运行时也可由 Neutralino CLI 生成，但尚未在对应系统验证。

## 原型范围

- 打开即搜索，支持单曲、歌单、专辑三种本地示例搜索与来源筛选。
- 支持单首、整组、勾选批量加入队列，保留并行、暂停、继续、移除和失败重试交互。
- 设置包括默认音质、1–8 并行、目录、去重、整理方式、元数据与歌词选项。
- 原有轻量试听入口与克制动效均保留；没有发现、收藏或独立播放界面。
- 浏览器使用 localStorage，桌面使用 Neutralino.storage；不提交实际用户的设置与历史。

**搜索数据和下载进度均为本地模拟，尚未接入 music-service，也不会写入音乐文件。** 当前示例歌曲没有试听音源。目录、元数据和歌词选项只保存配置，不执行文件处理。

原型范围与后续接入说明见 [docs/prototype.md](docs/prototype.md)。素材来源见 [prototype/public/images/SOURCES.md](prototype/public/images/SOURCES.md)，Lucide 图标授权见 [prototype/public/licenses/lucide.txt](prototype/public/licenses/lucide.txt)。
