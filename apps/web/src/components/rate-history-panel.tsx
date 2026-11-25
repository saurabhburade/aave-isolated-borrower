'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRateHistory} from '@/hooks/use-protocol-data';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup,ToggleGroupItem} from '@/components/ui/toggle-group';
import {InfoTip} from '@/components/ui/info-tip';
import {TooltipProvider} from '@/components/ui/tooltip';
import {historyAxisLabel,historyPlot,historyTooltipLabels,rateAtOrBefore,sampleHistory,type HistoryWindow,type RateHistory} from '@/lib/rate-history';
import type {Network} from '@/lib/networks';
import type {Asset} from '@/lib/domain';
import type {ComparisonMarket} from '@/lib/market-catalog';
import {curveMonotoneX} from '@visx/curve';
import {LineChart,Line} from '@/components/charts/line-chart';
import {Grid} from '@/components/charts/grid';
import {XAxis} from '@/components/charts/x-axis';
import {ChartTooltip} from '@/components/charts/tooltip';
import {useChart,useChartStable} from '@/components/charts/chart-context';


function seriesColor(id:string):string {
  let hash=0;
  for(const character of id)hash=Math.imul(hash^character.charCodeAt(0),16777619)>>>0;
  hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;
  return `light-dark(hsl(${hash%360} 62% 42%), hsl(${hash%360} 72% 70%))`;
}
const help='Borrow APY history for every market matching the selected loan asset, collateral, and market version. V4 shows each Spoke’s base rate before the collateral-dependent premium. Local fork quotes can be older than this history. Rates exclude rewards and are not execution quotes.';
const dateLabel=(time:number)=>new Date(time*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const valueLabel=(value:number)=>`${(value*100).toFixed(2)}%`;

export function RateHistoryPanel({network,debt,markets,marketsLoading}:{network:Network;debt?:Asset;markets:ComparisonMarket[];marketsLoading:boolean}) {
  const debtAddress=debt?.address;
  const marketIds=JSON.stringify(markets.map(market=>market.id).sort());
  const [period,setPeriod]=useState<HistoryWindow>('7d');
  const metric='apy' as const;
  const requestKey=JSON.stringify([network.id,period,debtAddress,marketIds]);
  const {data,error,loading}=useRateHistory(network.id,period,debtAddress,marketIds);
  const pending=loading || marketsLoading && !markets.length;
  const [cursor,setCursor]=useState<number|null>(null);
  useEffect(()=>setCursor(null),[requestKey]);
  const chartSeries=useMemo(()=>data?.series.map((series)=>({...series,label:series.label.replace(/^Aave\s+/,''),points:sampleHistory(series.points,period)}))??[],[data,period]);
  const visible=useMemo(()=>chartSeries.filter((s)=>s.points.length>1),[chartSeries]);
  const plot=useMemo(()=>data?historyPlot(visible,metric,data.from,data.to,null):null,[data,visible,metric]);
  const readout=(timestamp:number)=>{const labels=historyTooltipLabels(timestamp);return <div className="history-samples">
    <div className="history-samples-time"><time dateTime={new Date(timestamp*1000).toISOString()}>{labels.date}</time><span>{labels.time}</span></div>
    {chartSeries.map((series)=>{
      const point=rateAtOrBefore(series.points,timestamp,period==='1d'?7200:172800);
      return <div className="history-sample" key={series.id}>
        <span className="history-series-dot" style={{background:seriesColor(series.id)}}/><span className="history-sample-name">{series.label}</span><b>{point?valueLabel(point[metric]):'-'}</b>
      </div>;
    })}

  </div>;};
  return <Card className="history-card">
    <CardHeader><div className="history-heading"><div className="history-title"><CardTitle>Borrow APY</CardTitle><TooltipProvider><InfoTip label="rate history" text={`${help}${data?` Updated ${dateLabel(data.fetchedAt)}.`:''}`}/></TooltipProvider></div><div className="history-controls">
      <ToggleGroup aria-label="History period" value={[period]} onValueChange={(values)=>{if(values[0])setPeriod(values[0] as HistoryWindow);}} spacing={0}>{(['1d','7d','30d','90d'] as const).map((value)=><ToggleGroupItem key={value} value={value}>{value.toUpperCase()}</ToggleGroupItem>)}</ToggleGroup>
    </div></div></CardHeader>
    <CardContent className="history-content">
      <div className="history-chart-stage" data-loading={pending || undefined} aria-busy={pending}>
      <div className="history-loading-layer" aria-hidden="true"><Skeleton className="history-skeleton"/></div>
      <div className="history-chart-result" aria-hidden={pending || undefined}>
      {pending?null:error?<div className="history-empty" role="status">{error}</div>:chartSeries.every((s)=>s.points.length<2)?<div className="history-empty" role="status">{!debt?'Select a loan asset to see its borrow APY history.':!markets.length?'No markets support this asset and collateral combination.':'Historical rates are unavailable for the matching markets.'}</div>:data&&plot?<div className="history-plot" data-scale="linear" onMouseMove={()=>setCursor(null)} tabIndex={0} role="group" aria-roledescription="line chart" aria-label={`${debt?.symbol ?? "Loan asset"} borrow ${metric.toUpperCase()} history for ${visible.length} matching market reserves on a linear scale. Times are shown in your local timezone. Use arrow keys to inspect rates.`} onBlur={()=>setCursor(null)} onKeyDown={(event)=>{if(event.key==='Escape')setCursor(null);else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setCursor((current)=>event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,(current??0.5)+(event.key==='ArrowLeft'?-0.05:0.05))));}}}>
        <LineChart data={plot.rows} margin={{top:18,right:18,bottom:34,left:52}} aspectRatio={undefined} style={{height:260,aspectRatio:'auto',touchAction:'pan-y'}} xDomain={[new Date(data.from*1000),new Date(data.to*1000)]} yScaleDomainMin={plot.min} yScaleDomainMax={plot.max/1.1} yDomainTween={false} animationDuration={650}>
          <HistoryGrid/>
          <RateAxis/>
          {visible.map((series)=><Line key={series.id} dataKey={series.id} stroke={seriesColor(series.id)} strokeWidth={2} curve={curveMonotoneX} fadeEdges={false} animate={false} showHighlight={false}/>)}
          <XAxis tickMode="domain" numTicks={period==='1d'?{base:4,sm:5,md:7}:period==='7d'?{base:4,sm:5,md:8}:{base:4,sm:5,md:7}} formatTick={(date)=>historyAxisLabel(date,period)}/>
          {cursor===null?<ChartTooltip showDots={false} showDatePill={false} indicatorDasharray="3 3" indicatorColor="var(--muted-foreground)" content={({point})=>readout((point.date as Date).getTime()/1000)} className="history-bklit-tooltip"/>:null}
          <KeyboardHistoryCursor fraction={cursor}/>
        </LineChart>
        {cursor!==null?<div className="history-readout" role="status">{readout(data.from+cursor*(data.to-data.from))}</div>:null}
      </div>:data?<div className="history-empty" role="status">Historical rates are unavailable.</div>:null}
      </div>
      </div>
      <div className="history-legend-space" data-loading={pending || undefined}>
      {!loading && !error && chartSeries.length ? <ul className="history-legend" aria-label="Markets in borrow APY chart">{chartSeries.map(series=><li key={series.id} title={`${series.detail}${series.error?` · ${series.error}`:''}`}>
        <span className="history-series-dot" style={{background:seriesColor(series.id)}}/>
        <span>{series.label}</span>{series.points.length<2?<span className="text-muted-foreground">History unavailable</span>:null}
      </li>)}</ul>:null}
      </div>
    </CardContent>
  </Card>;
}

function rateTicks(domain:number[]):number[] {
  const [min=0,max=0.01]=domain;
  return [0,0.25,0.5,0.75,1].map((fraction)=>min+(max-min)*fraction);
}
function HistoryGrid() {
  const {yScale}=useChartStable();
  return <Grid rowTickValues={rateTicks(yScale.domain())} stroke="var(--border)" strokeOpacity={0.6} strokeDasharray="3 5" fadeHorizontal={false}/>;
}
function RateAxis() {
  const {yScale}=useChartStable();
  return <g aria-hidden="true">{rateTicks(yScale.domain()).slice(1).map((value)=> <text key={value} x={-9} y={(yScale(value)??0)+4} textAnchor="end" className="history-axis">{valueLabel(value)}</text>)}</g>;
}
RateAxis.displayName="YAxis";
function KeyboardHistoryCursor({fraction}:{fraction:number|null}) {
  const {innerWidth,innerHeight}=useChart();
  return fraction===null?null:<line x1={innerWidth*fraction} x2={innerWidth*fraction} y1={0} y2={innerHeight} className="history-cursor"/>;
}
