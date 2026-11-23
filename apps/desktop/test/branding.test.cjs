const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const asset=path.join(root,'apps','desktop','assets','loja-roupas.ico');
const source=path.join(root,'apps','desktop','assets','loja-roupas.svg');
const read=p=>readFileSync(path.join(root,p),'utf8');

test('ícone Windows possui resoluções apropriadas para atalhos e telas de alta densidade',()=>{
 assert.ok(existsSync(source),'fonte vetorial presente');
 assert.ok(existsSync(asset),'ícone Windows presente');
 const bytes=readFileSync(asset);
 assert.equal(bytes.readUInt16LE(0),0);
 assert.equal(bytes.readUInt16LE(2),1);
 const count=bytes.readUInt16LE(4);
 assert.ok(count>=4,'mínimo de quatro resoluções no .ico');
 const sizes=[];
 for(let i=0;i<count;i++){
  const pos=6+i*16;
  const width=bytes[pos]||256;
  sizes.push(width);
  const length=bytes.readUInt32LE(pos+8),offset=bytes.readUInt32LE(pos+12);
  assert.ok(length>0&&offset+length<=bytes.length,'entrada de imagem válida');
 }
 for(const expected of [16,32,48,256])assert.ok(sizes.includes(expected),'resolução '+expected+' ausente');
});

test('empacotador inclui ícone dentro de resources/app/assets',()=>{
 const source=read('scripts/package-desktop.mjs');
 assert.match(source,/assets['"],'loja-roupas\.ico'/);
});

test('ambos os instaladores criam atalhos com ícone próprio',()=>{
 for(const filename of ['loja-roupas.nsi','loja-roupas-fisica.nsi']){
  const source=read('infra/desktop/'+filename);
  assert.match(source,/(?:^Icon|^!define MUI_ICON)\s+"[^\r\n]*loja-roupas\.ico"/m);
  assert.match(source,/(?:^UninstallIcon|^!define MUI_UNICON)\s+"[^\r\n]*loja-roupas\.ico"/m);
  assert.match(source,/CreateShortcut\s+"\$SMPROGRAMS\\[^\r\n]+loja-roupas\.ico"\s+0/);
  assert.match(source,/CreateShortcut\s+"\$DESKTOP\\[^\r\n]+loja-roupas\.ico"\s+0/);
  assert.match(source,/Delete\s+"\$DESKTOP\\/);
 }
});

test('janelas do Electron apontam para o ícone instalado no Windows',()=>{
 const source=read('apps/desktop/src/main.cjs');
 assert.match(source,/loja-roupas\.ico/);
 assert.equal((source.match(/icon:desktopIcon/g)||[]).length,3);
});