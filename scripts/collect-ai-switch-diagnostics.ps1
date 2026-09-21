#Requires -Version 5.1
<#
.SYNOPSIS
    ai-switch 诊断数据采集脚本（排查「Codex 不显示思考 / 首字卡顿」类问题）

.DESCRIPTION
    采集排查所需的证据，产出一个可以直接发回来的 zip 包：

      1. 通过本机 Web 服务拉取「实时日志」。每条记录包含四个阶段的完整报文，
         其中 upstream_response 是上游原样返回的字节、final_response 是客户端
         最终收到的字节。这两者一比，就能确定「上游到底发没发思考」以及
         「我们有没有把它丢掉」——这是本地数据库做不到的（数据库只留 2048 字节）。

      2. 若本机装有 Python，额外导出近 7 天的 usage_events 汇总（看历史趋势）。

      3. 生成 summary.txt，直接给出「上游有思考 / 最终无思考」的条数与分布。

.PARAMETER Port
    ai-switch 本地 Web 服务端口。默认自动从 <数据目录>\web-service.json 读取。

.PARAMETER Token
    访问令牌。默认自动从 <数据目录>\web-service.json 读取。

.PARAMETER DataDir
    数据目录。默认 %USERPROFILE%\.ai-switch。

.PARAMETER WatchSeconds
    抓取时长（秒）。默认 0，表示一直抓到用户按 Enter 为止。

.PARAMETER OutDir
    输出目录。默认桌面。

.PARAMETER SkipBodies
    只保留结构化字段，丢弃四阶段报文。体积小，但基本没法定位问题。

.PARAMETER StageLimitKb
    每个阶段报文最多保留多少 KB，默认 16。思考事件在流的开头就到达，
    截头不影响判定。设为 0 表示不截断（诊断包可能几十 MB）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\collect-ai-switch-diagnostics.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\collect-ai-switch-diagnostics.ps1 -Port 19527 -Token abc123
#>
[CmdletBinding()]
param(
    [int]$Port = 0,
    [string]$Token = '',
    [string]$DataDir = '',
    [int]$WatchSeconds = 0,
    [string]$OutDir = '',
    [int]$StageLimitKb = 16,
    [switch]$SkipBodies
)

$ErrorActionPreference = 'Stop'
$ScriptVersion = '1.0.0'

# 判定「这段报文里有没有思考」。三种协议各自的载体不同：
#   Responses  -> response.reasoning_summary_* 事件 / type=reasoning 条目
#   Anthropic  -> thinking_delta / redacted_thinking 块
#   Chat       -> reasoning_content 字段
$ReasoningMarkers = @(
    'response.reasoning_summary',
    '"type":"reasoning"',
    '"type": "reasoning"',
    'thinking_delta',
    '"type":"thinking"',
    'redacted_thinking',
    'reasoning_content'
)

$Platforms = @('codex', 'claude', 'gemini', 'grok', 'opencode', 'openclaw', 'hermes')

# 实时日志每个阶段在服务端被截到 64KB（route_proxy_live_log.rs 的 LIVE_LOG_STAGE_LIMIT），
# 而且是按**字节**截的，不是按字符。有些上游的 response.created 会把整个输入回显一遍，
# 单这一个事件就超 64KB，于是「上游侧有没有思考」就看不到了。实测 100 条里 82 条会踩到。
$LiveLogStageLimit = 64 * 1024

