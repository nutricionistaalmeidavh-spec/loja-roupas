const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const installer=fs.readFileSync(path.resolve(__dirname,'../../../infra/desktop/loja-roupas-fisica.nsi'),'utf8');

test('instalação interativa física oferece iniciar a loja na página Concluir',()=>{
 assert.match(installer,/!insertmacro\s+MUI_PAGE_FINISH/);
 assert.match(installer,/!define\s+MUI_FINISHPAGE_RUN\s+["']?\$INSTDIR\\app\\electron\.exe/);
 assert.match(installer,/MUI_FINISHPAGE_RUN_TEXT.*Iniciar Loja/);
});

test('instalação silenciosa NSIS continua disponível para atualizador, sem iniciar Electron',()=>{
 assert.match(installer,/Section\s+"Loja de Roupas Fisica"/);
 assert.doesNotMatch(installer,/\bExec(?:Wait|Shell)?\s+.*electron\.exe/i);
});
