# 开发、打包与运行细节

项目概览、系统要求和下载入口见 [README](../README.md)。正式应用采用原生 HTML、CSS、JavaScript ES Modules、Vite 与 Neutralinojs；`prototype/` 是独立设计参考，不进入正式包。

## 开发和运行

使用 Node.js 24、pnpm 12.14.0、Neutralino 6.10.0 和 music-service 0.1.30（schema 8）。包管理器以 `package.json` 的 `packageManager` 为准，只维护 `pnpm-lock.yaml`。

```powershell
pnpm install
pnpm service:download
pnpm desktop:setup
pnpm desktop:dev
```

`service:download` 需要 GitHub CLI，下载当前系统/架构对应的已发布后端包，核对固定版本、源码提交、报告与资产 SHA256 后运行 `version`。下载结果位于 `bin/service/0.1.30/bundle/`。CI 使用自己的只读 GitHub token；不要把个人凭据写入仓库。

也可以自行构建后端：Windows 设置 `MUSIC_SERVICE_BINARY` 和 `MUSIC_SERVICE_LICENSES`；Linux/macOS 设置 `MUSIC_SERVICE_BUNDLE` 为完整安装目录，保留 `bin/`、`lib/` 和 `share/music-service/licenses/` 的相对布局。后端应包含所需 `MUSIC_SERVICE_PROVIDERS` 并支持 `--parent-pid`。

`pnpm dev` 在 <http://127.0.0.1:5175/> 启动正式前端，Vite 会启动真实开发服务。开发数据位于 `.tmp/development-service-<port>/`，与桌面用户数据隔离。开发端点仅接受同源请求，生产构建没有此端点；普通静态预览不能启动本机服务。

## 本机数据与兼容性

桌面服务配置、数据库与凭据位于系统应用数据目录下的 `shiyin/`，新配置默认下载至系统音乐目录下的 `曲袋/`，已有配置保留原下载目录。保留既有应用 ID 和偏好键以兼容 Windows 已有账号与任务。三个服务监听端口由系统分配，只绑定 loopback；访问令牌仅在前端内存持有，Cookie 由后端凭据存储管理。

schema 8 不自动迁移更早开发版本数据库。升级旧开发版本前，先关闭程序并备份配置、数据库、秘密和下载文件。旧格式不能直接使用时，应改用新的服务数据目录初始化；清理旧 `shiyin/service/` 和旧前端偏好会删除账号、Cookie 与任务记录，下载目录中的音乐文件独立保存。不要同时启动多个使用同一数据目录的桌面窗口。

已有 `service.json` 在启动时保持原样，当前端口、来源与数据目录写入 `launcher-config.json`。配置、偏好或待确认下载记录损坏时明确报错并保留原文件，不静默重置；修复文件或权限后重新连接。设置和隐藏记录在保存成功后生效。

Windows 单 EXE 先校验并释放内嵌服务，缓存位于 `shiyin/runtime/<SHA-256>/`，更新不覆盖正在运行的旧服务。Linux/macOS 从应用包内的 `service/` 启动，逐文件核对后端和运行库的大小与 SHA256，不向签名的应用目录写入用户数据。后端通过父进程监测在桌面退出后停机，下次启动恢复任务。

Linux/macOS 的 Neutralino 偏好和日志采用系统用户数据位置；Windows 延续已有偏好存储兼容逻辑。账号校验的短暂失败最多自动重试 5 次，间隔递增且不超过 30 秒，持续失败可手动重试；服务启动超时会清理本次启动的子进程，清理失败明确提示。

## 跨平台打包

```powershell
pnpm service:download
pnpm desktop:setup
pnpm desktop:build
```

`scripts/desktop-targets.js` 定义五个目标及其原生 runner：

| 目标                | runner           | 分发形式                                          |
| ------------------- | ---------------- | ------------------------------------------------- |
| Windows x64         | windows-2025     | 单 EXE、只含同一 EXE 的 ZIP                       |
| Linux x64           | ubuntu-24.04     | 带桌面运行时、resources.neu 和 service/ 的 tar.gz |
| Linux ARM64         | ubuntu-24.04-arm | 同上，使用 ARM64 二进制                           |
| macOS Intel         | macos-15-intel   | 带图标、Info.plist、服务与运行库的 .app ZIP       |
| macOS Apple Silicon | macos-15         | 同上，使用 ARM64 二进制                           |

打包在独立 `.desktop-build/` 目录完成，只复制正式构建、匹配目标的 Neutralino 二进制、经过校验的服务和第三方许可。**不要在仓库根目录直接运行 `neu build` 或 `neu update`**，它们会归档并清理 `.tmp/`。

Windows 保持 `--embed-resources` 单文件。Linux/macOS 使用独立的 `resources.neu` 与随包服务，macOS 保留后端 LLVM 运行库的原始相对布局，并为完整 `.app` 做 ad-hoc 签名；没有 Developer ID 签名或公证。macOS 最低 15；Linux 以 Ubuntu 24.04 为基线，需安装 WebKitGTK 4.1 和 GTK 3；Windows 需有 WebView2。

产物写入 `release/`，不能提交二进制、构建结果、运行数据或本机绝对路径。Logo 唯一矢量源为 `public/favicon.svg`，构建时生成 PNG，macOS 图标从同一 PNG 生成 ICNS。

## GitHub Actions 发布

