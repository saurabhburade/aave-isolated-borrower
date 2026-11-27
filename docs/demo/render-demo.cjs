const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root=__dirname;
function command(executable,args){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err=(err+d).slice(-6000));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(executable+' '+code+'\n'+err)));});}
(async()=>{
  const edit=JSON.parse(await fs.readFile(path.join(root,'edit.json')));
  const timeline=JSON.parse(await fs.readFile(path.join(root,'raw/timeline.json')));
  const clips=path.join(root,'raw/clips');await fs.mkdir(clips,{recursive:true});
  const video=path.join(root,'raw/capture.webm');
  const results=[];
  for(const scene of edit.scenes){
    const matches=timeline.scenes.filter(s=>s.name===scene.name);
    const source=scene.occurrence===undefined?matches.at(-1):matches[scene.occurrence];
    if(!source)throw Error('Missing scene '+scene.name);
    const length=source.end-source.start;
    const output=path.join(clips,scene.name+'.mp4');
    let filter;
    if(scene.skipWait&&length>scene.duration){
      const first=2.7,last=scene.duration-first-0.4;
      filter=`[0:v]split=2[a][b];[a]trim=start=0:end=${first},setpts=PTS-STARTPTS[a1];[b]trim=start=${Math.max(first,length-last)}:end=${length},setpts=PTS-STARTPTS[b1];[a1][b1]concat=n=2:v=1:a=0[cut];[cut]tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},fps=${edit.fps}[footage]`;
    }else{
      const speed=length>scene.duration?length/(scene.duration-0.3):1;
      filter=`[0:v]trim=duration=${length},setpts=(PTS-STARTPTS)/${speed},tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},fps=${edit.fps}[footage]`;
    }
    const args=['-hide_banner','-loglevel','error','-y','-ss',String(source.start),'-i',video];
    if(!scene.card){args.push('-loop','1','-framerate',String(edit.fps),'-i',path.join(root,'raw/rails',scene.name+'.png'));filter+=';[footage][1:v]overlay=0:960:shortest=1[framed]';}
    const label=scene.card?'footage':'framed';
    const fades=scene.name==='01-intro'?',fade=t=in:st=0:d=0.4':scene.name==='17-outro'?`,fade=t=out:st=${scene.duration-.7}:d=.7`:'';
    filter+=`;[${label}]format=yuv420p${fades}[v]`;
    args.push('-filter_complex',filter,'-map','[v]','-an','-t',String(scene.duration),'-c:v','libx264','-preset','fast','-crf','16','-profile:v','high','-level','4.1','-threads','4','-movflags','+faststart',output);
    await command('ffmpeg',args);console.log('RENDERED',scene.name,scene.duration+'s');
    results.push({name:scene.name,source,output,duration:scene.duration,chapter:scene.chapter||scene.name,caption:scene.caption||''});
  }
  const list=path.join(clips,'concat.txt');
  await fs.writeFile(list,results.map(r=>"file '"+r.output.replaceAll("'","'\\''")+"'").join('\n'));
  let elapsed=0;let meta=';FFMETADATA1\ntitle=Aave isolated positions - post-research PoC\nartist=saurabh_evm\ncomment=Native local-fork transactions; captioned walkthrough with edited loading waits.\n';
  for(const r of results){meta+=`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${elapsed*1000}\nEND=${(elapsed+r.duration)*1000}\ntitle=${r.chapter}\n`;elapsed+=r.duration;}
  const metadata=path.join(clips,'chapters.txt');await fs.writeFile(metadata,meta);
  const output=path.join(root,'aave-isolated-positions-poc-1080p.mp4');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-i',metadata,'-map','0:v','-map_metadata','1','-map_chapters','1','-c:v','copy','-movflags','+faststart',output]);
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','4','-i',output,'-frames:v','1',path.join(root,'poster.png')]);
  await fs.writeFile(path.join(root,'export.json'),JSON.stringify({output,width:edit.width,height:edit.height,fps:edit.fps,duration:elapsed,source:edit.research,scenes:results},null,2));
  console.log('EXPORTED',output,elapsed+'s');
})().catch(e=>{console.error(e);process.exitCode=1;});
