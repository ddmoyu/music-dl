# 拾音

基于 music-service 的实际桌面下载工具，使用原生 HTML/CSS/JavaScript、Vite 和 Neutralinojs。正式入口位于 `src/`，服务由桌面端自带并自动启动。

## 开发和运行

使用 Node.js 24、pnpm 12.14.0。先构建后端 `music_service_server`，确保 `MUSIC_SERVICE_PROVIDERS` 包含需要发布的平台；桌面生命周期要求后端支持 `--parent-pid`。

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

桌面首次运行在系统应用数据目录的 `shiyin/` 初始化服务，默认下载到系统音乐目录下的 `拾音/`。三个监听端口均由系统分配，仅绑定 loopback。访问令牌使用服务创建的受限权限文件，前端只在内存持有。Cookie 交给服务的凭据存储处理，不写入前端偏好。

窗口关闭后，服务检测启动进程退出并执行正常停机；下次启动由服务恢复任务。不要同时打开多个使用同一数据目录的窗口。

## Windows x64 打包

先用后端的 `cmake --install <构建目录> --prefix <安装目录>` 生成服务与许可证文件，然后执行：

```powershell
$env:MUSIC_SERVICE_BINARY = '<后端安装目录>/bin/music-service.exe'
$env:MUSIC_SERVICE_LICENSES = '<后端安装目录>/share/music-service/licenses'
pnpm desktop:build
```

也可事先将二进制放到 `bin/service/music-service.exe`，许可证放到 `bin/service/licenses/`，随后省略环境变量。服务正在运行时应先关闭对应桌面或开发进程，再替换二进制。

先运行一次 `pnpm desktop:setup` 安装配置指定的 Neutralino 运行时；修改运行时版本后也需重新执行。

产物为 `release/shiyin-windows-x64/shiyin-win_x64.exe` 和只包含此 EXE 的 `release/shiyin-windows-x64.zip`。EXE 内嵌正式页面、music-service 和第三方许可声明，可以单独复制运行。当前只验证 Windows x64，需要 WebView2 运行时。macOS/Linux 尚未打包验收。

首次启动将服务释放到系统应用数据目录的 `shiyin/runtime/<SHA-256>/`，验证内容后才启动。再次启动校验并复用缓存，服务更新使用独立目录，不覆盖正在运行的旧版本。窗口关闭或桌面进程异常退出时，后端通过父进程监测正常停机。单文件指分发形式，运行时仍会保存服务缓存、配置、数据库和下载文件。

安装运行时与打包均在全新的 `.desktop-build/` 子目录工作，避免 Neutralino CLI 清理开发数据。打包启用 `--embed-resources`，并在确认输出仅含 EXE 后生成 ZIP；不额外分发 `resources.neu`、`bin/` 或 `licenses/`，重建时清理这些旧产物。**不要在仓库根目录直接运行 `neu build` 或 `neu update`**：它们会清理 `.tmp/`。不提交运行时、用户数据、凭据或构建结果。

## 已接入功能

- 真实歌曲、歌单、专辑和歌手搜索；从 `/providers` 读取能力，界面用平台缩写。
- 按平台浏览排行榜、推荐歌单，进入详情后可返回原列表位置；仅提供搜索的歌手来源使用相关歌曲搜索。
- 后端游标分页、滚动加载、固定行高虚拟列表。每列表最多缓存 5000 项，返回路径最多 8 层；部分来源失败保留成功结果并允许重试。
- 真实分享链接解析和最多 30 秒试听，解析或版权/凭据错误如实显示。
- 单首和已加载所选歌曲分批下载，每批最多 100 首；持久化幂等键和待确认请求，断连后确认原提交，避免重复创建。
- 下载任务实时同步、右键菜单、多选、取消、重试和移除终态记录；移除记录仅隐藏本机列表，保留文件和后台历史。暂停新任务使用真实后台调度策略，不模拟单任务暂停。
- 音质及降级策略、真实授权目标选择、Cookie 保存/验证/默认选择和删除。

后台没有任务记录删除和单任务暂停接口，因此不提供伪操作。是否能下载取决于实时音源和账号授权；目录可搜索不代表拥有播放或下载权限。修改下载根目录和输出布局目前需关闭桌面端后编辑应用数据目录的 `service.json`，本轮未增加目录配置编辑器。

## 原型隔离

`prototype/` 仅保留设计参考，正式代码不导入它的演示目录、队列、计时器或示例链接。默认 `dev`、`build`、`test` 和桌面命令均面向正式应用。

```sh
pnpm prototype:dev
pnpm prototype:build
pnpm prototype:test
```

原型说明保留在 `docs/prototype.md`，其中能力描述不代表正式实现或实时平台授权。
