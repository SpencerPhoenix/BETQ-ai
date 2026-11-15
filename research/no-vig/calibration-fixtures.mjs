/** Descriptive binary scoring/reliability diagnostics. No calibration is fitted. */
export const CALIBRATION_VERSION='betq-fixed-binary-diagnostics-rebuilt-v1';
const Z=1.959963984540054;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function fail(code){const error=new Error(code);error.code=code;throw error;}
function wilson(wins,n){
  if(!n)return null;
  const p=wins/n,z2=Z*Z,denominator=1+z2/n;
  const center=(p+z2/(2*n))/denominator;
  const half=Z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/denominator;
  return {lower:Math.max(0,center-half),upper:Math.min(1,center+half),level:.95,
    method:'WILSON_IID_BINOMIAL',interpretation:'Descriptive bin event-rate interval, not forecast uncertainty; dependence is not adjusted.'};
}
export function binaryCalibrationDiagnostics(rows){
  if(!Array.isArray(rows)||rows.length>20000)fail('INVALID_DIAGNOSTIC_ROWS');
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,upperInclusive:i===9,n:0,wins:0,probabilitySum:0}));
  const ids=new Set();let sumBrier=0,sumLogLoss=0,zeroProbabilityMistakes=0,totalWins=0,totalP=0;
  for(const row of rows){
    if(!row||typeof row.id!=='string'||!row.id||row.id.length>200||ids.has(row.id)||
      !finite(row.probability)||row.probability<0||row.probability>1||
      !(row.outcome===0||row.outcome===1))fail('INVALID_OR_DUPLICATE_BINARY_OBSERVATION');
    ids.add(row.id);const p=row.probability,y=row.outcome;
    // Multiplying p by 10 can round the predecessor of 0.9 up to 9. Compare boundaries directly.
    const bin=bins.find(b=>p<b.upper)||bins[9];bin.n++;bin.wins+=y;bin.probabilitySum+=p;
    totalWins+=y;totalP+=p;sumBrier+=(p-y)**2;
    if((p===0&&y===1)||(p===1&&y===0))zeroProbabilityMistakes++;
    else sumLogLoss+=y===1?-Math.log(p):-Math.log1p(-p);
  }
  const n=rows.length;
  const reliability=bins.map(({probabilitySum,...bin})=>({...bin,meanProbability:bin.n?probabilitySum/bin.n:null,
    observedRate:bin.n?bin.wins/bin.n:null,eventRate95:wilson(bin.wins,bin.n)}));
  return {version:CALIBRATION_VERSION,scope:'DESCRIPTIVE_BINARY_SCORE_DIAGNOSTICS',n,
    status:n?'DESCRIPTIVE_ONLY_NOT_VALIDATION':'INSUFFICIENT_DATA',
    brier:n?sumBrier/n:null,logLoss:n&&!zeroProbabilityMistakes?sumLogLoss/n:null,
    logLossStatus:!n?'NO_OBSERVATIONS':zeroProbabilityMistakes?'POSITIVE_INFINITY':'FINITE',zeroProbabilityMistakes,
    meanProbability:n?totalP/n:null,observedRate:n?totalWins/n:null,
    ece:n?reliability.reduce((sum,b)=>sum+b.n*Math.abs((b.meanProbability??0)-(b.observedRate??0)),0)/n:null,
    binPolicy:'TEN_FIXED_EQUAL_WIDTH_BINS_LEFT_CLOSED_RIGHT_OPEN_EXCEPT_ONE',reliability,
    fittedCalibration:false,calibrationEstablished:false,promotionAllowed:false,
    limitations:['Input chronology and outcome provenance must be audited separately.',
      'Pushes, ties and voids are not binary losses; exclude or model them under a frozen contract.',
      'ECE depends on bins and finite samples; low ECE is not proof of calibration.',
      'Wilson intervals assume independent Bernoulli observations; recurring teams and time dependence remain.',
      'These diagnostics do not estimate per-game uncertainty, executable value, ROI or a betting edge.']};
}
