# 开发、打包与运行细节

面向开发者的完整说明。项目概览和界面截图见 [README](../README.md)。

## 技术栈与目录

正式前端使用原生 HTML、CSS、JavaScript ES Modules、Vite 与 Neutralinojs，不引入 UI 框架。品牌图标的唯一矢量源为 `public/favicon.svg`，构建时生成窗口与 EXE 使用的 PNG。

```text
src/          正式应用
public/       正式静态资源与品牌图标
scripts/      本机服务、桌面构建与品牌资源脚本
tests/        正式应用测试
docs/         开发说明与真实界面截图
prototype/    独立设计原型
```

## 开发和运行

使用 Node.js 24、pnpm 12.14.0。当前前端对应 music-service 0.1.30（schema 8）。先构建后端 `music_service_server`，确保 `MUSIC_SERVICE_PROVIDERS` 包含需要发布的平台；桌面生命周期要求后端支持 `--parent-pid`。

```powershell
pnpm install
pnpm desktop:setup
# 指定自己构建的服务路径；此配置不写入仓库。
$env:MUSIC_SERVICE_BINARY = '<后端安装目录>/bin/music-service.exe'
pnpm desktop:prepare
pnpm dev
```

浏览器开发地址为 `http://127.0.0.1:5175/`。Vite 的开发插件启动真实服务，数据按端口隔离存放于 `.tmp/development-service-<port>/`。开发端点仅接受同源请求，不把访问令牌存进浏览器持久存储。生产构建没有这个端点；普通静态预览不能启动本机服务。

```powershell
pnpm desktop:dev   # 构建正式页面并启动 Neutralino 窗口
pnpm check         # 格式、正式应用测试和生产构建
```

桌面首次运行在系统应用数据目录的 `shiyin/` 初始化服务，新配置默认下载到系统音乐目录下的 `曲袋/`；已有配置继续使用原下载目录。改名保留原应用 ID、数据目录及偏好存储键，以继续读取已有账号与任务。三个监听端口均由系统分配，仅绑定 loopback。访问令牌使用服务创建的受限权限文件，前端只在内存持有。Cookie 交给服务的凭据存储处理，不写入前端偏好。

开发阶段只使用当前数据结构，不迁移旧数据库，也不回退旧接口。升级旧开发版本前，关闭程序并清理 `shiyin/service/` 下的旧服务数据及旧前端偏好，再由当前服务初始化；这会清除旧账号、Cookie 和任务记录。开发服务的数据目录为 `.tmp/development-service-<port>/service/`。下载目录中的音乐文件独立保存，不属于数据库清理范围。

窗口关闭后，服务检测启动进程退出并执行正常停机；下次启动由服务恢复任务。不要同时打开多个使用同一数据目录的窗口。

已有 `service.json` 在启动时保持原样，当前监听端口、页面来源和数据目录写入同目录的 `launcher-config.json` 供服务使用。原配置、偏好或待确认下载记录损坏、无法读取时会明确报错并保留原文件，不静默恢复默认值；修复文件或存储权限后重新连接。设置和列表隐藏操作在保存成功后才生效。

账号校验请求短暂失败后最多自动重试 5 次，间隔逐步增加且不超过 30 秒；仍失败时保留错误，可手动刷新重试。服务启动超时会尝试结束本次启动的子进程，清理失败时提示关闭窗口后重试。

## Windows x64 打包

先用后端的 `cmake --install <构建目录> --prefix <安装目录>` 生成服务与许可证文件，然后执行：

```powershell
$env:MUSIC_SERVICE_BINARY = '<后端安装目录>/bin/music-service.exe'
$env:MUSIC_SERVICE_LICENSES = '<后端安装目录>/share/music-service/licenses'
pnpm desktop:build
```

也可事先将二进制放到 `bin/service/0.1.30/music-service.exe`，许可证放到 `bin/service/licenses/`，随后省略环境变量。打包会校验服务版本，拒绝混入旧接口二进制。服务正在运行时应先关闭对应桌面或开发进程，再替换二进制。

先运行一次 `pnpm desktop:setup` 安装配置指定的 Neutralino 运行时；修改运行时版本后也需重新执行。

产物为 `release/qudai-windows-x64/qudai-win_x64.exe` 和只包含此 EXE 的 `release/qudai-windows-x64.zip`。EXE 内嵌正式页面、music-service 和第三方许可声明，可以单独复制运行。Windows 文件描述为「曲袋 · 音乐下载」，产品名为「曲袋」，进程文件名为 `qudai-win_x64.exe`，均使用自有图标。当前只验证 Windows x64，需要 WebView2 运行时。macOS/Linux 尚未打包验收。

