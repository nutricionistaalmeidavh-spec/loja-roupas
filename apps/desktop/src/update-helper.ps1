param(
 [Parameter(Mandatory=$true)][int]$ParentPid,
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][string]$ExpectedVersion,
 [Parameter(Mandatory=$true)][string]$InstallDir,
 [Parameter(Mandatory=$true)][string]$RollbackDir,
 [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Save-Result($ok,$message) {
 $status=if($ok){'success'}else{'failed'}
 $result=@{status=$status;message=$message;version=$ExpectedVersion;updated_at=(Get-Date).ToUniversalTime().ToString('o')}
 $result|ConvertTo-Json -Compress|Set-Content -LiteralPath $ResultFile -Encoding UTF8
}
function Open-InstalledApp($root) {
 $target=Join-Path $root 'electron.exe'
 if(!(Test-Path -LiteralPath $target -PathType Leaf)){throw 'Executável do programa não encontrado para reiniciar'}
 Start-Process -FilePath $target -WorkingDirectory $root -ErrorAction Stop | Out-Null
}
# The helper is copied to userData before use; never edit a live installation.
# We do not restore a previous executable if the new version was already verified:
# failure to launch is a separate problem from failure to install.
$installAttempted=$false
$installedVerified=$false
$appPath=Join-Path $InstallDir 'app'
try {
 $deadline=(Get-Date).AddSeconds(150)
 while((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline){
  Start-Sleep -Milliseconds 500
 }
 if(Get-Process -Id $ParentPid -ErrorAction SilentlyContinue){
  throw 'O aplicativo não fechou; instalação abortada para proteger os arquivos'
 }
 if(!(Test-Path -LiteralPath $Installer -PathType Leaf)){throw 'Instalador verificado não encontrado'}
 $actual=(Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
 if($actual -ne $ExpectedSha256){throw 'Integridade SHA256 alterada antes da instalação'}
 if(!(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe'))){throw 'Instalação atual não encontrada'}
 if(Test-Path -LiteralPath $RollbackDir){throw 'Snapshot de recuperação já existe'}
 # Snapshot is outside the NSIS program directory; never contains PostgreSQL user data.
 New-Item -ItemType Directory -Force -Path $RollbackDir|Out-Null
 try{Copy-Item -LiteralPath $appPath -Destination (Join-Path $RollbackDir 'app') -Recurse -Force}
 catch{Remove-Item -LiteralPath $RollbackDir -Recurse -Force;throw}
 if(!(Test-Path -LiteralPath (Join-Path $RollbackDir 'app/electron.exe'))){throw 'Snapshot do programa incompleto'}
 # NSIS /D MUST be the final argument, unquoted, and specifies the actual
 # running installation directory, regardless of a stale HKCU InstallDir registry.
 $installAttempted=$true
 $nsisArguments='/S /D='+$InstallDir
 $process=Start-Process -FilePath $Installer -ArgumentList $nsisArguments -Wait -PassThru -ErrorAction Stop
 if($process.ExitCode -ne 0){throw 'O instalador retornou erro '+$process.ExitCode}
 if(!(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe')) -or
    !(Test-Path -LiteralPath (Join-Path $appPath 'resources/app/main.cjs'))){
  throw 'A instalação não terminou corretamente'
 }
 $installedPackage=Join-Path $appPath 'resources/app/package.json'
 if(!(Test-Path -LiteralPath $installedPackage)){throw 'Metadados de versão não instalados'}
 $installedVersion=(Get-Content -LiteralPath $installedPackage -Raw | ConvertFrom-Json).version
 if($installedVersion -ne $ExpectedVersion){throw 'Versão instalada difere da release aprovada'}
 $installedVerified=$true
 Save-Result $true 'Programa atualizado. Backup e versão anterior preservados.'
 Open-InstalledApp $appPath
 exit 0
}catch{
 $message=$_.Exception.Message
 if($installedVerified){
  # The update itself succeeded. Never replace an installed new version simply
  # because Windows could not relaunch it; the user can reopen it manually.
  try{Save-Result $false ('Atualização instalada, mas a reabertura falhou: '+$message)}catch{}
  exit 1
 }
 try {
  $snapshot=Join-Path $RollbackDir 'app'
  if($installAttempted -and (Test-Path -LiteralPath (Join-Path $snapshot 'electron.exe'))){
   if(Test-Path -LiteralPath $appPath){Remove-Item -LiteralPath $appPath -Recurse -Force}
   Copy-Item -LiteralPath $snapshot -Destination $appPath -Recurse -Force
   if(!(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe'))){throw 'Cópia restaurada incompleta'}
   $message+='; versão anterior restaurada'
  }
  # Even if the error happened before installer execution, reopen the
  # existing program so users are not left with a closed shop.
  if(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe')){
   Open-InstalledApp $appPath
  }
 }catch{$message+='; recuperação/reabertura falhou: '+$_.Exception.Message}
 Save-Result $false $message
 exit 1
}
