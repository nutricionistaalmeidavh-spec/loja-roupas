import {test,expect} from '@playwright/test';

function crc32(data:Buffer):number{
 let crc=0xffffffff;
 for(const b of data){
  crc^=b;
  for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function zip(entries:Array<[string,string]>):Buffer{
 const locals:Buffer[]=[],central:Buffer[]=[];
 let offset=0;
 for(const [path,content] of entries){
  const name=Buffer.from(path),data=Buffer.from(content,'utf8'),checksum=crc32(data);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt32LE(checksum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);
  directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);
  directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  central.push(directory,name);locals.push(local,name,data);offset+=local.length+name.length+data.length;
 }
 const centralSize=central.reduce((sum,b)=>sum+b.length,0);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,...central,end]);
}
test('lê Excel XLSX real (ZIP com XML e shared strings) e importa variantes',async({page})=>{
 const suffix=Math.random().toString(36).slice(2,10).toUpperCase();
 const product='Blusa Excel '+suffix,sku1='XLS-'+suffix+'-P',sku2='XLS-'+suffix+'-M';
 const text=['produto','categoria','sku','cor','tamanho','preco','codigo_barras','estoque_inicial',
  product,'Feminino',sku1,'Areia','P',sku2,'M'];
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const workbook='<x:workbook xmlns:x="'+ns+'" xmlns:r="'+r+'"><x:sheets><x:sheet name="Produtos" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>';
 const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+r+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
 const shared='<x:sst xmlns:x="'+ns+'">'+text.map(value=>'<x:si><x:t>'+value+'</x:t></x:si>').join('')+'</x:sst>';
 const cell=(reference:string,index:number)=>'<x:c r="'+reference+'" t="s"><x:v>'+index+'</x:v></x:c>';
 const number=(reference:string,value:number)=>'<x:c r="'+reference+'"><x:v>'+value+'</x:v></x:c>';
 const a='ABCDEFGH';
 const row1=a.split('').map((col,index)=>cell(col+'1',index)).join('');
 const row2=cell('A2',8)+cell('B2',9)+cell('C2',10)+cell('D2',11)+cell('E2',12)+number('F2',149.90)+number('H2',4);
 const row3=cell('A3',8)+cell('B3',9)+cell('C3',13)+cell('D3',11)+cell('E3',14)+number('F3',149.90)+number('H3',2);
 const sheet='<x:worksheet xmlns:x="'+ns+'"><x:sheetData><x:row r="1">'+row1+'</x:row><x:row r="2">'+row2+'</x:row><x:row r="3">'+row3+'</x:row></x:sheetData></x:worksheet>';
 const buffer=zip([['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],
  ['xl/sharedStrings.xml',shared],['xl/worksheets/sheet1.xml',sheet]]);
 await page.goto('/');
 await page.getByLabel('Usuário').fill('qa-admin');
 await page.getByLabel('Senha').fill('Senha-QA-Somente-CI-2026');
 await page.getByRole('button',{name:'Entrar na loja'}).click();
 await page.getByRole('button',{name:'Cadastrar produtos'}).click();
 await page.getByRole('button',{name:'Importar planilha'}).click();
 const dialog=page.getByRole('dialog',{name:'Importar produtos por planilha'});
 await dialog.locator('input[type=file]').setInputFiles({
  name:'roupas.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer
 });
 await expect(dialog.getByText('2 variantes')).toBeVisible();
 await expect(dialog.getByText('6 unidades de estoque')).toBeVisible();
 await dialog.getByRole('button',{name:'Confirmar importação'}).click();
 await expect(dialog.getByText(/Importação concluída: 1 produtos, 2 variantes e 6 unidades/)).toBeVisible();
 await dialog.getByRole('button',{name:'Fechar Importar produtos por planilha'}).click();
 await page.getByRole('button',{name:'PDV'}).click();
 await page.getByLabel('Buscar nome, SKU ou código').fill(sku1);
 const card=page.locator('.product-card').filter({hasText:product});
 await expect(card).toBeVisible();
 await card.getByRole('button',{name:'P',exact:true}).click();
 await expect(card.getByText('4 disponíveis')).toBeVisible();
});