function Write-Step([string]$Message) { Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "  [..] $Message" -ForegroundColor Gray }
function Write-Warn([string]$Message) { Write-Host "  [!!] $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host "  [XX] $Message" -ForegroundColor Red }

function Get-ReasoningFlag([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return $null }
    foreach ($marker in $ReasoningMarkers) {
        if ($Text.Contains($marker)) { return $true }
    }
    return $false
}

function Get-UrlHost([string]$Url) {
    if ([string]::IsNullOrEmpty($Url)) { return '(none)' }
    try { return ([System.Uri]$Url).Host } catch { return $Url }
}

# 某个阶段是否被 64KB 上限截断。新数据直接读服务端给的 truncated_stages（权威）；
# 旧数据没有这个字段，就按「截断后的字节数必然 >= 64KB」反推 —— 服务端切的是恰好
# 64KB 字节，解码回来仍是 65536~65538 字节，所以这个反推是精确的。
# 不能用 $entry.truncated：它是四个阶段的或，60KB 的提示词会让两个**请求**阶段几乎
# 每轮都截断，用它会把所有条目都误判成「上游被截断」。
function Get-StageTruncated($Entry, [string]$Stage) {
    $stages = $Entry.truncated_stages
    # @() 包一层：ConvertFrom-Json 对单元素数组可能退化成标量。
    if ($null -ne $stages) { return (@($stages) -contains $Stage) }
    $text = $Entry.$Stage
    if ([string]::IsNullOrEmpty($text)) { return $false }
    return ([System.Text.Encoding]::UTF8.GetByteCount($text) -ge $LiveLogStageLimit)
}

# 上游发了、客户端没收到 —— 这就是要排查的「思考丢失」。
# 反过来（客户端有、上游没有）说明是别处注入的，也要记下来。
function Get-Verdict($UpstreamFlag, $FinalFlag) {
    if ($null -eq $UpstreamFlag -and $null -eq $FinalFlag) { return 'no-body' }
    if ($null -eq $UpstreamFlag) { return 'upstream-missing' }
    if ($null -eq $FinalFlag) { return 'final-missing' }
    if ($UpstreamFlag -and -not $FinalFlag) { return 'DROPPED' }
    if (-not $UpstreamFlag -and $FinalFlag) { return 'injected' }
    if ($UpstreamFlag -and $FinalFlag) { return 'kept' }
    return 'never'
}

function Resolve-DataDir([string]$Explicit) {
    if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }
    $default = Join-Path $env:USERPROFILE '.ai-switch'
    if (-not (Test-Path $default)) { return $null }
    # settings.json 里可能指定了自定义数据目录，优先用它。
    $settingsFile = Join-Path $default 'settings.json'
    if (Test-Path $settingsFile) {
        try {
            $settings = Get-Content -Raw -Encoding UTF8 $settingsFile | ConvertFrom-Json
            if ($settings.data_dir -and (Test-Path $settings.data_dir)) {
                return (Resolve-Path $settings.data_dir).Path
            }
        } catch { }
    }
    return (Resolve-Path $default).Path
}

function Get-AppVersion {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\ai-switch\ai-switch.exe'),
        (Join-Path ${env:ProgramFiles} 'ai-switch\ai-switch.exe'),
        (Join-Path ${env:ProgramFiles} 'AI Switch\ai-switch.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            try { return (Get-Item $candidate).VersionInfo.FileVersion } catch { }
        }
    }
    try {
        $proc = Get-Process -Name 'ai-switch' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($proc -and $proc.Path) { return (Get-Item $proc.Path).VersionInfo.FileVersion }
    } catch { }
    return 'unknown'
}

