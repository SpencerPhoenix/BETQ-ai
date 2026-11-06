/** Small, dependency-free boundary checks shared by research and HTTP code. */
export const DAY_MS = 86400000;
export const timestamp = value => typeof value === 'string' && value.trim() !== '' ? Date.parse(value) : NaN;
export const isProbability = value => Number.isFinite(value) && value > 0 && value < 1;
export const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
export function sourceDateFresh(day, now, maxAgeDays=28) {
  if (!validDay(day) || !Number.isFinite(now)) return false;
  const start=Date.parse(day+'T00:00:00Z');
  return start <= now && now-start <= maxAgeDays*DAY_MS;
}
export function nflGameDate(event) {
  if (validDay(event?.gameDate)) return event.gameDate;
  const kick=timestamp(event?.commence_time);
  if (!Number.isFinite(kick)) return null;
  // NFL schedules use the Eastern local game date, not the following UTC day.
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(kick);
  const get=t=>parts.find(p=>p.type===t).value;
  return get('year')+'-'+get('month')+'-'+get('day');
}
/** Reject during streaming rather than allocating an unlimited response body. */
export async function readBoundedText(response, maxBytes) {
  const claimed=Number(response.headers?.get('content-length'));
  if (Number.isFinite(claimed) && claimed > maxBytes) {
    await response.body?.cancel().catch(()=>{});
    throw new Error('BODY_TOO_LARGE');
  }
  if (!response.body?.getReader) {
    const text=await response.text();
    if (Buffer.byteLength(text,'utf8')>maxBytes) throw new Error('BODY_TOO_LARGE');
    return text;
  }
  const reader=response.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0, text='';
  try {
    while(true){
      const {done,value}=await reader.read(); if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes) throw new Error('BODY_TOO_LARGE');
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } catch(error) { await reader.cancel().catch(()=>{}); throw error; }
  finally {reader.releaseLock();}
}
