import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function secretsDirectory(env:NodeJS.ProcessEnv=process.env):string {
 if(env.LOJA_SYNC_SECRET_DIR)return path.resolve(env.LOJA_SYNC_SECRET_DIR);
 return path.join(env.APPDATA||env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'loja-roupas','sync');
}
export async function masterKey(env:NodeJS.ProcessEnv=process.env):Promise<Buffer>{
 const folder=secretsDirectory(env),file=path.join(folder,'master.key');
 await mkdir(folder,{recursive:true,mode:0o700});
 try{await writeFile(file,randomBytes(32),{mode:0o600,flag:'wx'});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const data=await readFile(file);
 if(data.length!==32)throw new Error('Chave de sincronização local inválida; preserve e restaure master.key');
 return data;
}
export async function sealSyncKey(key:string,env:NodeJS.ProcessEnv=process.env):Promise<string>{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await masterKey(env),iv);
 const ciphertext=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);
 return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),ciphertext.toString('hex')].join('.');
}
export async function openSyncKey(value:string,env:NodeJS.ProcessEnv=process.env):Promise<string>{
 const parts=value.split('.');
 if(parts.length!==3||parts[0].length!==24||parts[1].length!==32)throw new Error('Credencial local inválida');
 const decipher=createDecipheriv('aes-256-gcm',await masterKey(env),Buffer.from(parts[0],'hex'));
 decipher.setAuthTag(Buffer.from(parts[1],'hex'));
 return Buffer.concat([decipher.update(Buffer.from(parts[2],'hex')),decipher.final()]).toString('utf8');
}
