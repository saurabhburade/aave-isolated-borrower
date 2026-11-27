(async () => {
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
