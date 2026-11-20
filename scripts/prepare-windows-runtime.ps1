$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resources=Join-Path $repo 'dist/desktop-win32-x64/resources'
$runtime=Join-Path $resources 'runtime'
New-Item -ItemType Directory -Force -Path $runtime|Out-Null

# Community PostgreSQL ZIP from EDB, version and integrity pinned; no runtime download or payment.
$url='https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip'
$sha='A2CD8A774389347B70BE7748AC4A37EF43CB6EE539C5FC3E85AE264B15E4A04C'
$zip=Join-Path $env:RUNNER_TEMP 'loja-postgresql-17.12-1.zip'
Invoke-WebRequest -Uri $url -OutFile $zip -MaximumRedirection 6
$actual=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
if($actual -ne $sha){throw "PostgreSQL integrity mismatch $actual"}
$unpack=Join-Path $env:RUNNER_TEMP 'loja-postgresql-unpack'
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
$pgSource=Join-Path $unpack 'pgsql'
foreach($name in @('initdb.exe','pg_ctl.exe','psql.exe','createdb.exe','postgres.exe')){
 if(!(Test-Path (Join-Path $pgSource "bin/$name"))){throw "Missing PostgreSQL $name"}
}
Copy-Item -Recurse -LiteralPath $pgSource -Destination (Join-Path $runtime 'postgres')
Write-Host 'PostgreSQL portable component verified'

# Isolated production API deployment including tsx runtime and workspace packages.
Push-Location $repo
try {
 pnpm --filter '@loja/api' deploy --legacy (Join-Path $repo 'dist/desktop-win32-x64/resources/runtime/api')
 if($LASTEXITCODE -ne 0){throw 'pnpm deploy failed'}
}finally{Pop-Location}
$api=Join-Path $runtime 'api'
if(!(Test-Path (Join-Path $api 'src/main.ts'))){throw 'Packaged API missing'}
if(!(Test-Path (Join-Path $api 'node_modules/tsx'))){throw 'Packaged TS runtime missing'}
if(!(Test-Path (Join-Path $api 'node_modules/@loja/domain'))){throw 'Packaged domain missing'}
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'apps/web/dist') -Destination (Join-Path $runtime 'web')
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'infra/sql') -Destination (Join-Path $resources 'infra/sql')
if(!(Test-Path (Join-Path $runtime 'web/index.html'))){throw 'Web bundle missing'}
Write-Host 'Windows one-computer runtime ready: PostgreSQL + API + UI'
