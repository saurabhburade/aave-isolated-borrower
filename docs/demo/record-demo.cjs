// Local-only recording studio. Uses a disposable Anvil wallet; never a browser profile.
const { chromium } = require('../../apps/web/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const out = path.resolve(__dirname, process.env.DEMO_OUT || 'raw');
const dpr = Number(process.env.DEMO_DPR || '1');
const owner = process.env.DEMO_OWNER || '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const base = 'http://127.0.0.1:3210';
const rpc = 'http://127.0.0.1:8557';
let browser, context, page, app, started, active;
const scenes = [], transactions = [], errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const short = s => s.slice(0, 6) + '…' + s.slice(-4);
const studio = `<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0;background:#10151d;color:#f3f7fa;font-family:Arial,Helvetica,sans-serif;overflow:hidden;width:1920px;height:1080px}
.brand{position:absolute;left:160px;top:33px;display:flex;gap:15px;align-items:center;font-size:22px;font-weight:600;letter-spacing:-.4px}.mark{width:28px;height:28px;background:#a5f3cf;border-radius:8px;transform:rotate(-12deg)}.brand span{color:#8c9aa9;font-weight:400;margin-left:12px}.badge{position:absolute;right:160px;top:32px;border:1px solid #354240;border-radius:30px;padding:10px 18px;font-size:16px;color:#a5f3cf;letter-spacing:.8px}
#screen{position:absolute;left:160px;top:100px;width:1600px;height:850px;border-radius:18px;overflow:hidden;box-shadow:0 30px 90px #0008;background:#fff;outline:1px solid #ffffff18}
#stage{width:1600px;height:850px;transform-origin:center;transition:transform 1s cubic-bezier(.2,.8,.2,1)}iframe{border:0;width:1600px;height:850px;background:#fff}
#chapter{position:absolute;left:160px;top:977px;color:#a5f3cf;letter-spacing:2px;font-size:15px;font-weight:700;text-transform:uppercase}
#caption{position:absolute;left:520px;right:160px;top:971px;font-size:25px;line-height:1.4;letter-spacing:-.3px}
#progress{position:absolute;bottom:0;left:0;background:#a5f3cf;height:4px;width:0;transition:width .7s}
#cursor{position:absolute;z-index:50;pointer-events:none;width:20px;height:20px;border:3px solid #ffffff;border-radius:50%;background:#202b35;box-shadow:0 0 0 6px #a5f3cf55;opacity:0;transition:transform .4s,opacity .2s}
#card{position:absolute;inset:0;background:radial-gradient(ellipse at 80% 20%,#263b39 0,transparent 55%),#10151d;z-index:60;padding:130px 160px;display:none}
.eyebrow{color:#a5f3cf;text-transform:uppercase;letter-spacing:4px;font-size:19px;font-weight:700}.title{font-size:76px;font-weight:600;letter-spacing:-3px;line-height:1.05;margin:25px 0 26px;max-width:1450px}.subtitle{font-size:29px;color:#a5b2bf;line-height:1.5;max-width:1420px}.footer{position:absolute;bottom:70px;left:160px;right:160px;border-top:1px solid #ffffff25;padding-top:24px;color:#8c9aa9;display:flex;justify-content:space-between;font-size:19px}.grid{display:flex;gap:24px;margin-top:55px}.tile{background:#ffffff06;border:1px solid #ffffff20;border-radius:20px;padding:30px;flex:1;min-height:180px}.tile b{display:block;font-size:30px;letter-spacing:-.5px;margin-bottom:16px}.tile p{color:#adbac5;font-size:23px;line-height:1.4;margin:0}.tag{color:#a5f3cf;font-size:17px;letter-spacing:1px;margin-bottom:16px}.line{height:1px;background:#a5f3cf55;margin:22px 0}.number{font-size:54px;color:#a5f3cf;margin:12px 0;font-variant-numeric:tabular-nums}.small{font-size:19px;color:#8c9aa9;line-height:1.5}
</style></head><body><div class="brand"><i class="mark"></i>Aave isolated positions<span>Research → working PoC</span></div><div class="badge">LOCAL ETHEREUM FORK · 31337</div><div id="screen"><div id="stage"><iframe src="/31337"></iframe></div></div><div id="chapter"></div><div id="caption"></div><div id="progress"></div><div id="cursor"></div><div id="card"></div></body></html>`;

async function save(){await fs.writeFile(path.join(out,'timeline.json'),JSON.stringify({owner,started,scenes,transactions,errors,active},null,2));}
async function mark(name, chapter, caption, duration){
  if(active) await end();
  await page.evaluate(({chapter,caption,n})=>{document.querySelector('#card').style.display='none';document.querySelector('#chapter').textContent=chapter;document.querySelector('#caption').textContent=caption;document.querySelector('#progress').style.width=n+'%';}, {chapter,caption,n:Math.min(95,scenes.length*7)});
  await pause(350);
  active={name,start:(Date.now()-started)/1000,duration};
  console.log('SCENE',name);await save();
}
async function end(){if(!active)return;active.end=(Date.now()-started)/1000;scenes.push(active);await page.screenshot({path:path.join(out,active.name+'.png')});active=null;await save();}
async function zoom(scale=1,x=800,y=425){await page.evaluate(({scale,x,y})=>{document.querySelector('#stage').style.transform=`translate(${(800-x)*scale}px,${(425-y)*scale}px) scale(${scale})`;document.querySelector('#cursor').style.opacity='0';},{scale,x,y});await pause(1100);}
async function cursor(locator){const b=await locator.boundingBox();if(!b)return;await page.evaluate(({x,y})=>{const c=document.querySelector('#cursor');c.style.opacity='1';c.style.left=x+'px';c.style.top=y+'px';},{x:b.x+b.width/2-10,y:b.y+b.height/2-10});await pause(550);}
async function click(locator){await cursor(locator);await locator.click();await pause(700);}
async function type(locator,text){await cursor(locator);await locator.fill('');await locator.pressSequentially(text,{delay:140});await pause(600);}
async function card(html,name,duration){if(active)await end();await page.evaluate(html=>{const c=document.querySelector('#card');c.innerHTML=html;c.style.display='block';},html);await pause(250);active={name,start:(Date.now()-started)/1000,duration};await pause(1800);await end();}
const footer='<div class="footer"><span>@saurabh_evm · Borrower-side risk management</span><span>Post-research proof of concept</span></div>';
async function run(command){
 const {action}=command;
 if(action==='inspect'){console.log((await app.locator('body').innerText()).slice(0,15000));await page.screenshot({path:path.join(out,'inspect.png')});return;}
 if(action==='eval'){console.log(await eval(command.code));return;}
 if(action==='mark'){await mark(command.name,command.chapter,command.caption,command.duration);return;}
 if(action==='end'){await end();return;}
 if(action==='zoom'){await zoom(command.scale,command.x,command.y);return;}
 if(action==='pause'){await pause(command.ms||2000);return;}
 if(action==='intro'){
 await card('<div class="eyebrow">From research to a working proof of concept</div><div class="title">Borrower-level<br>risk isolation.</div><div class="subtitle">One wallet. Separate borrowing accounts.<br>Aave V3 and V4, through one interface.</div><div class="grid"><div class="tile"><div class="tag">THE RESEARCH</div><b>A new boundary for borrowers</b><p>Hub & Spoke defines market risk.<br>This PoC explores separation between a borrower’s positions.</p></div><div class="tile"><div class="tag">THE DEMO</div><b>Native accounts on a local fork</b><p>Compare → create → manage.<br>Real contract calls with an Anvil test wallet.</p></div></div>'+footer,'01-intro',12);
 await card('<div class="eyebrow">The account is the boundary</div><div class="title">Choose what backs<br>each borrowing position.</div><div class="grid"><div class="tile"><div class="tag">ONE OWNER WALLET</div><b>Position A</b><p>WETH + wstETH collateral<br>USDC debt · its own health factor</p><div class="line"></div><div class="small">Collateral can work together within this account.</div></div><div class="tile"><div class="tag">SAME OWNER · SAME MARKET</div><b>Position B</b><p>WETH collateral<br>USDC debt · its own health factor</p><div class="line"></div><div class="small">A separate account keeps a separate borrowing balance.</div></div></div><div class="subtitle" style="margin-top:35px">Both accounts can interact with the same Aave Spoke.</div>'+footer,'02-boundary',13);
 return;}
 if(action==='connect'){
 await page.evaluate(()=>document.querySelector('#card').style.display='none');
 await app.getByRole('textbox',{name:'Collateral amount 1',exact:true}).waitFor({timeout:180000});
 await click(app.getByRole('button',{name:'Connect wallet',exact:true}).first());
 await click(app.getByRole('dialog').getByRole('button',{name:/MetaMask|Injected|Browser Wallet/i}).first());
 await app.getByRole('button',{name:new RegExp(owner.slice(0,6),'i')}).waitFor({timeout:30000});
 await pause(2000);console.log('CONNECTED');return;}
 if(action==='browse'){
 await mark('03-browse','01 / Discover & compare','Choose the debt and collateral. Compare the Aave markets that support that basket.',10);
 await zoom();await pause(2000);
 await type(app.getByRole('textbox',{name:'Collateral amount 1',exact:true}),'1');
 await type(app.getByRole('textbox',{name:'Debt amount',exact:true}),'500');
 await pause(2000);await end();
 await mark('04-filter','01 / Discover & compare','Filter between V3 and V4. The comparison and rate history follow the selected assets.',9);
 await click(app.getByRole('button',{name:'V3',exact:true}));await pause(1800);await click(app.getByRole('button',{name:'V4',exact:true}));await pause(2500);await end();
 await mark('05-select','02 / Create position A','Select a V4 market. Its displayed base APY excludes the position’s collateral risk premium.',10);
 console.log('MARKETS',await app.locator('.comparison-content button').allTextContents());
 return;}
 if(action==='select'){
 const market=app.getByRole('button',{name:command.market,exact:true});await click(market);
 await zoom(1.08,800,490);await pause(2200);await end();return;}
 if(action==='review'){
 await mark(command.name||'06-review','02 / Create position A','Review collateral, debt, estimated health factor and the exact market before signing.',12);
 await click(app.getByRole('button',{name:'Review position',exact:true}));
 await app.getByRole('dialog',{name:'Review position',exact:true}).waitFor();await zoom(1.45,800,425);await pause(3500);await end();return;}
 if(action==='sign'){
 await mark(command.name||'07-create-a',command.chapter||'02 / Create position A',command.caption||'The test wallet approves the tokens and creates the account through the local factory.',10);
 const review=app.getByRole('dialog',{name:'Review position',exact:true});
 await click(review.getByRole('button',{name:'Approve & sign',exact:true}));
 await review.getByRole('link',{name:'View positions',exact:true}).waitFor({timeout:240000});
 await pause(2200);console.log('CREATED',await review.innerText());await end();return;}
 if(action==='second'){
 const review=app.getByRole('dialog',{name:'Review position',exact:true});await click(review.locator('[data-slot=dialog-close]'));await zoom();
 await mark('08-second','03 / Create position B','Same wallet, same V4 market. A new position gets a different account and its own debt.',15);
 await type(app.getByRole('textbox',{name:'Collateral amount 1',exact:true}),'0.7');
 await type(app.getByRole('textbox',{name:'Debt amount',exact:true}),'250');
 await click(app.getByRole('button',{name:'Review position',exact:true}));await pause(2000);await end();
 return;}
 if(action==='portfolio'){
 await zoom();const link=app.getByRole('dialog').getByRole('link',{name:'View positions',exact:true});await click(link);
 await app.getByRole('table').waitFor({timeout:180000});await pause(1500);
 await mark('10-portfolio','04 / Inspect independent positions','Two accounts, one owner. Each row has its own collateral, debt and health factor.',12);
 await zoom(1.12,800,350);await pause(4000);console.log(await app.locator('tbody').innerText());await end();return;}
 if(action==='manage'){
 await zoom();const row=app.locator('tbody tr').filter({hasText:command.account});
 await mark('11-manage','05 / Add collateral to position A','Add a second collateral asset to Position A. Preview the change in its own health factor.',12);
 await click(row.getByRole('button',{name:/^Manage .* account/}));const manage=app.getByRole('dialog',{name:'Manage position',exact:true});
 await click(manage.getByRole('tab',{name:'Add collateral',exact:true}));await click(manage.getByRole('button',{name:'Management asset',exact:true}));
 const picker=app.getByRole('dialog',{name:'Select collateral asset',exact:true});
 await picker.getByLabel('Search tokens or paste address').fill('wstETH');await click(picker.getByRole('option').first());
 await type(manage.getByRole('textbox',{name:'Management amount',exact:true}),'0.15');await zoom(1.4,800,425);await pause(3000);await end();return;}
 if(action==='confirm-manage'){
 await mark('12-add-confirmed','05 / Add collateral to position A','Confirm the local transaction. WETH and wstETH now back the same account.',10);
 const manage=app.getByRole('dialog',{name:'Manage position',exact:true});await click(manage.getByRole('button',{name:'Confirm add collateral',exact:true}));
 await manage.locator('.execution-step-name .morphing-text-content').filter({hasText:'Position updated.'}).waitFor({timeout:240000});await pause(2000);await end();
 await click(manage.locator('.review-footer').getByRole('button',{name:'Close',exact:true}));await zoom();return;}
 if(action==='repay'){
 await mark('13-repay','06 / Repay one account','Repay 100 USDC on Position A. Position B’s principal stays separate.',13);
 const row=app.locator('tbody tr').filter({hasText:command.account});await click(row.getByRole('button',{name:/^Manage .* account/}));
 const manage=app.getByRole('dialog',{name:'Manage position',exact:true});await type(manage.getByRole('textbox',{name:'Management amount',exact:true}),'100');await zoom(1.4,800,425);await pause(3000);await end();return;}
 if(action==='confirm-repay'){
 await mark('14-repay-confirmed','06 / Repay one account','The repayment is confirmed and the app refreshes this account’s native balances.',8);
 const manage=app.getByRole('dialog',{name:'Manage position',exact:true});await click(manage.getByRole('button',{name:'Confirm repayment',exact:true}));
 await manage.locator('.execution-step-name .morphing-text-content').filter({hasText:'Position updated.'}).waitFor({timeout:240000});await pause(1800);await end();
 await click(manage.locator('.review-footer').getByRole('button',{name:'Close',exact:true}));await zoom();return;}
 if(action==='final-portfolio'){
 await pause(2000);await mark('15-final-portfolio','07 / See the account boundary','Position A has two collaterals and lower debt. Position B retains its own collateral and loan.',10);await zoom(1.12,800,350);await pause(3500);await end();return;}
 if(action==='conclusion'){
 await card(command.html,'16-isolation-proof',14);
 await card('<div class="eyebrow">Post-research proof of concept</div><div class="title">One wallet.<br>Explicit borrowing boundaries.</div><div class="grid"><div class="tile"><div class="tag">DISCOVER</div><b>Compare V3 + V4</b><p>Market rates and asset support.</p></div><div class="tile"><div class="tag">ISOLATE</div><b>Create separate accounts</b><p>Each position owns its debt.</p></div><div class="tile"><div class="tag">MANAGE</div><b>Act on one position</b><p>Add collateral, repay, withdraw.</p></div></div><div class="subtitle" style="margin-top:38px">Recorded on a local Ethereum fork with an Anvil test wallet.</div><div class="small" style="margin-top:12px">Account separation does not remove shared market, oracle or protocol risk. No liquidation was induced in this recording.</div>'+footer,'17-outro',12);return;}
 if(action==='finish'){if(active)await end();await context.close();await page.video().saveAs(path.join(out,'capture.webm'));await browser.close();await save();console.log('FINISHED',path.join(out,'capture.webm'));process.exit(0);}
 throw new Error('Unknown action '+action);
}
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const chain=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})}).then(r=>r.json());if(chain.result!=='0x7a69')throw Error('Local Anvil only.');
 browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.HEADLESS_CHROMIUM||'/Users/saurabh/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:dpr,recordVideo:{dir:out,size:{width:1920*dpr,height:1080*dpr},fps:30}});
 await context.addInitScript(({owner,rpc})=>{
  const listeners=new Map();
  window.ethereum={isMetaMask:true,on:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeListener:(e,fn)=>listeners.get(e)?.delete(fn),request:async({method,params=[]})=>{
   if(method==='eth_requestAccounts'||method==='wallet_requestPermissions'){sessionStorage.setItem('anvil-demo-connected','1');return method==='eth_requestAccounts'?[owner]:[{parentCapability:'eth_accounts'}];}
   if(method==='eth_accounts')return sessionStorage.getItem('anvil-demo-connected')?[owner]:[];
   if(method==='eth_chainId')return '0x7a69';
   if(method==='wallet_getPermissions')return[{parentCapability:'eth_accounts'}];
   if(method==='wallet_getCapabilities')return{};
   if(method==='wallet_switchEthereumChain'||method==='wallet_addEthereumChain'){if(params[0]?.chainId!=='0x7a69')throw Error('Local Anvil only');return null;}
   if(method==='eth_sendTransaction'&&params[0]?.from?.toLowerCase()!==owner)throw Error('Unexpected wallet sender');
   const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method,params})}).then(r=>r.json());
   if(response.error)throw Object.assign(Error(response.error.message),response.error);return response.result;
  }};
 },{owner,rpc});
 await context.route(base+'/demo-studio',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:studio}));
 page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
 page.on('response',async r=>{if(r.request().method()==='POST'&&new URL(r.url()).origin===rpc){try{const req=r.request().postDataJSON();const res=await r.json();if(req.method==='eth_sendTransaction'){transactions.push({request:req.params[0],hash:res.result,error:res.error});console.log('TX',res.result||res.error);await save();}}catch{}}});
 started=Date.now();await page.goto(base+'/demo-studio');app=page.frameLocator('iframe');
 console.log('READY');
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});let queue=Promise.resolve();rl.on('line',line=>{queue=queue.then(async()=>{try{await run(JSON.parse(line));console.log('DONE');}catch(e){console.error('ACTION_ERROR',e.stack);await page.screenshot({path:path.join(out,'error.png')});await save();}});});
})().catch(e=>{console.error(e);process.exit(1);});
