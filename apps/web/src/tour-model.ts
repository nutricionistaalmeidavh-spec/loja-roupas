export type TourPage = 'pdv'|'produtos'|'estoque'|'caixa'|'gestao';
export type TourStep = {id:string;page:TourPage;target:string;title:string;description:string};
const step=(id:string,page:TourPage,target:string,title:string,description:string):TourStep=>({id,page,target,title,description});
export function tourStepsFor(roles:string[]):TourStep[]{
 const manager=roles.includes('manager');
 const canStock=manager||roles.includes('stocker');
 const canCash=manager||roles.includes('cashier');
 const steps:TourStep[]=[
  step('inicio','pdv','overview','Sua loja, em um só lugar','Este guia apresenta os fluxos reais, sem criar vendas, produtos ou movimentações. Você pode pular e voltar quando quiser.'),
  step('busca','pdv','search','Localize cada peça','Busque por nome, código da peça ou código de barras.'),
  step('variantes','pdv','variants','Cor, tamanho e disponibilidade','Selecione a variação certa antes de adicionar ao carrinho. O estoque é confirmado novamente ao vender.'),
  step('carrinho','pdv','cart','Carrinho e pagamento','Revise as peças e suspensa a venda se necessário. Pix e cartão são registrados somente após confirmação externa.'),
 ];
 if(manager)steps.push(step('produtos','produtos','products','Cadastre produtos e grades','Informe nome, categoria, SKU, cor, tamanho e preço. A grade permite múltiplas variantes.'));
 if(canStock)steps.push(step('estoque','estoque','stock','Controle entradas e ajustes','Localize o SKU e lance recebimentos. Cada movimentação fica registrada no banco de dados.'));
 if(canCash)steps.push(step('caixa','caixa','cash','Abra e feche o caixa','Abra o caixa antes da primeira venda e consulte seus lançamentos e fechamento.'));
 if(manager)steps.push(
  step('gestao','gestao','management','Acompanhe a operação','Vendas, devoluções, fornecedores, compras, impressão e retirada ficam na gestão.'),
  step('inteligencia','gestao','intelligence','Indicadores comerciais','Analise vendas, metas e estoque baixo com dados reais. Projeções são informativas.'),
  step('vitrine','gestao','storefront','Vitrine e retirada','Publique variantes na vitrine e receba pedidos para retirada. O pagamento permanece no caixa.'),
 );
 steps.push(step('fim','pdv','overview','Pronto para operar','O guia terminou. Use “Reabrir tour” no topo a qualquer momento. O sistema permanece totalmente local.'));
 return steps;
}
export function tourStorageKey(storeId:string,roles:string[]):string{
 return 'loja:tour:v1:'+storeId+':'+[...new Set(roles)].sort().join(',');
}
export function shouldShowTour(value:string|null):boolean{return value!=='complete'&&value!=='skipped';}

export function restoredTourStep(value:string|null,count:number):number{
 const match=/^step:(\d+)$/.exec(value??'');
 const number=match?Number(match[1]):0;
 return Number.isSafeInteger(number)&&number>=0&&number<count?number:0;
}
