# 项目约定

- 正式桌面应用位于 `src/`，使用真实 music-service；不得引入演示数据、模拟进度或假成功回退。
- `prototype/` 只作设计参考，独立命令运行，不得从正式入口导入或打入发行包。
- 使用原生 HTML、CSS、JavaScript ES Modules、Vite 与 Neutralinojs，不引入 Vue、React 或其他 UI 框架。
- 包管理器统一使用 pnpm，遵循 `package.json` 的 `packageManager`，只维护 `pnpm-lock.yaml`。
- 保留紧凑下载工具定位、批量下载与轻量试听；界面不要加入原型辅助说明文字，限制与边界写在文档中。
- 修改后运行与改动相关的检查；提交前运行 `pnpm check`。
- 不提交依赖、构建产物、Neutralino 二进制、`.storage`、`.tmp`、用户历史、凭据或本机绝对路径。
- 桌面打包必须在独立的 `.desktop-build/` 工作目录执行，禁止直接在含开发数据的仓库根目录运行 `neu build`，该工具会整体归档并移除 `.tmp/`。