`desktop:dev` 同样复制并写入名称与图标后启动，避免开发窗口仍显示通用 Neutralino 进程；原下载的运行时不会被修改。旧版本正在运行时，名称与图标不会实时更新，需要关闭旧窗口并启动新版 EXE。

首次启动将服务释放到系统应用数据目录的 `shiyin/runtime/<SHA-256>/`，验证内容后才启动。再次启动校验并复用缓存，服务更新使用独立目录，不覆盖正在运行的旧版本。窗口关闭或桌面进程异常退出时，后端通过父进程监测正常停机。单文件指分发形式，运行时仍会保存服务缓存、配置、数据库和下载文件。

安装运行时与打包均在全新的 `.desktop-build/` 子目录工作，避免 Neutralino CLI 清理开发数据。打包启用 `--embed-resources`，并在确认输出仅含 EXE 后生成 ZIP；不额外分发 `resources.neu`、`bin/` 或 `licenses/`，重建时清理这些旧产物。**不要在仓库根目录直接运行 `neu build` 或 `neu update`**：它们会清理 `.tmp/`。不提交运行时、用户数据、凭据或构建结果。

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

## GitHub Actions 发布

应用版本以 `package.json` 为准，修改后运行 `pnpm version:sync` 同步 Neutralino 元数据。`CHANGELOG.md` 为每次发布保留 `## X.Y.Z - YYYY-MM-DD` 条目；开发中的变化先写入 `Unreleased`。

`.github/workflows/release.yml` 在推送 `vX.Y.Z` tag 时执行，校验 tag 格式、前端与桌面版本、对应更新日志后，在 Windows x64 runner 上构建固定提交的 music-service。后端的仓库、完整 SHA、版本和平台列表保存在 `scripts/release-service.json`；升级后端时需同时更新此文件和 `src/service-version.js`。

工作流使用 MSVC Release 和后端既有的静态 CRT 配置，运行后端 CTest、前端 `pnpm check`，再通过独立 `.desktop-build/` 工作目录生成单文件桌面包。发布前检查 PE 架构、Windows 产品与文件版本、系统 DLL 依赖、ZIP 只有一个 EXE，并从最终 EXE 中提取资源、校验内嵌后端和许可证，启动真实服务检查平台注册与鉴权。该检查不依赖线上歌曲，也不证明所有平台的实时下载成功率。

构建 job 只有仓库读取权限；单独的发布 job 在取得已验证资产并重新核对 SHA256、tag、提交和发布说明后，先创建草稿并上传所有文件，再公开 Release。已存在的 Release 不会被覆盖，失败时先定位原因，不移动已发布 tag。

发布资产包含：

- `qudai-win_x64.exe`：可独立运行的 Windows x64 EXE。
- `qudai-windows-x64.zip`：只含同一 EXE 的 ZIP。
- `SHA256SUMS`：上述两个下载包的 SHA256。
- `release-manifest.json`：同一次构建的前端提交、后端固定提交、文件大小与 SHA256。

Release 说明从该版本的更新日志生成，末尾附按系统排列的下载表，链接固定到本次 tag 和实际文件名。下载计数徽章统计所有 Release 资产的下载次数，不代表安装人数。

发布操作需明确授权；准备完版本、更新日志和必要检查后：

```powershell
pnpm version:sync
pnpm check
# 提交并推送本次发布相关改动后，确认 tag 未被使用，再推送单个 tag。
git tag vX.Y.Z
git push origin vX.Y.Z
```

tag 推送成功后需等待 Actions 完成，回读实际 Release、资产和下载表，并将下载文件与同次 CI 的 `release-manifest.json` 对照。不能用另一次本地构建的哈希代替 CI 报告。

首次接入或修改发布流水线时，可先手动运行该工作流并传入候选 tag（例如 `v0.1.2`），只完成构建验证，不创建 tag 或 Release。验证通过后再推送正式 tag；正式发布仍会在该 tag 对应的提交上重新构建并校验。

## 原型隔离

`prototype/` 仅保留设计参考，正式代码不导入它的演示目录、队列、计时器或示例链接。默认 `dev`、`build`、`test` 和桌面命令均面向正式应用。

```sh
pnpm prototype:dev
pnpm prototype:build
pnpm prototype:test
```

原型说明保留在 `docs/prototype.md`，其中能力描述不代表正式实现或实时平台授权。
