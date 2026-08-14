param(
  [switch]$ConfirmSpend,
  [string]$Origin = "https://patternproof-nu.vercel.app"
)

$ErrorActionPreference = "Stop"

if (-not $ConfirmSpend) {
  throw "This production acceptance consumes exactly 10 YouCam units. Re-run with -ConfirmSpend."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
$bodyPath = Join-Path $projectRoot "test-assets\qa-body-front.jpg"
$referencePath = Join-Path $projectRoot "test-assets\qa-garment-worn.jpg"

foreach ($requiredPath in @($envPath, $bodyPath, $referencePath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required acceptance input is missing: $requiredPath"
  }
}

function Read-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath $envPath | Where-Object {
    $_ -match "^\s*$([regex]::Escape($Name))="
  } | Select-Object -Last 1
  if (-not $line) { throw "Missing $Name in .env.local." }
  $value = ($line -split "=", 2)[1].Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if (-not $value) { throw "$Name is blank in .env.local." }
  return $value
}

$supabaseUrl = (Read-EnvValue "NEXT_PUBLIC_SUPABASE_URL").TrimEnd('/')
$anonKey = Read-EnvValue "NEXT_PUBLIC_SUPABASE_ANON_KEY"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$commonHeaders = @{ Origin = $Origin; Accept = "application/json" }

function Convert-SafeError([System.Management.Automation.ErrorRecord]$Record) {
  $message = $Record.Exception.Message
  $details = $Record.ErrorDetails.Message
  if ($details) {
    try {
      $parsed = $details | ConvertFrom-Json
      if ($parsed.error) { return [string]$parsed.error }
    } catch { }
  }
  return $message
}

function Invoke-AppJson(
  [ValidateSet("GET", "POST", "PATCH", "DELETE")][string]$Method,
  [string]$Path,
  [object]$Body = $null
) {
  $parameters = @{
    Uri = "$Origin$Path"
    Method = $Method
    Headers = $commonHeaders
    WebSession = $session
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $parameters.ContentType = "application/json"
    $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress
  }
  try {
    $response = Invoke-WebRequest @parameters
  } catch {
$safePath = $Path -replace '^/s/[^/]+', '/s/[redacted]' -replace '^/api/share/[^/]+', '/api/share/[redacted]'
    throw "$Method $safePath failed: $(Convert-SafeError $_)"
  }
  $data = $null
  if ($response.Content) { $data = $response.Content | ConvertFrom-Json }
  return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Data = $data }
}

function Upload-SignedImage([object]$Upload, [string]$FilePath) {
  $encodedPath = (($Upload.path -split '/') | ForEach-Object {
    [uri]::EscapeDataString($_)
  }) -join '/'
  $encodedToken = [uri]::EscapeDataString([string]$Upload.token)
  $uri = "$supabaseUrl/storage/v1/object/upload/sign/brief-images/$encodedPath`?token=$encodedToken"
  $headers = @{
    apikey = $anonKey
    Authorization = "Bearer $anonKey"
    "x-upsert" = "false"
    "cache-control" = "max-age=0"
  }
  try {
    $response = Invoke-WebRequest -Uri $uri -Method PUT -Headers $headers -ContentType "image/jpeg" -InFile $FilePath -UseBasicParsing
  } catch {
    throw "Private signed upload failed: $(Convert-SafeError $_)"
  }
  if ([int]$response.StatusCode -notin @(200, 201)) {
    throw "Private signed upload returned HTTP $($response.StatusCode)."
  }
}

function Wait-Job([string]$Path, [string]$Label) {
  $deadline = [DateTime]::UtcNow.AddMinutes(10)
  while ([DateTime]::UtcNow -lt $deadline) {
    $result = Invoke-AppJson -Method GET -Path $Path
    $status = [string]$result.Data.status
    if ($status -eq "success") {
      Write-Host "PASS  $Label"
      return $result.Data
    }
    if ($status -in @("error", "timeout", "retry")) {
      throw "$Label ended with status '$status'. No automatic retry was attempted."
    }
    Start-Sleep -Seconds 4
  }
  throw "$Label did not complete within 10 minutes. No automatic retry was attempted."
}

$startedAt = [DateTime]::UtcNow
$briefId = $null
$revisionId = $null
$approved = $false

Write-Host "PatternProof production evidence-chain acceptance"
Write-Host "Rights-cleared synthetic inputs; exact provider budget: 10 units; retries: disabled."

