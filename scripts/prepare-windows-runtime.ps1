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
$pgDest=Join-Path $runtime 'postgres'
New-Item -ItemType Directory -Force -Path $pgDest|Out-Null
# Excluir pgAdmin, documentação e SDK: PostgreSQL necessita apenas bin/lib/share.
foreach($folder in @('bin','lib','share')){
 $source=Join-Path $pgSource $folder
 if(!(Test-Path -LiteralPath $source)){throw "PostgreSQL folder missing: $folder"}
 Copy-Item -Recurse -LiteralPath $source -Destination (Join-Path $pgDest $folder)
}

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
# pnpm deploy --legacy pode deixar a dependência transitiva esbuild de tsx de fora.
# Copiar os pacotes OSS fixados no lockfile (incluindo o binário nativo Windows).
# Nenhuma instalação ou download ocorre no computador do cliente.
$esbuildVersion='0.28.2'
$pnpmModules=Join-Path $repo 'node_modules/.pnpm'
$esbuildSource=Join-Path $pnpmModules "esbuild@$esbuildVersion/node_modules/esbuild"
$esbuildNative=Join-Path $pnpmModules "@esbuild+win32-x64@$esbuildVersion/node_modules/@esbuild/win32-x64"
if(!(Test-Path (Join-Path $esbuildSource 'lib/main.js'))){throw 'esbuild runtime missing from pnpm store'}
if(!(Test-Path (Join-Path $esbuildNative 'esbuild.exe'))){throw 'esbuild Windows binary missing from pnpm store'}
Copy-Item -Recurse -Force -LiteralPath $esbuildSource -Destination (Join-Path $api 'node_modules/esbuild')
$esbuildScope=Join-Path $api 'node_modules/@esbuild'
New-Item -ItemType Directory -Force -Path $esbuildScope|Out-Null
Copy-Item -Recurse -Force -LiteralPath $esbuildNative -Destination (Join-Path $esbuildScope 'win32-x64')
if(!(Test-Path (Join-Path $api 'node_modules/@esbuild/win32-x64/esbuild.exe'))){throw 'Bundled esbuild binary missing'}

if(!(Test-Path (Join-Path $api 'node_modules/@loja/domain'))){throw 'Packaged domain missing'}
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'apps/web/dist') -Destination (Join-Path $runtime 'web')
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'infra/sql') -Destination (Join-Path $resources 'infra/sql')
if(!(Test-Path (Join-Path $runtime 'web/index.html'))){throw 'Web bundle missing'}
Write-Host 'Windows one-computer runtime ready: PostgreSQL + API + UI'
