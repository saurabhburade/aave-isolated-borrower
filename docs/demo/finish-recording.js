(async () => {
  const edit = JSON.parse(await fs.readFile(path.join(__dirname, 'edit.json')));
  await fs.mkdir(path.join(out, 'rails'), {recursive:true});
  await page.evaluate(() => {
    document.querySelector('#card').style.display='none';
    Object.assign(document.querySelector('#chapter').style, {width:'310px',fontSize:'14px',lineHeight:'1.4',letterSpacing:'1.4px'});
  });
  for (let i=0; i<edit.scenes.length; i++) {
    const s=edit.scenes[i]; if(s.card) continue;
    await page.evaluate(({s,i,n}) => {
      document.querySelector('#chapter').textContent=s.chapter;
      document.querySelector('#caption').textContent=s.caption;
      document.querySelector('#progress').style.transition='none';
      document.querySelector('#progress').style.width=(i+1)/n*100+'%';
    }, {s,i,n:edit.scenes.length});
    await page.screenshot({path:path.join(out,'rails',s.name+'.png'),clip:{x:0,y:960,width:1920,height:120}});
  }
  console.log('RAILS READY');
  await run({action:'finish'});
})()