function Write-Utf8File([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# PS 5.1 的 ConvertTo-Json 会把单元素数组拆成对象，这里显式拼数组。
function ConvertTo-JsonArray($Items) {
    $array = @($Items)
    if ($array.Count -eq 0) { return '[]' }
    $parts = foreach ($item in $array) {
        ConvertTo-Json -InputObject $item -Depth 100 -Compress
    }
    return '[' + ($parts -join ',') + ']'
}

# ---------------------------------------------------------------- 1. 定位环境

Write-Step '1/6 定位 ai-switch 环境'

$resolvedDataDir = Resolve-DataDir $DataDir
if ($resolvedDataDir) {
    Write-Ok "数据目录: $resolvedDataDir"
} else {
    Write-Warn '没有找到 %USERPROFILE%\.ai-switch，将只做实时日志抓取'
}

$webConfigPath = if ($resolvedDataDir) { Join-Path $resolvedDataDir 'web-service.json' } else { $null }
if (-not $Token -and $webConfigPath -and (Test-Path $webConfigPath)) {
    try {
        $webConfig = Get-Content -Raw -Encoding UTF8 $webConfigPath | ConvertFrom-Json
        if (-not $Port) { $Port = [int]$webConfig.port }
        $Token = [string]$webConfig.token
        Write-Ok "已从 web-service.json 读到端口 $Port 与访问令牌"
    } catch {
        Write-Warn "web-service.json 解析失败: $($_.Exception.Message)"
    }
}
if (-not $Port) { $Port = 19527 }
if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }

$appVersion = Get-AppVersion
Write-Ok "ai-switch 版本: $appVersion"
Write-Ok "输出目录: $OutDir"

$baseUrl = "http://127.0.0.1:$Port"
$headers = @{}
if ($Token) { $headers['Authorization'] = "Bearer $Token" }

# ---------------------------------------------------------------- 2. 连通性

Write-Step '2/6 连接本地 Web 服务'

$connected = $false
try {
    $health = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/health" `
        -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 8
    if ($health.ok) { $connected = $true }
} catch {
    $connected = $false
}

if (-not $connected) {
    Write-Fail "连不上 $baseUrl"
    Write-Host @"

请先启动本地 Web 服务，再重新运行本脚本：

  1. 打开 ai-switch
  2. 进入「设置」->「Web 服务」
  3. 点击启动，并确认「服务端口」与「访问令牌」
  4. 如果端口不是 $Port、或令牌没能自动读到，请手动传入：

     powershell -ExecutionPolicy Bypass -File "<本脚本路径>" -Port <端口> -Token <令牌>

"@ -ForegroundColor Yellow
    exit 1
}
Write-Ok "已连接 $baseUrl"

# ---------------------------------------------------------------- 3. 抓取

$seen = @{}
$entries = New-Object System.Collections.ArrayList

function Receive-LiveLog([string]$Platform) {
    $payload = @{ platform = $Platform } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/subscribe_route_proxy_live_log" `
        -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 30
    # Invoke-RestMethod 把整个 JSON 数组当成「一个对象」写进管道，直接 return 的话
    # 调用方用 @() 包起来也只会拿到 1 个元素（那个数组本身）。必须逐条吐出去。
    foreach ($entry in @($response)) {
        if ($entry) { $entry }
    }
}

# 单阶段报文上限。思考事件在流的开头就会到达，截头保留足够判定；
# 不截的话 100 条 × 4 阶段 × 64KB 会让诊断包涨到几十 MB。
function Limit-StageText([string]$Text, [int]$Limit) {
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    if ($Text.Length -le $Limit) { return $Text }
    return $Text.Substring(0, $Limit) + "`n...[ai-switch-diag: 已截断，原文 $($Text.Length) 字符]"
}

function Invoke-PollRound {
    foreach ($platform in $Platforms) {
        try {
            foreach ($item in @(Receive-LiveLog $platform)) {
                if ($item -and $item.id -and -not $seen.ContainsKey($item.id)) {
                    $seen[$item.id] = $true
                    [void]$entries.Add($item)
                }
            }
        } catch { }
    }
}

function Show-Progress {
    Write-Host ("`r  已捕获 {0} 条..." -f $entries.Count) -NoNewline -ForegroundColor Gray
}

Write-Step '3/6 开始抓取实时日志'

Write-Host @"

实时日志只保留最近 100 条，所以请在下面的抓取窗口内复现问题：

  现在到 Codex 里重新发一次「不显示思考」的那类提问
  （最好是刚才卡住 / 没有思考折叠的那一轮，越接近越好）。

抓取中... 按 Enter 结束。

"@ -ForegroundColor White

$startedAt = Get-Date

# 键盘可用性探测：输入被重定向（被别的脚本调用）时 Console.KeyAvailable 会抛错。
$keyboardUsable = $true
try { [void][Console]::KeyAvailable } catch { $keyboardUsable = $false }

if ($WatchSeconds -gt 0) {
    $deadline = (Get-Date).AddSeconds($WatchSeconds)
    while ((Get-Date) -lt $deadline) {
        Invoke-PollRound
        Show-Progress
        Start-Sleep -Seconds 2
    }
} elseif ($keyboardUsable) {
    while ($true) {
        $stop = $false
        try {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq 'Enter') { $stop = $true }
            }
        } catch { }
        if ($stop) { break }
        Invoke-PollRound
        Show-Progress
        Start-Sleep -Seconds 2
    }
} else {
    Write-Note '检测不到键盘输入，退化为固定抓取 180 秒'
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        Invoke-PollRound
        Show-Progress
        Start-Sleep -Seconds 2
    }
}

