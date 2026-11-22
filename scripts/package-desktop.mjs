import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const binary = require('electron');
const executableDir = path.dirname(binary);
const output = path.resolve('dist', 'desktop-' + process.platform + '-' + process.arch);
const mac = process.platform === 'darwin';
const distribution = mac ? path.resolve(executableDir, '..', '..', '..') : executableDir;
const resources = mac ? path.join(output, 'Electron.app', 'Contents', 'Resources') : path.join(output, 'resources');
await mkdir(path.dirname(output), {recursive:true});
await mkdir(output,{recursive:true});
await cp(distribution,output,{recursive:true,verbatimSymlinks:true});
const application = path.join(resources,'app');
await mkdir(application,{recursive:true});
await cp(new URL('../apps/desktop/src/main.cjs',import.meta.url),path.join(application,'main.cjs'));
await cp(new URL('../apps/desktop/src/local-runtime.cjs',import.meta.url),path.join(application,'local-runtime.cjs'));
await cp(new URL('../apps/desktop/src/local-backup.cjs',import.meta.url),path.join(application,'local-backup.cjs'));
await cp(new URL('../apps/desktop/src/native-print.cjs',import.meta.url),path.join(application,'native-print.cjs'));
await cp(new URL('../apps/desktop/src/updates.cjs',import.meta.url),path.join(application,'updates.cjs'));
await cp(new URL('../apps/desktop/src/desktop-updater.cjs',import.meta.url),path.join(application,'desktop-updater.cjs'));
await cp(new URL('../apps/desktop/src/update-preload.cjs',import.meta.url),path.join(application,'update-preload.cjs'));
await cp(new URL('../apps/desktop/src/update-helper.ps1',import.meta.url),path.join(application,'update-helper.ps1'));
await cp(new URL('../apps/desktop/src/commercial-license.cjs',import.meta.url),path.join(application,'commercial-license.cjs'));
if(process.env.LOJA_PHYSICAL_EDITION==='true')
 await writeFile(path.join(application,'physical-edition.json'),JSON.stringify({edition:'physical'}));
if(process.env.LOJA_COMMERCIAL_EDITION==='true')await writeFile(path.join(application,'commercial-edition.json'),JSON.stringify({required:true,product:'LOJA_ROUPAS'}));
await cp(new URL('../apps/desktop/src/recovery-preload.cjs',import.meta.url),path.join(application,'recovery-preload.cjs'));
await cp(new URL('../apps/desktop/src/recovery.html',import.meta.url),path.join(application,'recovery.html'));
await cp(new URL('../apps/desktop/src/setup-preload.cjs',import.meta.url),path.join(application,'setup-preload.cjs'));
await cp(new URL('../apps/desktop/src/setup.html',import.meta.url),path.join(application,'setup.html'));
const packageInfo=JSON.parse(await readFile(new URL('../apps/desktop/package.json',import.meta.url),'utf8'));
const physicalVersion=process.env.LOJA_PHYSICAL_EDITION==='true'
 ? (process.env.LOJA_PHYSICAL_VERSION||'0.2.3') : packageInfo.version;
if(!/^\d+\.\d+\.\d+$/.test(physicalVersion))throw Error('Versão desktop inválida');
await writeFile(path.join(application,'package.json'),JSON.stringify({
  name:'loja-roupas-desktop', productName:process.env.LOJA_PHYSICAL_EDITION==='true'?'Loja de Roupas Fisica':'Loja de Roupas',
  version:physicalVersion, main:'main.cjs',
},null,2));
console.info(output);
