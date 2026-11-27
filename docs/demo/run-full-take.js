(async () => {
  await run({action:'connect'});
  await run({action:'browse'});
  await run({action:'select',market:'Aave V4 Main / Core'});
  await run({action:'review'});
  await run({action:'sign'});
  await run({action:'second'});
  await zoom(1.45,800,425);
  await run({action:'sign',name:'09-create-b',chapter:'03 / Create position B',caption:'Create the second account in the same market. Each position has a distinct on-chain address.'});
  await run({action:'portfolio'});
  const endpoint=`${base}/api/positions?chainId=31337&owner=${owner}`;
  const before=await fetch(endpoint).then(r=>r.json());
  await fs.writeFile(path.join(out,'before-management.json'),JSON.stringify(before,null,2));
  const a=before.positions.find(p=>Number(p.debts[0]?.amount)>450);
  if(before.positions.length!==2||!a)throw Error('Unexpected demo positions.');
  await run({action:'manage',account:short(a.account)});
  await run({action:'confirm-manage'});
  await run({action:'repay',account:short(a.account)});
  await run({action:'confirm-repay'});
  await run({action:'final-portfolio'});
  const after=await fetch(endpoint).then(r=>r.json());
  await fs.writeFile(path.join(out,'after-management.json'),JSON.stringify(after,null,2));
  await eval(await fs.readFile(path.join(__dirname,'finish-recording.js'),'utf8'));
})()