应用版本以 `package.json` 为准，`pnpm version:sync` 同步 Neutralino 配置。`package.json` 的 `release.prerelease` 决定是否发布预览版。更新日志先累积到 `Unreleased`，发布时整理为 `## X.Y.Z - YYYY-MM-DD`。

后端来源固定在 `scripts/release-service.json`：Release tag、完整源码 SHA、报告 SHA256 和五个平台资产 SHA256。升级后端需核对已发布文件，并同步此清单与 `src/service-version.js`；不使用漂移的 latest 链接或现场构建的未验证二进制。

`release.yml` 在推送 `vX.Y.Z` tag 时运行：校验版本与日志，在五个原生 runner 分别检查格式、测试、构建和打包；解压最终下载包到含中文与空格的路径，核对架构、执行权限、资源、许可及运行库，并启动真实服务检查平台注册和鉴权。随后启动包内的真实桌面 WebView，确认前端启动服务，并在桌面退出后检查服务停机。Linux 使用 Xvfb 提供显示环境。

原生桌面检查仅允许在隔离的 CI 账号运行，避免读取本机已有用户数据。CI 启动检查不代表所有真实机器、Linux 发行版、macOS Gatekeeper 安装交互或在线音源都已逐一验收，不自动下载歌曲。

每个平台生成独立资产报告，汇总 job 必须收到五个平台的全部资产，重新核对 tag、前端提交、后端固定提交、大小与 SHA256 后，才会先创建草稿、上传完整文件并公开 Release。预览版不取代现有稳定版。已存在的 Release 不会覆盖，不移动已公开 tag。

每版提供六个桌面下载文件、`SHA256SUMS` 和 `release-manifest.json`。Release 正文由本版日志生成，末尾附按 Windows/Linux/macOS 分组的下载表，所有下载链接固定到对应 tag 和文件名。下载计数是资产下载次数，不是安装人数。

手动运行工作流并传入候选 tag 只执行验证与资产汇总，不创建 tag 或 Release。正式发布需明确授权；通过预检并提交相关变化后，推送本次单个 tag。发布结束还需从正式 Release 下载文件，与同次 CI 报告核对，不能使用另一次本地构建的哈希替代。

## 已接入功能

- 真实歌曲、歌单、专辑和歌手搜索；从 `/providers` 读取能力，界面用平台缩写。
- 按平台浏览排行榜、推荐歌单，进入详情后可返回原列表位置；仅提供搜索的歌手来源使用相关歌曲搜索。
- 音乐目录使用后端游标分页、滚动加载、固定行高虚拟列表，每列表最多缓存 5000 项，返回路径最多 8 层；部分来源失败保留成功结果并允许重试。
- 下载任务自动连续取完所有分页后显示完整数量，不受 5000 项限制；筛选在本地完成，滚动只渲染可见行，不触发网络加载。加载失败明确提示未完成并允许重试，不把部分记录数当作总数。
- 真实分享链接解析和音源播放；无前端时长限制，切换页面继续播放，可随时停止。解析或版权/凭据错误如实显示。
- 试听栏支持显式换源并显示实际平台；解析失败且后端提示可换源、播放器报错或加载超过 15 秒时保留换源入口。每次调用 `/assets/switch-source` 都使用最初歌曲和累计已尝试平台，成功后用新音源获取媒体访问；停止试听会取消在途请求，不自动循环换源。
- 歌曲 VIP、播放收费和下载收费标记来自统一 `pay` 字段；未知不当作免费，收费不直接禁用按钮，账号权限以实际解析／下载结果为准。
- 单首和已加载所选歌曲分批下载，每批最多 100 首；持久化幂等键和待确认请求，断连后确认原提交，避免重复创建。
- 下载任务实时同步、右键菜单、多选、取消、重试和移除终态记录；移除记录仅隐藏本机列表，保留文件和后台历史。暂停新任务使用真实后台调度策略，不模拟单任务暂停。
- 下载失败后由后台严格匹配并自动换源，任务显示“等待换源”和原平台 → 实际平台，悬停可查看已尝试平台；手动重试继续使用后端保存的原始身份与排除列表。
- 音质及降级策略、真实授权目标选择、动态平台 Cookie 入口（含 kw）、账号新建／更新／启停／切换和删除。保存后自动校验，仅在校验中轮询，支持取消；显示登录、会员类型及到期日期，并处理未知、失效和秘密清理失败。停用或切换后清除原 Cookie，再次启用需重新提交。已撤销记录隐藏，尚待清理的记录保留重试入口。

后台没有任务记录删除和单任务暂停接口，因此不提供伪操作。是否能下载取决于实时音源和账号授权；目录可搜索不代表拥有播放或下载权限。修改下载根目录和输出布局目前需关闭桌面端后编辑应用数据目录的 `service.json`，本轮未增加目录配置编辑器。

换源匹配、平台下载成功率排序及额度均由后台处理，不在前端搜索或猜测候选。歌曲名、完整歌手名单及版本须严格匹配，双方时长已知时差值不超过 2 秒；源耗尽明确显示失败，不放宽条件。试听保留标准品质、允许同源降级及 `allow_preview=true` 的既有策略，下载保持用户音质策略及 `allow_preview=false`。schema 8 不自动迁移旧服务数据库，前端也不会清理或覆盖旧数据。

## 原型隔离

`prototype/` 仅供设计参考，通过 `pnpm prototype:dev`、`pnpm prototype:build` 和 `pnpm prototype:test` 独立运行。详见 [原型说明](prototype.md)。
