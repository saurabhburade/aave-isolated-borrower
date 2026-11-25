import test from 'node:test';
import assert from 'node:assert/strict';
import {rateFromApr,rateFromApy,normalizeHistory,rateAtOrBefore,historyPlot,historyAxisLabel,sampleHistory,historyBenchmark,historyTooltipLabels} from './rate-history.ts';

test('history axis displays the viewer timezone rather than an unlabelled UTC hour',()=>{
  const date=new Date('2026-10-29T04:00:00Z');
  assert.equal(historyAxisLabel(date,'1d','Asia/Kolkata'),'9:30 AM');
  assert.equal(historyAxisLabel(date,'7d','Asia/Kolkata'),'Oct 29');
  assert.equal(historyAxisLabel(date,'30d','Asia/Kolkata'),'Oct 29');
  assert.equal(historyAxisLabel(date,'90d','Asia/Kolkata'),'Oct 29');
  const tooltip=historyTooltipLabels(Date.parse('2026-10-30T04:39:00Z')/1000,'Asia/Kolkata');
  assert.equal(tooltip.date,'10/30/2026');
  assert.match(tooltip.time,/10:09 AM/);
});

test('longer ranges show at most one actual provider sample per UTC day',()=>{
  const at=(iso:string,apy:number)=>rateFromApy(Date.parse(iso)/1000,apy);
  const points=[
    at('2026-10-28T08:00:00Z',0.03),
    at('2026-10-28T23:50:00Z',0.04),
    at('2026-10-29T00:10:00Z',0.05),
    at('2026-10-29T19:00:00Z',0.06),
    at('2026-10-31T07:00:00Z',0.07),
  ];
  const daily=[points[0],points[3],points[4]];
  for(const window of ['7d','30d','90d'] as const){
    assert.deepEqual(sampleHistory(points,window),daily);
    assert.deepEqual(sampleHistory([...points].reverse(),window),daily);
  }
  assert.equal(points.length,5);
  assert.deepEqual(sampleHistory([], '7d'),[]);
});

test('1D keeps one observed sample per UTC hour',()=>{
  const at=(iso:string)=>rateFromApy(Date.parse(iso)/1000,0.04);
  const points=[at('2026-10-29T08:05:00Z'),at('2026-10-29T08:55:00Z'),at('2026-10-29T09:00:00Z')];
  assert.deepEqual(sampleHistory(points,'1d'),[points[0],points[2]]);
});

test('APY and APR-equivalent conversions retain rate units and round trip',()=>{
  const native=rateFromApr(100,0.05);
  assert.ok(Math.abs(native.apy-0.05127109637602404)<1e-14);
  assert.ok(Math.abs(rateFromApy(100,native.apy).apr-0.05)<1e-14);
  assert.ok(Math.abs(rateFromApy(100,0.05).apr-0.048790164169432)<1e-14);
  assert.equal(rateFromApy(100,0).apr,0);
  for(const rate of [-1,NaN,Infinity])assert.throws(()=>rateFromApy(100,rate));
  assert.throws(()=>rateFromApr(100,1000));
});

test('history normalizes descending provider output without filling missing samples',()=>{
  const points=[rateFromApr(5,0.05),rateFromApr(3,0.03),rateFromApr(1,0.01),rateFromApr(3,0.04)];
  const result=normalizeHistory(points,2,4);
  assert.deepEqual(result,[rateFromApr(3,0.04)]);
  assert.equal(rateAtOrBefore(result,3.5)?.timestamp,3);
  assert.equal(rateAtOrBefore([],3),null);
  assert.throws(()=>normalizeHistory(Array.from({length:4097},()=>rateFromApr(3,0.04)),2,4));
});

test('history readout never selects a provider sample from after the hovered time',()=>{
  const points=[rateFromApy(100,0.03),rateFromApy(400,0.07)];
  assert.equal(rateAtOrBefore(points,150),points[0]);
  assert.equal(rateAtOrBefore(points,350),points[0]);
  assert.equal(rateAtOrBefore(points,400),points[1]);
  assert.equal(rateAtOrBefore(points,50),null);
  assert.equal(rateAtOrBefore(points,350,200),null);
});

test('a fork quote older than the history fetch is not plotted as a current benchmark',()=>{
  const fetchedAt=Date.parse('2026-10-30T04:44:00Z')/1000;
  const forkQuote=Date.parse('2026-10-28T19:10:10Z')/1000;
  assert.equal(historyBenchmark(forkQuote,fetchedAt,0.0448),null);
  assert.equal(historyBenchmark(fetchedAt-90,fetchedAt,0.0448),0.0448);
});


test('linear chart preserves raw rates and sparse provider timestamps',()=>{
  const points=[rateFromApr(100,0.03),rateFromApr(200,0.06),rateFromApr(300,0.12)];
  const series=[{id:'aave',label:'Aave',venue:'Aave',source:'test',detail:'',points},{id:'spark',label:'Spark',venue:'Spark',source:'test',detail:'',points:[rateFromApr(150,0.04),rateFromApr(250,0.05)]}];
  const plot=historyPlot(series,'apr',100,300,0.035)!;
  assert.equal(plot.rows.length,5);
  assert.equal(plot.rows[0].aave,0.03);
  assert.equal(plot.rows[0].spark,undefined);
  assert.equal(plot.rows[1].aave,undefined);
  assert.deepEqual(plot.rows.map((r)=>(r.date as Date).getTime()/1000),[100,150,200,250,300]);
  assert.ok(plot.rows.every((row)=>row.best===0.035));
  assert.ok(plot.max>0.12);
});

test('linear chart includes zero rates without manufacturing provider samples',()=>{
  const series=[{id:'zero',label:'Zero',venue:'Zero',source:'test',detail:'',points:[rateFromApr(100,0),rateFromApr(200,0)]}];
  const plot=historyPlot(series,'apr',100,200,0)!;
  assert.ok(plot.rows.every((row)=>row.zero===0&&row.best===0));
  assert.ok(plot.max>0);
  assert.equal(plot.min,0);
  assert.equal(historyPlot([],'apr',100,200,null),null);
});

test('APY chart y-domain excludes empty low ranges while retaining every rate',()=>{
  const series=[{id:'provider',label:'Provider',venue:'Provider',source:'test',detail:'',points:[rateFromApy(100,0.04),rateFromApy(200,0.06)]}];
  const plot=historyPlot(series,'apy',100,200,0.045)!;
  assert.ok(plot.min>0.02 && plot.min<0.04);
  assert.ok(plot.max>0.06);
  assert.equal(plot.rows[0].provider,0.04);
  assert.equal(plot.rows[1].provider,0.06);
});


test('APY history plots the provider APY directly without compounding it again',()=>{
  const point=rateFromApy(100,0.05);
  const series=[{id:'provider',label:'Provider',venue:'Provider',source:'test',detail:'',points:[point]}];
  const plot=historyPlot(series,'apy',100,200,null)!;
  assert.equal(plot.rows[0].provider,0.05);
  assert.notEqual(plot.rows[0].provider,Math.expm1(0.05));
});
