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

test('pacote Electron inclui página de recuperação em falha de conexão',()=>{
 const packageScript=fs.readFileSync(path.resolve(__dirname,'../../../scripts/package-desktop.mjs'),'utf8');
 const main=fs.readFileSync(path.resolve(__dirname,'../src/main.cjs'),'utf8');
 const fallback=fs.readFileSync(path.resolve(__dirname,'../src/connection-error.html'),'utf8');
 assert.match(packageScript,/connection-error\.html/);
 assert.match(main,/did-fail-load/);
 assert.match(main,/ready-to-show/);
 assert.match(fallback,/não pôde ser aberta/);
});
