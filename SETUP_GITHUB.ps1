[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [string]$Owner = "muhumuza684",
  [string]$ProjectPath = "C:\PowerBI\FFLEXAT",
  [switch]$CreateRemote,
  [switch]$Push
)
$ErrorActionPreference = "Stop"
$RepoName = "FFLEXAT-powerbi-visual"
$ExpectedName = "FFLEXAT"
if (-not (Test-Path -LiteralPath $ProjectPath)) { throw "Project path not found: $ProjectPath" }
Set-Location -LiteralPath $ProjectPath
if (-not (Test-Path -LiteralPath .\package.json)) { throw "package.json missing" }
if (-not (Test-Path -LiteralPath .\pbiviz.json)) { throw "pbiviz.json missing" }
$meta = Get-Content .\pbiviz.json -Raw | ConvertFrom-Json
if ($meta.visual.name -ne $ExpectedName -or $meta.visual.displayName -ne $ExpectedName) { throw "Identity mismatch: expected $ExpectedName" }
if (-not (Test-Path -LiteralPath .\.github\workflows\build.yml)) { throw "Workflow missing; copy the generated build.yml first" }

if (-not (Test-Path -LiteralPath .\.git)) { git init -b main }
git add .
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw "Whitespace check failed" }
if ((git diff --cached --name-only | Select-String '\.(bak|pbix)$|node_modules|\.batch-backup-' -Quiet)) { throw "Unsafe file staged" }
if (-not (git diff --cached --quiet)) { git commit -m "Initial FFLEXAT Power BI visual" }

if ($CreateRemote) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) is required for -CreateRemote" }
  gh repo view "$Owner/$RepoName" 2>$null
  if ($LASTEXITCODE -ne 0) { gh repo create "$Owner/$RepoName" --public --description "Independent FFLEXAT Power BI custom visual" --source . --remote origin --push }
  else { if (-not (git remote get-url origin 2>$null)) { git remote add origin "https://github.com/$Owner/$RepoName.git" } }
}
if ($Push) {
  if (-not $CreateRemote -and -not (git remote get-url origin 2>$null)) { throw "No origin configured; use -CreateRemote or add origin explicitly" }
  if ($PSCmdlet.ShouldProcess("origin/main", "Push FFLEXAT")) { git push -u origin main }
}
Write-Host "Prepared FFLEXAT. Remote creation/push are opt-in switches." -ForegroundColor Green
