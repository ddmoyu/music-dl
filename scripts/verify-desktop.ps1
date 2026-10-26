param([Parameter(Mandatory = $true)][string]$ServiceBinary)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath 'neutralino.config.json' -Raw | ConvertFrom-Json
$exe = (Resolve-Path 'release/qudai-windows-x64/qudai-win_x64.exe').Path
$packageVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $packageVersion) {
    throw 'Windows 产品版本与 package.json 不一致'
}
if ((Get-Item -LiteralPath $exe).VersionInfo.FileVersion -ne "$packageVersion.0") {
    throw 'Windows 文件版本与 package.json 不一致'
}
if ((Get-Item -LiteralPath $exe).VersionInfo.ProductName -ne $config.applicationName) {
    throw 'Windows 产品名称不正确'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsRoot = & $vswhere -latest -prerelease -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsRoot) { throw '找不到已安装的 MSVC' }
$dumpbin = Get-ChildItem -LiteralPath (Join-Path $vsRoot 'VC/Tools/MSVC') -Directory |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin/Hostx64/x64/dumpbin.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $dumpbin) { throw '找不到 dumpbin，无法验证运行库依赖' }

# 已核对的 Neutralino 6.10.0 与 music-service 的系统导入；不允许额外 DLL/动态 CRT。
$allowed = @('gdi32.dll', 'version.dll', 'ole32.dll', 'oleaut32.dll', 'ntdll.dll',
    'dwmapi.dll', 'iphlpapi.dll', 'ws2_32.dll', 'kernel32.dll', 'user32.dll',
    'shell32.dll', 'advapi32.dll', 'mswsock.dll', 'bcrypt.dll', 'shlwapi.dll',
    'crypt32.dll', 'gdiplus.dll', 'dxgi.dll', 'api-ms-win-core-synch-l1-2-0.dll')
foreach ($binary in @($exe, (Resolve-Path -LiteralPath $ServiceBinary).Path)) {
    $bytes = [System.IO.File]::ReadAllBytes($binary)
    if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) { throw '无效的 PE 文件' }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length -or
        [BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550 -or
        [BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x8664) { throw '仅允许 Windows x64 PE' }
    $importsOutput = & $dumpbin /dependents $binary
    if ($LASTEXITCODE -ne 0) { throw 'dumpbin 检查失败' }
    $imports = @($importsOutput | Where-Object { $_ -match '^\s+\S+\.dll\s*$' } |
        ForEach-Object { $_.Trim().ToLowerInvariant() })
    if (-not $imports.Count) { throw '未能识别 PE 导入' }
    $unexpected = @($imports | Where-Object { $_ -notin $allowed })
    if ($unexpected.Count) { throw "存在未批准的运行依赖：$($unexpected -join ', ')" }
    Write-Host "PE x64 / 静态 CRT 依赖检查通过：$([System.IO.Path]::GetFileName($binary))"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path 'release/qudai-windows-x64.zip').Path)
try {
    if ($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -cne 'qudai-win_x64.exe') {
        throw 'ZIP 必须仅包含一个 EXE，不得包含用户数据或额外运行文件'
    }
    $stream = $zip.Entries[0].Open()
    try { $hash = [System.Security.Cryptography.SHA256]::HashData($stream) }
    finally { $stream.Dispose() }
    if ([Convert]::ToHexString($hash) -ne (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
        throw 'ZIP 中的 EXE 与独立下载的 EXE 不一致'
    }
} finally { $zip.Dispose() }
Write-Host '版本、产品名称、PE 架构、系统依赖和单 EXE ZIP 校验通过'