try {
  $guest = Invoke-AppJson -Method POST -Path "/api/auth/guest" -Body @{}
  if ($guest.Data.ready -ne $true) { throw "Guest workspace was not established." }
  Write-Host "PASS  Isolated guest workspace"

  $intake = Invoke-AppJson -Method POST -Path "/api/brief/intake/session" -Body @{
    customerLabel = "Synthetic evidence-chain acceptance"
    shopName = "PatternProof QA"
    garmentCategory = "dresses"
    bodyProcessingConfirmed = $true
    rightsConfirmed = $true
  }
  $briefId = [string]$intake.Data.briefId
  $revisionId = [string]$intake.Data.revisionId
  if (-not $briefId -or -not $revisionId) { throw "Intake identifiers were not returned." }

  Upload-SignedImage -Upload $intake.Data.uploads.body -FilePath $bodyPath
  Upload-SignedImage -Upload $intake.Data.uploads.reference -FilePath $referencePath
  $finalized = Invoke-AppJson -Method POST -Path "/api/brief/intake/finalize" -Body @{
    briefId = $briefId
    revisionId = $revisionId
    bodyUploadPath = [string]$intake.Data.uploads.body.path
    referenceUploadPath = [string]$intake.Data.uploads.reference.path
  }
  if ($finalized.Data.ready -ne $true) { throw "Private intake did not reach ready state." }
  Write-Host "PASS  Consent-first normalized private intake"

  $background = Invoke-AppJson -Method POST -Path "/api/youcam/evidence" -Body @{
    revisionId = $revisionId
    feature = "background_removal"
  }
  Wait-Job -Path "/api/youcam/evidence/$($background.Data.jobId)" -Label "YouCam Background Removal reference rescue" | Out-Null

  $render = Invoke-AppJson -Method POST -Path "/api/youcam/render" -Body @{
    revisionId = $revisionId
    garmentCategory = "full_body"
  }
  Wait-Job -Path "/api/youcam/status/$($render.Data.jobId)" -Label "YouCam Clothes VTO V3 body-specific preview" | Out-Null

  $templates = Invoke-AppJson -Method GET -Path "/api/youcam/fabric/templates"
  $template = @($templates.Data.templates) | Select-Object -First 1
  if (-not $template -or -not $template.id) { throw "YouCam returned no predefined Fabric VTO direction." }
  $fabric = Invoke-AppJson -Method POST -Path "/api/youcam/evidence" -Body @{
    revisionId = $revisionId
    feature = "fabric_vto"
    templateId = [string]$template.id
  }
  Wait-Job -Path "/api/youcam/evidence/$($fabric.Data.jobId)" -Label "YouCam Fabric VTO predefined direction" | Out-Null

  $requirement = Invoke-AppJson -Method POST -Path "/api/brief/$briefId/requirements" -Body @{
    label = "Preserve the wrap neckline and front edge"
  }
  $requirementId = [string]$requirement.Data.requirement.id
  if (-not $requirementId) { throw "Requirement was not created." }
  $decision = Invoke-AppJson -Method PATCH -Path "/api/brief/$briefId/requirements/$requirementId" -Body @{
    status = "as_shown"
  }
  if ([string]$decision.Data.requirement.status -ne "as_shown") {
    throw "Human feasibility decision was not stored."
  }
  Write-Host "PASS  Human construction veto gate"

  $share = Invoke-AppJson -Method POST -Path "/api/brief/$briefId/share-token" -Body @{}
  if (-not $share.Data.sharePath -or -not $share.Data.snapshotSha256) {
    throw "Frozen customer-review proof was not created."
  }
  $approvalApiPath = ([string]$share.Data.sharePath).Replace("/s/", "/api/share/") + "/approve"
  $approval = Invoke-AppJson -Method POST -Path $approvalApiPath -Body @{
    revisionId = [string]$share.Data.revisionId
    snapshotSha256 = [string]$share.Data.snapshotSha256
    acknowledgedAdjustmentIds = @()
  }
  if ($approval.Data.approved -ne $true) { throw "Customer approval did not lock the revision." }
  $approved = $true
  Write-Host "PASS  Frozen customer consent and immutable approval"

  $motion = Invoke-AppJson -Method POST -Path "/api/youcam/evidence" -Body @{
    revisionId = $revisionId
    feature = "approved_motion"
  }
  Wait-Job -Path "/api/youcam/evidence/$($motion.Data.jobId)" -Label "YouCam Image-to-Video V2 post-approval motion proof" | Out-Null

  $ownerView = Invoke-AppJson -Method GET -Path "/api/brief/$briefId"
  if (
    $ownerView.Data.revision.referenceRescued -ne $true -or
    -not $ownerView.Data.revision.fabricDirection -or
    -not $ownerView.Data.revision.motionUrl
  ) {
    throw "The owner record did not expose every completed evidence artifact."
  }
  Write-Host "PASS  Four-feature provenance visible in owner record"

  $erasure = Invoke-AppJson -Method DELETE -Path "/api/brief/$briefId/customer-photo"
  if ($erasure.Data.erased -ne $true) {
    throw "Customer-photo privacy exit was not completed."
  }
  Write-Host "PASS  Customer-photo privacy exit"

  $elapsed = [math]::Round(([DateTime]::UtcNow - $startedAt).TotalSeconds, 1)
  Write-Host "PASS  Production chain complete: 4 YouCam jobs, 10 units, $elapsed seconds"
} catch {
  if ($approved -and $briefId) {
    try { Invoke-AppJson -Method DELETE -Path "/api/brief/$briefId/customer-photo" | Out-Null } catch { }
  }
  throw
}