Write-Host ''
Write-Ok "抓取结束，共捕获 $($entries.Count) 条"

if ($entries.Count -eq 0) {
    Write-Fail '一条都没抓到。请确认复现时确实走了 ai-switch 的路由代理，然后重跑本脚本。'
    exit 1
}

# ---------------------------------------------------------------- 4. 分析

Write-Step '4/6 分析上游与客户端的思考差异'

$analyzed = New-Object System.Collections.ArrayList
$verdicts = @{}
foreach ($entry in $entries) {
    $upstreamFlag = Get-ReasoningFlag $entry.upstream_response
    $finalFlag = Get-ReasoningFlag $entry.final_response
    $verdict = Get-Verdict $upstreamFlag $finalFlag

    # 被截断的那一侧「没有思考」这个结论站不住脚：思考事件可能就在被截掉的那一段
    # 里。所以给结论加问号，以区别于确定的结论。
    $upstreamTruncated = Get-StageTruncated $entry 'upstream_response'
    $finalTruncated = Get-StageTruncated $entry 'final_response'
    if ($verdict -eq 'never' -and $upstreamTruncated) { $verdict = 'never?' }
    # 同理，客户端报有思考而上游看不到，多半是截断而不是我们凭空造了思考。
    if ($verdict -eq 'injected' -and $upstreamTruncated) { $verdict = 'injected?' }
    if ($verdict -eq 'DROPPED' -and $finalTruncated) { $verdict = 'DROPPED?' }

    if (-not $verdicts.ContainsKey($verdict)) { $verdicts[$verdict] = 0 }
    $verdicts[$verdict]++

    $record = [ordered]@{
        id                 = $entry.id
        created_at         = $entry.created_at
        platform           = $entry.platform
        bridge             = $entry.bridge
        target_url         = $entry.target_url
        credential_name    = $entry.credential_name
        requested_model    = $entry.requested_model
        upstream_model     = $entry.upstream_model
        status             = $entry.status
        success            = $entry.success
        duration_ms        = $entry.duration_ms
        attempt            = $entry.attempt
        truncated          = $entry.truncated
        truncated_stages   = $entry.truncated_stages
        error_message      = $entry.error_message
        notes              = $entry.notes
        upstream_reasoning = $upstreamFlag
        final_reasoning    = $finalFlag
        upstream_truncated = $upstreamTruncated
        final_truncated    = $finalTruncated
        verdict            = $verdict
    }
    if (-not $SkipBodies) {
        $stageLimit = if ($StageLimitKb -gt 0) { $StageLimitKb * 1024 } else { [int]::MaxValue }
        $record['client_request'] = Limit-StageText $entry.client_request $stageLimit
        $record['upstream_request'] = Limit-StageText $entry.upstream_request $stageLimit
        $record['upstream_response'] = Limit-StageText $entry.upstream_response $stageLimit
        $record['final_response'] = Limit-StageText $entry.final_response $stageLimit
        $record['upstream_headers'] = $entry.upstream_headers
    }
    [void]$analyzed.Add($record)
}

