param(
 [Parameter(Mandatory=$true)][int]$ParentPid,
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][string]$InstallDir,
 [Parameter(Mandatory=$true)][string]$RollbackDir,
 [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Save-Result($ok,$message) {
 $status=if($ok){'success'}else{'failed'}
 $result=@{status=$status;message=$message;updated_at=(Get-Date).ToUniversalTime().ToString('o')}
 $result|ConvertTo-Json -Compress|Set-Content -LiteralPath $ResultFile -Encoding UTF8
}
# Detached updater runs only after the Electron process and PostgreSQL are stopped.
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
 $appPath=Join-Path $InstallDir 'app'
 if(!(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe'))){throw 'Instalação atual não encontrada'}
 if(Test-Path -LiteralPath $RollbackDir){throw 'Snapshot de recuperação já existe'}
 # Filesystem rollback snapshot is outside the NSIS installation directory and
 # never includes the live PostgreSQL data directory (which is already separate).
 New-Item -ItemType Directory -Force -Path $RollbackDir|Out-Null
 try{Copy-Item -LiteralPath $appPath -Destination (Join-Path $RollbackDir 'app') -Recurse -Force}
 catch{Remove-Item -LiteralPath $RollbackDir -Recurse -Force;throw}
 if(!(Test-Path -LiteralPath (Join-Path $RollbackDir 'app/electron.exe'))){throw 'Snapshot do programa incompleto'}
 $process=Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
 if($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe')) -or
  !(Test-Path -LiteralPath (Join-Path $appPath 'resources/app/main.cjs'))){
  throw 'A instalação falhou, restaurar versão anterior'
 }
 Save-Result $true 'Programa atualizado; backup do banco e snapshot anterior preservados'
 Start-Process -FilePath (Join-Path $appPath 'electron.exe')
 exit 0
}catch{
 $message=$_.Exception.Message
 try {
  $snapshot=Join-Path $RollbackDir 'app'
  if(Test-Path -LiteralPath (Join-Path $snapshot 'electron.exe')){
   $appPath=Join-Path $InstallDir 'app'
   if(Test-Path -LiteralPath $appPath){Remove-Item -LiteralPath $appPath -Recurse -Force}
   Copy-Item -LiteralPath $snapshot -Destination $appPath -Recurse -Force
   if(Test-Path -LiteralPath (Join-Path $appPath 'electron.exe')){
    Start-Process -FilePath (Join-Path $appPath 'electron.exe')
    $message+='; arquivos da versão anterior restaurados'
   }
  }
 }catch{$message+='; restauração automática falhou, snapshot preservado: '+$_.Exception.Message}
 Save-Result $false $message
 exit 1
}
