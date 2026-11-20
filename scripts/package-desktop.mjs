import { cp, mkdir, writeFile } from 'node:fs/promises';
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
await cp(new URL('../apps/desktop/src/setup-preload.cjs',import.meta.url),path.join(application,'setup-preload.cjs'));
await cp(new URL('../apps/desktop/src/setup.html',import.meta.url),path.join(application,'setup.html'));
await writeFile(path.join(application,'package.json'),JSON.stringify({
  name:'loja-roupas-desktop', productName:'Loja de Roupas', version:'0.1.0', main:'main.cjs',
},null,2));
console.info(output);