$dropped = @($analyzed | Where-Object { $_.verdict -eq 'DROPPED' })
Write-Host ''
foreach ($verdict in @('DROPPED', 'DROPPED?', 'kept', 'never', 'never?', 'injected', 'injected?', 'upstream-missing', 'final-missing', 'no-body')) {
    $count = if ($verdicts.ContainsKey($verdict)) { $verdicts[$verdict] } else { 0 }
    $label = switch ($verdict) {
        'DROPPED' { '上游发了思考、客户端没收到   <== 问题所在' }
        'DROPPED?' { '上游有思考、客户端报文被截断，无法确认' }
        'kept' { '上游发了、客户端也收到了' }
        'never' { '上游没发、客户端也没有' }
        'never?' { '上游报文被 64KB 截断，无法确认上游发没发' }
        'injected' { '上游没发、客户端却有（异常）' }
        'injected?' { '客户端有思考、上游报文被截断（多半正常）' }
        'upstream-missing' { '上游报文缺失' }
        'final-missing' { '客户端报文缺失' }
        'no-body' { '两侧报文都缺失' }
    }
    $color = if ($verdict -eq 'DROPPED' -and $count -gt 0) { 'Red' } else { 'Gray' }
    Write-Host ("  {0,-16} {1,4}  {2}" -f $verdict, $count, $label) -ForegroundColor $color
}

if ($dropped.Count -gt 0) {
    Write-Host ''
    Write-Host '  最近几条「上游有思考、客户端没有」的记录：' -ForegroundColor Red
    foreach ($item in ($dropped | Select-Object -Last 5)) {
        Write-Host ("    - {0}  {1}  {2}  {3}ms" -f $item.created_at, $item.bridge, (Get-UrlHost $item.target_url), $item.duration_ms) -ForegroundColor Red
    }
}

# ---------------------------------------------------------------- 5. 落盘

Write-Step '5/6 写出诊断包'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundleDir = Join-Path $OutDir "ai-switch-diag-$stamp"
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

$osCaption = 'unknown'
try { $osCaption = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption } catch { }

$meta = [ordered]@{
    collected_at       = (Get-Date).ToUniversalTime().ToString('o')
    script_version     = $ScriptVersion
    ai_switch_version  = $appVersion
    data_dir           = $resolvedDataDir
    web_service_port   = $Port
    capture_started_at = $startedAt.ToUniversalTime().ToString('o')
    capture_seconds    = [int]((Get-Date) - $startedAt).TotalSeconds
    entry_count        = $analyzed.Count
    bodies_included    = (-not $SkipBodies)
    os                 = $osCaption
    os_version         = [Environment]::OSVersion.VersionString
    powershell         = $PSVersionTable.PSVersion.ToString()
    computer_name      = $env:COMPUTERNAME
}
Write-Utf8File (Join-Path $bundleDir 'meta.json') (ConvertTo-Json -InputObject $meta -Depth 5)
Write-Utf8File (Join-Path $bundleDir 'live-log.json') (ConvertTo-JsonArray $analyzed)

