export const historyWindows = ['1d','7d','30d','90d'] as const;
export type HistoryWindow = typeof historyWindows[number];
export type RateMetric = 'apr' | 'apy';
export type RatePoint = { timestamp:number; apr:number; apy:number };
export type RateSeries = { id:string; label:string; venue:string; source:string; detail:string; points:RatePoint[]; error?:string };
export type RateHistory = { sourceChainId:number; from:number; to:number; fetchedAt:number; series:RateSeries[] };

export function historyAxisLabel(date:Date,window:HistoryWindow,timeZone?:string):string {
  return new Intl.DateTimeFormat('en-US',window==='1d'
    ? {timeZone,hour:'numeric',minute:'2-digit',hour12:true}
    : {timeZone,month:'short',day:'numeric'}).format(date);
}

export function historyTooltipLabels(timestamp:number,timeZone?:string) {
  const date=new Date(timestamp*1000);
  return {
    date:date.toLocaleDateString('en-US',{timeZone,month:'numeric',day:'numeric',year:'numeric'}),
    time:date.toLocaleTimeString('en-US',{timeZone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}),
  };
}

/** Continuous APR equivalent for comparing indexed APY samples on a common chart. */
export function rateFromApy(timestamp:number,apy:number):RatePoint {
  if (!Number.isFinite(timestamp) || !Number.isFinite(apy) || apy < 0) throw new Error('Invalid historical rate');
  return {timestamp,apy,apr:Math.log1p(apy)};
}

export function rateFromApr(timestamp:number,apr:number):RatePoint {
  if (!Number.isFinite(timestamp) || !Number.isFinite(apr) || apr < 0 || !Number.isFinite(Math.expm1(apr))) throw new Error('Invalid historical rate');
  return {timestamp,apr,apy:Math.expm1(apr)};
}

export function normalizeHistory(points:RatePoint[],from:number,to:number):RatePoint[] {
  if (points.length > 4096) throw new Error('History response exceeds sample limit');
  const valid = points.filter((p)=>p.timestamp>=from && p.timestamp<=to && [p.timestamp,p.apr,p.apy].every(Number.isFinite) && p.apr>=0 && p.apy>=0);
  return [...new Map(valid.map((point)=>[point.timestamp,point])).values()].sort((a,b)=>a.timestamp-b.timestamp);
}

/** Keep one real observation per UTC bucket, starting the first partial bucket at its earliest sample. */
export function sampleHistory(points:RatePoint[],window:HistoryWindow):RatePoint[] {
  const interval=window==='1d'?3600:86400;
  const firstBucket=Math.min(...points.map((point)=>Math.floor(point.timestamp/interval)));
  const buckets=new Map<number,RatePoint>();
  for(const point of points){
    const bucket=Math.floor(point.timestamp/interval);
    const previous=buckets.get(bucket);
    if(!previous || (bucket===firstBucket?point.timestamp<previous.timestamp:point.timestamp>previous.timestamp))buckets.set(bucket,point);
  }
  return [...buckets.values()].sort((a,b)=>a.timestamp-b.timestamp);
}

/** The value known as of the cursor, never a sample from its future. */
export function rateAtOrBefore(points:RatePoint[],timestamp:number,maxAge=Number.POSITIVE_INFINITY):RatePoint | null {
  const latest=points.reduce<RatePoint|null>((best,p)=>p.timestamp<=timestamp&&(!best||p.timestamp>best.timestamp)?p:best,null);
  return latest&&timestamp-latest.timestamp<=maxAge?latest:null;
}

/** A fork snapshot is not a current mainnet benchmark once its block time is stale. */
export function historyBenchmark(quoteTimestamp:number,fetchedAt:number,rate:number):number|null {
  return Number.isFinite(quoteTimestamp)&&Number.isFinite(fetchedAt)&&Number.isFinite(rate)&&rate>=0
    && quoteTimestamp<=fetchedAt&&fetchedAt-quoteTimestamp<=300?rate:null;
}

/** Sparse rows retain each provider's actual timestamps and raw rate values. */
export function historyPlot(series:RateSeries[],metric:RateMetric,from:number,to:number,best:number|null) {
  const reference=best!==null&&Number.isFinite(best)&&best>=0?best:null;
  const rows=new Map<number,Record<string,unknown>>();
  let min=Number.POSITIVE_INFINITY;
  let max=0;
  for(const s of series)for(const point of s.points){
    const value=point[metric];
    if(!Number.isFinite(point.timestamp)||!Number.isFinite(value)||point.timestamp<from||point.timestamp>to||value<0)continue;
    const row=rows.get(point.timestamp)??{date:new Date(point.timestamp*1000)};
    row[s.id]=value;rows.set(point.timestamp,row);min=Math.min(min,value);max=Math.max(max,value);
  }
  if(reference!==null){
    for(const timestamp of [from,to])if(!rows.has(timestamp))rows.set(timestamp,{date:new Date(timestamp*1000)});
    for(const row of rows.values())row.best=reference;
    min=Math.min(min,reference);max=Math.max(max,reference);
  }
  if(!rows.size)return null;
  const padding=Math.max((max-min)*0.1,max*0.03,0.0005);
  return {rows:[...rows.entries()].sort(([a],[b])=>a-b).map(([,row])=>row),min:Math.max(0,min-padding),max:max+padding};
}
