param(
    [Parameter(Mandatory)][ValidatePattern('^v\d+\.\d+\.\d+$')][string]$Tag,
    [Parameter(Mandatory)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
if ($Tag -cne "v$($manifest.version)") { throw 'The tag must match package.json.' }
$output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
$name = "local-camera-wall-$($manifest.version)-windows-x64"
$zip = Join-Path $output "$name.zip"
$checksum = Join-Path $output "$name.sha256"
$verify = Join-Path $output 'verify'
if ((Test-Path -LiteralPath $verify) -or (Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $checksum)) {
    throw 'Use a fresh output directory for the package.'
}
$files = @(
    'README.md', 'CHANGELOG.md', 'SECURITY.md', 'package.json', 'package-lock.json',
    'start.cmd', 'setup.ps1', 'dpapi.ps1', 'server.mjs', 'video-engine.mjs',
    'camera-store.mjs', 'backup.mjs', 'settings-format.mjs', 'public', 'web',
    'docs', 'scripts/smoke.mjs', 'test'
)

git -C $repo archive --format=zip "--prefix=$name/" "--output=$zip" HEAD -- @files
if ($LASTEXITCODE -ne 0) { throw 'Could not package the committed files.' }
"$((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant())  $name.zip" |
    Set-Content -LiteralPath $checksum -Encoding ascii

Expand-Archive -LiteralPath $zip -DestinationPath $verify
Push-Location -LiteralPath (Join-Path $verify $name)
try {
    npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Installing the extracted package failed.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Building the extracted package failed.' }
    powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\setup.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Setting up go2rtc from the extracted package failed.' }
    node scripts/smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Starting the extracted package failed.' }
} finally {
    Pop-Location
}