# summary.txt —— 人肉可读，也是我这边第一眼要看的文件
$summary = New-Object System.Collections.ArrayList
[void]$summary.Add('ai-switch 诊断摘要')
[void]$summary.Add("生成时间: $($meta.collected_at)")
[void]$summary.Add("ai-switch 版本: $appVersion")
[void]$summary.Add("采集时长: $($meta.capture_seconds) 秒，共 $($analyzed.Count) 条")
[void]$summary.Add("报文已包含: $(-not $SkipBodies)")
[void]$summary.Add('')
[void]$summary.Add('--- 判定分布 ---')
foreach ($verdict in $verdicts.Keys) {
    [void]$summary.Add(("{0,-18} {1}" -f $verdict, $verdicts[$verdict]))
}
[void]$summary.Add('')
[void]$summary.Add('--- 按桥类型 ---')
foreach ($group in ($analyzed | Group-Object { $_.bridge })) {
    $d = @($group.Group | Where-Object { $_.verdict -eq 'DROPPED' }).Count
    $k = @($group.Group | Where-Object { $_.verdict -eq 'kept' }).Count
    $n = @($group.Group | Where-Object { $_.verdict -eq 'never' }).Count
    [void]$summary.Add(("{0,-26} 共{1,4}  DROPPED={2,4}  kept={3,4}  never={4,4}" -f $group.Name, $group.Count, $d, $k, $n))
}
[void]$summary.Add('')
[void]$summary.Add('--- 按上游主机 ---')
$byHost = $analyzed | Group-Object { Get-UrlHost $_.target_url }
foreach ($group in ($byHost | Sort-Object Count -Descending)) {
    $d = @($group.Group | Where-Object { $_.verdict -eq 'DROPPED' }).Count
    $k = @($group.Group | Where-Object { $_.verdict -eq 'kept' }).Count
    $n = @($group.Group | Where-Object { $_.verdict -eq 'never' }).Count
    [void]$summary.Add(("{0,-32} 共{1,4}  DROPPED={2,4}  kept={3,4}  never={4,4}" -f $group.Name, $group.Count, $d, $k, $n))
}
[void]$summary.Add('')
[void]$summary.Add('--- 截断情况（单阶段上限 64KB 字节）---')
$truncatedUpstream = @($analyzed | Where-Object { $_.upstream_truncated }).Count
$truncatedFinal = @($analyzed | Where-Object { $_.final_truncated }).Count
[void]$summary.Add("上游报文被截断:   $truncatedUpstream / $($analyzed.Count)")
[void]$summary.Add("客户端报文被截断: $truncatedFinal / $($analyzed.Count)")
[void]$summary.Add('说明: 报文里出现 <instructions omitted: N chars> / <tools omitted: N items, N')
[void]$summary.Add('      bytes> 这类标记，是服务端为腾出 64KB 预算做的替换（回显字段），不是上游原文。')
[void]$summary.Add('      另外 ...ai-switch-live-log: omitted N bytes... 表示此处丢掉了中间一段：')
[void]$summary.Add('      超限报文保留「头部 + 尾部」，头部是对话、尾部是 reasoning / stream 这类')
[void]$summary.Add('      解释性标量，所以两端都值得看。')
if ($truncatedUpstream -gt 0) {
    [void]$summary.Add('注意: 上游被截断时，「上游没发思考」无法确认 —— 思考事件可能在被截掉的那一段里。')
    [void]$summary.Add('      Responses 上游尤其容易这样：它的首个 response.created 事件会把整个输入')
    [void]$summary.Add('      回显一遍，单这一个事件就可能占满 64KB。')
}
[void]$summary.Add('')
[void]$summary.Add('--- 逐条 ---')
[void]$summary.Add(("{0,-30} {1,-22} {2,-24} {3,-6} {4,8} {5}" -f 'created_at', 'bridge', 'host', 'status', 'dur_ms', 'verdict'))
foreach ($item in ($analyzed | Sort-Object created_at)) {
    [void]$summary.Add(("{0,-30} {1,-22} {2,-24} {3,-6} {4,8} {5}" -f $item.created_at, $item.bridge, (Get-UrlHost $item.target_url), $item.status, $item.duration_ms, $item.verdict))
}
Write-Utf8File (Join-Path $bundleDir 'summary.txt') ($summary -join "`r`n")

Write-Ok 'live-log.json / summary.txt / meta.json 已写出'

