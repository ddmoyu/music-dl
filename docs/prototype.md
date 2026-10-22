# 原型范围与实现边界

## 定位

本仓库当前阶段的交付物是交互原型，用来讨论下载工具的信息布局、操作流程和桌面体验。视觉、文案与技术实现都可以继续调整，不代表最终前端设计。

原型文件集中在 `prototype/`，正式应用的 `src/` 尚未建立。后续正式开发应另行确认范围与结构，不将模拟数据、定时器进度、原型布局直接当成生产实现。

## 原型代码

- `prototype/index.html` 是 Vite 入口。
- `prototype/app/main.js` 使用原生事件委托管理搜索、勾选、设置、试听入口和存储。
- `prototype/app/views.js` 负责 HTML 模板，动态文本统一转义。
- `prototype/app/dom.js` 更新变化节点，保留焦点、光标与列表滚动位置。
- `prototype/app/motion.js` 仅为导航切换触发轻微动效；常规进度刷新不重播，遵循系统减少动态效果偏好。
- `prototype/app/data.js` 是示例歌曲与集合数据。
- `prototype/app/queue.js` 是模拟并行队列，速度、进度、文件大小都不是服务端数据。
- `prototype/tests/` 覆盖队列上限、暂停/继续、去重、失败重试、设置快照、恢复、DOM 稳定性和交互动效。

## 桌面与存储

Neutralinojs 仅封装网页和提供目录选择、打开目录、系统音乐目录与本机存储等能力。保留存储键 `shiyin.*.v1` / `*_v1`，但 Git 仓库不包含任何实际本机数据。

预览页面与桌面封装使用同一份 Vite 构建。`dist/prototype/` 与 `release/` 分开，重新构建页面不会清理桌面数据。

## 后续接入

后端独立位于 [ddmoyu/music-service](https://github.com/ddmoyu/music-service)。接入时以其当前代码、实际注册路由及 [API 契约](https://github.com/ddmoyu/music-service/blob/main/docs/design/cpp20-refactor/backend-service/api-contract.md) 为准，不能仅依据原型推定服务具备某项能力。

正式实现需重新确认搜索与集合分页、音源能力、批次提交、幂等性、任务进度、错误处理、下载目标授权和本地文件处理。尤其不能把原型中的暂停按钮或本地目录路径直接当成后端的暂停能力与目标目录契约。

此原型从本地 music-service 工作区独立整理；整理时后端已拉取至提交 `6b1948dec51b7a761e0a817dba749b98ffe4207e`。这里只迁入原型文件，没有复制后端代码或 Git 历史。
