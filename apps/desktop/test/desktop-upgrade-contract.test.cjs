const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const helper=fs.readFileSync(path.resolve(__dirname,'../src/update-helper.ps1'),'utf8');
const updater=fs.readFileSync(path.resolve(__dirname,'../src/desktop-updater.cjs'),'utf8');

test('NSIS silencioso recebe a pasta original e valida a versão instalada',()=>{
 assert.match(helper,/\/D=/i);
 assert.match(helper,/\$nsisArguments='\/S \/D='\+\$InstallDir/);
 assert.match(helper,/ExpectedVersion/);
 assert.match(helper,/resources\/app\/package\.json/);
 assert.match(helper,/Get-Content -LiteralPath \$installedPackage/i);
});

test('registra resultado e usa relançamento mesmo no fluxo de recuperação',()=>{
 assert.match(helper,/Save-Result \$false/);
 assert.match(helper,/function Open-InstalledApp/);
 assert.match(helper,/Start-Process -FilePath \$target/);
 assert.match(helper,/Set-Content -LiteralPath \$ResultFile/);
 assert.match(updater,/status:'pending'/);
});

test('backup e rollback continuam antes do instalador e fora do perfil',()=>{
 const backup=helper.indexOf('Copy-Item -LiteralPath $appPath');
 const install=helper.indexOf('Start-Process -FilePath $Installer');
 assert.ok(backup!==-1&&install!==-1&&backup<install);
 assert.match(updater,/backupBeforeUpdate/);
 assert.match(helper,/RollbackDir/);
});
