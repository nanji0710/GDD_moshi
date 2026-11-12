<#
.SYNOPSIS
    把 prototype/ 部署到 Cloudflare Pages（Direct Upload）。
    不依赖 wrangler / npm / PowerShell 7 —— 只用系统自带的 curl.exe。

.DESCRIPTION
    需要两个环境变量：
        CF_API_TOKEN   —— Cloudflare API 令牌
                          权限：Account → Cloudflare Pages → Edit
                          创建：https://dash.cloudflare.com/profile/api-tokens
        CF_ACCOUNT_ID  —— 账户 ID（控制台 Workers & Pages 概览页右侧可复制）

.EXAMPLE
    $env:CF_API_TOKEN  = "xxxxxxxx"
    $env:CF_ACCOUNT_ID = "yyyyyyyy"
    powershell -ExecutionPolicy Bypass -File tools\deploy-cloudflare.ps1

.EXAMPLE
    # 换项目名
    powershell -ExecutionPolicy Bypass -File tools\deploy-cloudflare.ps1 -Project my-train
#>
param(
    [string]$Project = 'last-train',
    [string]$Dir     = 'prototype',
    [string]$Token   = $env:CF_API_TOKEN,
    [string]$Account = $env:CF_ACCOUNT_ID
)

$ErrorActionPreference = 'Stop'

if (-not $Token -or -not $Account) {
    Write-Host ''
    Write-Host '缺少凭据。先设置两个环境变量：' -ForegroundColor Yellow
    Write-Host '  $env:CF_API_TOKEN  = "你的 API 令牌"' -ForegroundColor Gray
    Write-Host '  $env:CF_ACCOUNT_ID = "你的账户 ID"' -ForegroundColor Gray
    Write-Host ''
    Write-Host '令牌创建：https://dash.cloudflare.com/profile/api-tokens' -ForegroundColor Gray
    Write-Host '  → Create Token → Custom token → 权限 Account / Cloudflare Pages / Edit' -ForegroundColor Gray
    exit 1
}

if (-not (Test-Path $Dir)) { throw "找不到目录：$Dir" }
$root = (Resolve-Path $Dir).Path.TrimEnd('\')
$api  = "https://api.cloudflare.com/client/v4/accounts/$Account/pages/projects"

function Invoke-CfJson([string]$Method, [string]$Url, [string]$JsonBody) {
    $args = @('-s', '-X', $Method, $Url, '-H', "Authorization: Bearer $Token")
    if ($JsonBody) { $args += @('-H', 'Content-Type: application/json', '--data-binary', $JsonBody) }
    $out = & curl.exe @args
    try { return ($out | ConvertFrom-Json) } catch { return $null }
}

# 1) 项目不存在就建（已存在会返回 400，忽略）
Write-Host "→ 确认项目 $Project ..." -ForegroundColor Cyan
$created = Invoke-CfJson 'POST' $api (@{ name = $Project; production_branch = 'main' } | ConvertTo-Json -Compress)
if ($created -and $created.success) { Write-Host '  已创建项目' -ForegroundColor Green }
else { Write-Host '  项目已存在，继续上传' -ForegroundColor DarkGray }

# 2) 收集文件（键 = 站点内相对路径，正斜杠）
$files = @()
Get-ChildItem -Recurse -File $root | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    if ($rel -like 'tools/*') { return }          # 测试脚本不进站点
    $files += ,@($rel, $_.FullName)
}
if ($files.Count -eq 0) { throw "目录里没有可发布的文件：$Dir" }
$kb = (($files | ForEach-Object { (Get-Item $_[1]).Length } | Measure-Object -Sum).Sum) / 1KB
Write-Host ("→ 上传 {0} 个文件（{1:N0} KB）..." -f $files.Count, $kb) -ForegroundColor Cyan

# 3) 组装 curl 的 -F 参数并部署
$curlArgs = @('-s', '-X', 'POST', "$api/$Project/deployments", '-H', "Authorization: Bearer $Token")
foreach ($f in $files) { $curlArgs += @('-F', ("{0}=@{1}" -f $f[0], $f[1])) }

$raw = & curl.exe @curlArgs
$resp = $null
try { $resp = $raw | ConvertFrom-Json } catch { }

if ($resp -and $resp.success) {
    Write-Host ''
    Write-Host '部署成功' -ForegroundColor Green
    Write-Host ("  地址：{0}" -f $resp.result.url) -ForegroundColor Green
    foreach ($a in $resp.result.aliases) { Write-Host ("  别名：{0}" -f $a) -ForegroundColor DarkGray }
    Write-Host ''
    Write-Host '以后每次发版重跑这条命令即可。' -ForegroundColor Gray
} else {
    Write-Host '部署失败' -ForegroundColor Red
    if ($resp -and $resp.errors) {
        foreach ($e in $resp.errors) { Write-Host ("  [{0}] {1}" -f $e.code, $e.message) -ForegroundColor Red }
    } else {
        Write-Host ('  ' + $raw) -ForegroundColor Red
    }
    exit 1
}
