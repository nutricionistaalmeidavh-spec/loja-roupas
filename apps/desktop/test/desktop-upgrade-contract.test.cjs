const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const helper=fs.readFileSync(path.resolve(__dirname,'../src/update-helper.ps1'),'utf8');
const updater=fs.readFileSync(path.resolve(__dirname,'../src/desktop-updater.cjs'),'utf8');

test('instalador silencioso aponta explicitamente para o mesmo diretório aprovado',()=>{
 assert.match(helper,/\/D=/i,'NSIS deve receber /D= para não instalar noutra pasta');
 assert.match(helper,/InstallDir/);
 assert.match(helper,/ExpectedVersion/);
 assert.match(helper,/Get-Content.*package\.json/i);
});

test('reinício é independente do sucesso da instalação e falha não fica silenciosa',()=>{
 assert.match(helper,/Save-Result\s+\$false/);
 assert.match(helper,/Start-Process.*electron\.exe/i);
 assert.match(helper,/Set-Content.*ResultFile/i);
 assert.match(updater,/pending/i,'Antes de encerrar, gravar estado pendente no perfil para diagnóstico');
});

test('backup e rollback continuam antes da instalação e sem dados do usuário',()=>{
 const backup=helper.indexOf("Copy-Item -LiteralPath $appPath");
 const install=helper.indexOf("Start-Process -FilePath $Installer");
 assert.ok(backup!==-1&&install!==-1&&backup<install);
 assert.match(updater,/backupBeforeUpdate/);
 assert.match(helper,/RollbackDir/);
});
