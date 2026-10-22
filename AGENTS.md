# 项目约定

- 当前交付物是交互原型，不是正式前端或最终视觉方案。
- 原型放在 `prototype/`。除非用户明确要求启动正式前端开发，不要将原型迁到根目录 `src/`，也不要把模拟下载描述成真实后端能力。
- 使用原生 HTML、CSS、JavaScript ES Modules、Vite 与 Neutralinojs，不引入 Vue、React 或其他 UI 框架。
- 包管理器统一使用 pnpm，遵循 `package.json` 的 `packageManager`，只维护 `pnpm-lock.yaml`。
- 保留紧凑下载工具定位、批量下载与轻量试听；界面不要加入原型辅助说明文字，限制与边界写在文档中。
- 修改后运行与改动相关的检查；提交前运行 `pnpm check`。
- 不提交依赖、构建产物、Neutralino 二进制、`.storage`、`.tmp`、用户历史、凭据或本机绝对路径。
