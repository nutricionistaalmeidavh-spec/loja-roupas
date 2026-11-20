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
# Preserve the lockfile-pinned esbuild optional native package on Windows.
# pnpm deploy --legacy does not always materialize it with tsx.
$store=Join-Path $repo 'node_modules/.pnpm'
$esb=@(Get-ChildItem -LiteralPath $store -Directory -Filter 'esbuild@*')
$native=@(Get-ChildItem -LiteralPath $store -Directory -Filter '@esbuild+win32-x64@*')
if($esb.Count -ne 1 -or $native.Count -ne 1){throw 'Pinned esbuild packages not found'}
$src=Join-Path $esb[0].FullName 'node_modules/esbuild'
$nativeSrc=Join-Path $native[0].FullName 'node_modules/@esbuild/win32-x64'
if(!(Test-Path (Join-Path $src 'lib/main.js')) -or !(Test-Path (Join-Path $nativeSrc 'esbuild.exe'))){throw 'esbuild package incomplete'}
New-Item -ItemType Directory -Force -Path (Join-Path $api 'node_modules/@esbuild') | Out-Null
Copy-Item -Recurse -LiteralPath $src -Destination (Join-Path $api 'node_modules/esbuild')
Copy-Item -Recurse -LiteralPath $nativeSrc -Destination (Join-Path $api 'node_modules/@esbuild/win32-x64')


# pnpm deploy --legacy pode não materializar dependências transitivas CJS do pg.
# Importar apenas as versões fixadas do pnpm store construído no CI, sem download no cliente.
$requiredPgModules=@('pg-cloudflare','pg-connection-string','pg-pool','pg-protocol',
 'pg-types','pgpass','pg-int8','postgres-array','postgres-bytea','postgres-date',
 'postgres-interval','split2','xtend')
foreach($name in $requiredPgModules) {
 $matches=@(Get-ChildItem -LiteralPath $store -Directory -Filter ($name+'@*'))
 if($matches.Count -ne 1){throw "Dependency missing or ambiguous in pinned store: $name"}
 $source=Join-Path $matches[0].FullName "node_modules/$name"
 if(!(Test-Path -LiteralPath $source)){throw "Dependency missing from store: $name"}
 $target=Join-Path $api "node_modules/$name"
 if(!(Test-Path -LiteralPath $target)){
  Copy-Item -Recurse -Force -LiteralPath $source -Destination $target
 }
}
# Falhar no CI antes de compilar o instalador se módulos essenciais faltarem.
Push-Location $api
try {
 node -e "require('pg');require('fastify');require('sharp')"
 if($LASTEXITCODE -ne 0){throw 'Packaged API missing runtime dependencies'}
}finally{Pop-Location}

# postgres-interval@1.2.0 depends on xtend. In CI the repository node_modules
# can mask a missing module, while the installed desktop has no parent workspace.
if(!(Test-Path (Join-Path $api 'node_modules/xtend/immutable.js')) -and
   !(Test-Path (Join-Path $api 'node_modules/xtend/index.js'))){
 throw 'Isolated PostgreSQL driver dependency xtend is missing from installed runtime'
}
if(!(Test-Path (Join-Path $api 'node_modules/@loja/domain'))){throw 'Packaged domain missing'}
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'apps/web/dist') -Destination (Join-Path $runtime 'web')
Copy-Item -Recurse -LiteralPath (Join-Path $repo 'infra/sql') -Destination (Join-Path $resources 'infra/sql')
if(!(Test-Path (Join-Path $runtime 'web/index.html'))){throw 'Web bundle missing'}
Write-Host 'Windows one-computer runtime ready: PostgreSQL + API + UI'
