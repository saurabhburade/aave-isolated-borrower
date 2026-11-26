import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createWalletClient, defineChain, http} from 'viem';
import {getMarkets,postQuotes,postPrepare,postManage,getPositions} from '../src/lib/api.ts';
import {createLocalClient} from '../src/lib/deployment.ts';
import {erc20Abi} from '../src/lib/abis.ts';
const owner='0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',rpc='http://127.0.0.1:8557';
const client=createLocalClient();
assert.equal(await client.getChainId(),31337,'disposable local fork only');
const chain=defineChain({id:31337,name:'Local fork',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const wallet=createWalletClient({account:owner,chain,transport:http(rpc)});
const catalog=await getMarkets();
assert.equal(catalog.markets.filter(m=>m.status==='available').length,2,JSON.stringify(catalog.markets.map(m=>m.reason)));
const weth=catalog.assets.find(a=>a.symbol==='WETH'),usdc=catalog.assets.find(a=>a.symbol==='USDC');
assert(weth&&usdc);
async function send(plan){
 assert.equal(plan.freshness.status,'fresh',plan.freshness.reason);if(!plan.request)assert(plan.riskAfter);assert.equal(await client.getChainId(),31337);
 for(const a of plan.approvals){const current=await client.readContract({address:a.token.address,abi:erc20Abi,functionName:'allowance',args:[owner,a.spender]});if(current<BigInt(a.amount)){const hash=await wallet.writeContract({address:a.token.address,abi:erc20Abi,functionName:'approve',args:[a.spender,BigInt(a.amount)]});assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');}}
 await client.call({account:owner,to:plan.transaction.to,data:plan.transaction.data,value:0n});
 const hash=await wallet.sendTransaction({to:plan.transaction.to,data:plan.transaction.data,value:0n});assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');
}
async function open(version,collateral,debt){
 const market=catalog.markets.find(m=>m.version===version),salt=`0x${randomBytes(32).toString('hex')}`;
 const request={chainId:31337,collaterals:[{assetId:weth.id,amount:collateral,enabled:true}],debt:{assetId:usdc.id,amount:debt}};
 const quote=(await postQuotes({...request,owner,salt})).quotes.find(q=>q.marketId===market.id);
 assert(quote?.executable,JSON.stringify(quote?.reasons));assert(quote.risk.borrowCapacityUsd!==null);
 assert(!(await client.getBytecode({address:quote.account})),'simulation did not deploy');
 assert.equal(await client.readContract({address:weth.address,abi:erc20Abi,functionName:'allowance',args:[owner,quote.account]}),0n,'simulated approvals did not persist');
 const plan=await postPrepare({request,marketId:market.id,owner,salt});
 const refreshed=await postPrepare({request,marketId:market.id,owner,salt,reviewedLimits:{deadline:plan.deadline,minHealthFactor:plan.minHealthFactor,maxBorrowRateRay:plan.maxBorrowRateRay}});
 assert.equal(refreshed.termsHash,plan.termsHash,'unchanged review bounds');await send(plan);console.log(`Opened V${version} ${plan.account}`);return{plan,request,salt,market};
}
const first=await open(3,'0.2','10'),second=await open(3,'0.3','15'),fourth=await open(4,'0.25','12');
assert.notEqual(first.plan.account,second.plan.account);
const positions=async()=>(await getPositions(owner,'31337')).positions;
let state=await positions();
const a=state.find(p=>p.account.toLowerCase()===first.plan.account.toLowerCase()),b=state.find(p=>p.account.toLowerCase()===second.plan.account.toLowerCase());
assert.equal(a.collaterals[0].amount.slice(0,3),'0.2');assert.equal(b.collaterals[0].amount.slice(0,3),'0.3');
const v4=state.find(p=>p.account.toLowerCase()===fourth.plan.account.toLowerCase()),wsteth=v4.market.assets.find(a=>a.symbol.toLowerCase()==='wsteth');assert(wsteth);
await send(await postManage({positionId:v4.id,owner,actions:[{kind:'supply',assetId:wsteth.id,amount:'0.2',enabled:true}]}));
state=await positions();assert.equal(state.find(p=>p.id===v4.id).collaterals.length,2,'same V4 account gains collateral');
const unsafe=await postManage({positionId:a.id,owner,actions:[{kind:'withdraw',assetId:a.collaterals[0].asset.id,amount:'0.195'}]});assert.equal(unsafe.freshness.status,'stale');assert.equal(unsafe.riskAfter,null);
const disabled=await postManage({positionId:a.id,owner,actions:[{kind:'set-collateral',assetId:a.collaterals[0].asset.id,enabled:false}]});assert.equal(disabled.freshness.status,'stale');assert.equal(disabled.riskAfter,null);
await send(await postManage({positionId:a.id,owner,actions:[{kind:'withdraw',assetId:a.collaterals[0].asset.id,amount:'0.01'}]}));
await send(await postManage({positionId:a.id,owner,actions:[{kind:'repay',assetId:a.debts[0].asset.id,amount:'1'}]}));
for(const position of await positions()){if([first,second,fourth].some(o=>o.plan.account.toLowerCase()===position.account.toLowerCase())) await send(await postManage({positionId:position.id,owner,actions:[{kind:'close',assetId:'all'}]}));}
state=await positions();for(const o of[first,second,fourth]){const p=state.find(p=>p.account.toLowerCase()===o.plan.account.toLowerCase());assert.equal(p.status,'closed');assert.equal(p.debts.length,0);assert.equal(p.collaterals.length,0);assert(p.activity.length>0);}
await assert.rejects(postPrepare({request:first.request,owner,salt:first.salt,marketId:first.market.id}),/unavailable|revert|already/i);
console.log('PASS: exact read-only simulation, stable review, separate same-market accounts, V4 add collateral, unsafe withdrawal/collateral disable, safe partial withdrawal, partial repay, all-debt close, history, retries.');
