$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.runtime'
$archive = Join-Path $runtime 'go2rtc_win64.zip'
$version = '1.9.15'
$sha256 = '5b448fc90f15c925406d8da0984301985e385050222c1c2bbdf0a76fe4b1e9cb'

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/AlexxIT/go2rtc/releases/download/v$version/go2rtc_win64.zip" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sha256) {
    throw "SHA-256 mismatch for $archive"
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entry = $zip.GetEntry('go2rtc.exe')
    if (-not $entry) { throw 'The verified archive does not contain go2rtc.exe.' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime 'go2rtc.exe'), $true)
} finally {
    $zip.Dispose()
}
& (Join-Path $runtime 'go2rtc.exe') -version