# 历史趋势（可选，需要 Python）
if ($resolvedDataDir) {
    $dbPath = Join-Path $resolvedDataDir 'ai-switch.db'
    $python = $null
    foreach ($candidate in @('python', 'python3', 'py')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -and $cmd.Source -notmatch 'WindowsApps') { $python = $cmd.Source; break }
    }
    if ($python -and (Test-Path $dbPath)) {
        Write-Note '检测到 Python，导出近 7 天 usage_events...'
        $py = @'
import sqlite3, json, csv, sys

db, out = sys.argv[1], sys.argv[2]
MARKERS = ('response.reasoning_summary', '"type":"reasoning"', '"type": "reasoning"',
           'thinking_delta', '"type":"thinking"', 'redacted_thinking', 'reasoning_content')


def upstream_path(meta):
    """上游真正被请求的端点。

    老记录的 metadata 里没有 upstream_path（该字段后加），而且它的 entry_path 和
    path 都是「客户端入口路径」——Codex 永远是 /v1/responses，拿它分组毫无意义。
    这里从 target_url 反推，保证新旧记录都能按上游协议归类。
    """
    value = meta.get('upstream_path')
    if value:
        return value
    url = meta.get('target_url') or ''
    if '://' not in url:
        return ''
    rest = url.split('://', 1)[1]
    if '/' not in rest:
        return ''
    path = rest.split('/', 1)[1]
    for separator in ('?', '#'):
        path = path.split(separator, 1)[0]
    return '/' + path.strip('/') if path.strip('/') else ''


con = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True)
rows = con.execute(
    "select created_at, metadata_json from usage_events "
    "where source_label='route_proxy' and created_at >= date('now','-7 day')"
)
with open(out, 'w', newline='', encoding='utf-8-sig') as fh:
    w = csv.writer(fh)
    w.writerow(['created_at', 'platform', 'entry_path', 'upstream_path', 'target_url',
                'credential_name', 'requested_model', 'upstream_model', 'status', 'success',
                'duration_ms', 'body_len', 'client_has_reasoning'])
    for created, meta in rows:
        try:
            m = json.loads(meta)
        except Exception:
            continue
        body = m.get('response_body') or ''
        w.writerow([created, m.get('platform'), m.get('entry_path') or m.get('path'),
                    upstream_path(m), m.get('target_url'),
                    m.get('route_credential_name'), m.get('requested_model'),
                    m.get('upstream_model'), m.get('status'), m.get('success'),
                    m.get('duration_ms'), len(body),
                    any(k in body for k in MARKERS) if body else ''])
'@
        $pyPath = Join-Path $bundleDir 'export_usage_events.py'
        $csvPath = Join-Path $bundleDir 'usage_events-7d.csv'
        Write-Utf8File $pyPath $py
        try {
            & $python $pyPath $dbPath $csvPath 2>$null | Out-Null
            if (Test-Path $csvPath) {
                Write-Ok "usage_events-7d.csv 已写出（$([math]::Round((Get-Item $csvPath).Length / 1KB)) KB）"
            } else {
                Write-Warn 'usage_events 导出失败，跳过（不影响主流程）'
            }
        } catch {
            Write-Warn "usage_events 导出失败: $($_.Exception.Message)"
        } finally {
            Remove-Item $pyPath -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Note '未检测到可用的 Python，跳过 usage_events 导出（不影响主流程）'
    }
}

# ---------------------------------------------------------------- 6. 打包

Write-Step '6/6 打包'

$zipPath = Join-Path $OutDir "ai-switch-diag-$stamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
$zipSizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)

Write-Host ''
Write-Ok "诊断包已生成: $zipPath  ($zipSizeMb MB)"
Write-Host ''
Write-Host '  请把这个 zip 发回来。' -ForegroundColor Yellow
Write-Host '  注意：包内含四阶段报文，其中 upstream_request / client_request' -ForegroundColor Yellow
Write-Host '  会包含你这几轮的对话内容，介意的话可以先看一眼 live-log.json 再决定。' -ForegroundColor Yellow
Write-Host ''
