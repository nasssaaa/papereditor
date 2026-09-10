param(
    [Parameter(Mandatory = $true)][string]$NginxDirectory,
    [string]$PaperEditorDirectory = 'C:\papereditor'
)
$ErrorActionPreference = 'Stop'
$taskNginxExe = Join-Path $NginxDirectory 'nginx.exe'
$taskMainConfig = Join-Path $NginxDirectory 'conf\nginx.conf'
$taskGlobalConfig = Join-Path $PaperEditorDirectory 'nginx-papereditor.conf'
$taskRouteConfig = Join-Path $PaperEditorDirectory 'nginx-papereditor-route.conf'
foreach ($taskPath in @($taskGlobalConfig, $taskRouteConfig)) {
    if (!(Test-Path -LiteralPath $taskPath)) { throw 'Upload both Paper Editor nginx configuration files first.' }
}
$taskOriginal = [IO.File]::ReadAllText($taskMainConfig)
$taskUpdated = $taskOriginal
$taskGlobalInclude = '    include "' + ($taskGlobalConfig -replace '\\', '/') + '";'
$taskRouteInclude = '        include "' + ($taskRouteConfig -replace '\\', '/') + '";'
$taskBackup = $taskMainConfig + '.papereditor-backup-' + (Get-Date -Format 'yyyyMMddHHmmss')
Copy-Item -LiteralPath $taskMainConfig -Destination $taskBackup
if (!$taskUpdated.Contains($taskGlobalInclude.Trim())) {
    if ([regex]::Matches($taskUpdated, '(?m)^http\s*\{').Count -ne 1) { throw 'Expected exactly one top-level http block.' }
    $taskUpdated = [regex]::Replace($taskUpdated, '(?m)^(http\s*\{)', ('$1' + [Environment]::NewLine + $taskGlobalInclude))
}
if (!$taskUpdated.Contains($taskRouteInclude.Trim())) {
    $taskBlocks = [regex]::Matches($taskUpdated, '(?ms)^    server\s*\{.*?^    \}')
    $taskCandidates = @($taskBlocks | Where-Object { $_.Value -match 'listen\s+443\s+ssl' -and $_.Value -match 'server_name\s+fblerp\.com\s+www\.fblerp\.com;' })
    if ($taskCandidates.Count -ne 1) { throw 'Expected exactly one fblerp.com HTTPS server block.' }
    $taskBlock = $taskCandidates[0]
    if ($taskBlock.Value -match 'location[^\r\n]*/papereditor') { throw 'An existing Paper Editor route needs review before modification.' }
    $taskNewBlock = [regex]::Replace($taskBlock.Value, '(server_name\s+fblerp\.com\s+www\.fblerp\.com;)', ('$1' + [Environment]::NewLine + $taskRouteInclude))
    $taskUpdated = $taskUpdated.Substring(0, $taskBlock.Index) + $taskNewBlock + $taskUpdated.Substring($taskBlock.Index + $taskBlock.Length)
}
[IO.File]::WriteAllText($taskMainConfig, $taskUpdated, (New-Object Text.UTF8Encoding($false)))
# nginx writes successful validation to stderr; inspect the exit code explicitly.
$ErrorActionPreference = 'Continue'
& $taskNginxExe -p ($NginxDirectory + '\') -t
$taskTestExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($taskTestExit -ne 0) {
    Copy-Item -LiteralPath $taskBackup -Destination $taskMainConfig -Force
    throw 'Nginx validation failed; original main configuration restored.'
}
$ErrorActionPreference = 'Continue'
& $taskNginxExe -p ($NginxDirectory + '\') -s reload
$taskReloadExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($taskReloadExit -ne 0) { throw 'Nginx reload failed; inspect the error log.' }
Write-Output 'Paper Editor HTTPS path loaded: /papereditor/'
