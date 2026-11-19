import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const executablePath = process.argv[2];
if (!executablePath || !path.isAbsolute(executablePath)) {
  throw new Error('Informe o caminho absoluto do Electron instalado');
}
const require = createRequire(new URL('../apps/web/package.json',import.meta.url));
const { _electron: electron } = require('@playwright/test');
const userData = await mkdtemp(path.join(tmpdir(),'loja-desktop-smoke-'));
const server = createServer((request,response)=>{
  if(request.url!=='/')return response.writeHead(404).end();
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  response.end('<!doctype html><h1>Terminal Loja QA</h1><label>SKU <input></label>');
});
let application;
try {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin = 'http://127.0.0.1:'+server.address().port;
  application = await electron.launch({
    executablePath,
    args:['--user-data-dir='+userData],
    chromiumSandbox:true,
    env:{...process.env,LOJA_SERVER_URL:origin},
    timeout:30_000,
  });
  const window = await application.firstWindow({timeout:20_000});
  await window.getByRole('heading',{name:'Terminal Loja QA'}).waitFor();
  const scan = window.getByLabel('SKU');
  await scan.pressSequentially('QA-USB-001');
  assert.equal(await scan.inputValue(),'QA-USB-001');
  assert.equal(new URL(window.url()).origin,origin);
  const webPreferences = await application.evaluate(({BrowserWindow})=>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(webPreferences.sandbox,true);
  assert.equal(webPreferences.contextIsolation,true);
  assert.equal(webPreferences.nodeIntegration,false);
  console.info('Cliente instalado abriu servidor de teste e recebeu entrada de teclado.');
} finally {
  await application?.close();
  server.close();
  await rm(userData,{recursive:true,force:true,maxRetries:4,retryDelay:250});
}
