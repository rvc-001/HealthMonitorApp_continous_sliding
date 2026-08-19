param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\.m2repo'),
  [string[]]$Seeds = @(
    'com.android.tools.build:gradle:8.13.0',
    'org.junit:junit-bom:5.10.2',
    'com.google.protobuf:protobuf-bom:3.25.5',
    'org.bouncycastle:bcutil-jdk18on:1.79',
    'jakarta.xml.bind:jakarta.xml.bind-api:2.3.2',
    'org.glassfish.jaxb:txw2:2.3.2',
    'com.sun.istack:istack-commons-runtime:3.0.8',
    'org.jvnet.staxex:stax-ex:1.8.1',
    'com.sun.xml.fastinfoset:FastInfoset:1.2.16',
    'org.checkerframework:checker-qual:3.43.0',
    'com.google.j2objc:j2objc-annotations:3.0.0',
    'commons-codec:commons-codec:1.11',
    'io.netty:netty-parent:4.1.110.Final',
    'io.netty:netty-common:4.1.110.Final',
    'io.netty:netty-buffer:4.1.110.Final',
    'io.netty:netty-resolver:4.1.110.Final',
    'io.netty:netty-transport:4.1.110.Final',
    'io.netty:netty-codec:4.1.110.Final',
    'io.netty:netty-handler:4.1.110.Final',
    'io.netty:netty-codec-http:4.1.110.Final',
    'io.netty:netty-codec-http2:4.1.110.Final',
    'io.netty:netty-codec-socks:4.1.110.Final',
    'io.netty:netty-handler-proxy:4.1.110.Final',
    'io.netty:netty-transport-native-unix-common:4.1.110.Final',
    'androidx.appcompat:appcompat:1.7.1',
    'androidx.coordinatorlayout:coordinatorlayout:1.3.0',
    'androidx.core:core-splashscreen:1.2.0',
    'androidx.core:core:1.17.0',
    'androidx.activity:activity:1.11.0',
    'androidx.fragment:fragment:1.8.9',
    'androidx.webkit:webkit:1.14.0',
    'org.apache.cordova:framework:14.0.1'
  )
)

$ErrorActionPreference = 'Stop'

$repoBases = @(
  'https://dl.google.com/dl/android/maven2',
  'https://repo.maven.apache.org/maven2'
)

function Get-RepoPath([string]$groupId, [string]$artifactId, [string]$version, [string]$extension) {
  $groupPath = $groupId.Replace('.', '/')
  return Join-Path $OutputRoot (Join-Path $groupPath (Join-Path $artifactId (Join-Path $version "$artifactId-$version.$extension")))
}

function Ensure-Parent([string]$path) {
  $parent = Split-Path -Parent $path
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Try-Download([string]$url, [string]$outFile) {
  if (Test-Path $outFile) {
    return $true
  }

  try {
    Ensure-Parent $outFile
    Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing | Out-Null
    return $true
  } catch {
    if (Test-Path $outFile) {
      Remove-Item $outFile -Force -ErrorAction SilentlyContinue
    }
    return $false
  }
}

function Resolve-Artifacts([string]$groupId, [string]$artifactId, [string]$version) {
  $pomPath = Get-RepoPath $groupId $artifactId $version 'pom'
  if (-not (Test-Path $pomPath)) {
    foreach ($base in $repoBases) {
      $url = "$base/$($groupId.Replace('.', '/'))/$artifactId/$version/$artifactId-$version.pom"
      if (Try-Download $url $pomPath) { break }
    }
  }

  if (-not (Test-Path $pomPath)) {
    return $null
  }

  foreach ($extension in @('jar', 'aar')) {
    $artifactPath = Get-RepoPath $groupId $artifactId $version $extension
    if (Test-Path $artifactPath) {
      break
    }
    foreach ($base in $repoBases) {
      $url = "$base/$($groupId.Replace('.', '/'))/$artifactId/$version/$artifactId-$version.$extension"
      if (Try-Download $url $artifactPath) { break }
    }
    if (Test-Path $artifactPath) {
      break
    }
  }

  return $pomPath
}

function Get-Dependencies([string]$pomPath) {
  [xml]$xml = Get-Content $pomPath -Raw
  $nsMgr = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $nsMgr.AddNamespace('m', 'http://maven.apache.org/POM/4.0.0')

  $deps = @()

  $parent = $xml.SelectSingleNode('/m:project/m:parent', $nsMgr)
  if ($parent -and $parent.groupId -and $parent.artifactId -and $parent.version -and $parent.version.Trim()) {
    $deps += [pscustomobject]@{
      groupId = $parent.groupId.Trim()
      artifactId = $parent.artifactId.Trim()
      version = $parent.version.Trim()
    }
  }

  foreach ($dep in $xml.SelectNodes('/m:project/m:dependencyManagement/m:dependencies/m:dependency', $nsMgr)) {
    $scope = $dep.scope
    $type = $dep.type
    if ($scope -and $scope.Trim().ToLowerInvariant() -ne 'import') { continue }
    if ($type -and $type.Trim().ToLowerInvariant() -ne 'pom') { continue }
    if (-not $dep.groupId -or -not $dep.artifactId -or -not $dep.version -or -not $dep.version.Trim()) { continue }
    $deps += [pscustomobject]@{
      groupId = $dep.groupId.Trim()
      artifactId = $dep.artifactId.Trim()
      version = $dep.version.Trim()
    }
  }

  foreach ($dep in $xml.SelectNodes('/m:project/m:dependencies/m:dependency', $nsMgr)) {
    $scope = $dep.scope
    if ($scope -and @('test','provided','system') -contains $scope) { continue }
    $optional = $dep.optional
    if ($optional -and $optional.Trim().ToLowerInvariant() -eq 'true') { continue }
    if (-not $dep.groupId -or -not $dep.artifactId -or -not $dep.version -or -not $dep.version.Trim()) { continue }
    $version = $dep.version.Trim()
    if ($version -eq '${project.version}') {
      $version = $xml.project.version
    }
    $deps += [pscustomobject]@{
      groupId = $dep.groupId.Trim()
      artifactId = $dep.artifactId.Trim()
      version = $version
    }
  }
  return $deps
}

if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}

$queue = [System.Collections.Generic.Queue[object]]::new()
foreach ($seed in $Seeds) {
  $parts = $seed.Split(':')
  $queue.Enqueue([pscustomobject]@{ groupId = $parts[0]; artifactId = $parts[1]; version = $parts[2] })
}

$seen = New-Object 'System.Collections.Generic.HashSet[string]'

while ($queue.Count -gt 0) {
  $coord = $queue.Dequeue()
  if (-not $coord.version -or -not $coord.version.ToString().Trim()) {
    continue
  }
  $key = "$($coord.groupId):$($coord.artifactId):$($coord.version)"
  if ($seen.Contains($key)) { continue }
  $seen.Add($key) | Out-Null

  $pomPath = Resolve-Artifacts $coord.groupId $coord.artifactId $coord.version
  if (-not $pomPath) {
    Write-Host "Skipping $key"
    continue
  }

  Write-Host "Mirrored $key"

  foreach ($dep in Get-Dependencies $pomPath) {
    $depKey = "$($dep.groupId):$($dep.artifactId):$($dep.version)"
    if (-not $seen.Contains($depKey)) {
      $queue.Enqueue($dep)
    }
  }
}
