/**
 * Independent two-outcome overround arithmetic, rebuilt as an offline candidate.
 * No third-party code/dependencies, fitting, I/O or production integration.
 * Sources, license references and limitations: docs/NO_VIG_BENCHMARK_REBUILT.md.
 */
export const NO_VIG_VERSION='betq-two-way-no-vig-rebuilt-v1';
export const ZERO_MARGIN_TOLERANCE=8*Number.EPSILON;
export const NO_VIG_METHODS=Object.freeze(['PROPORTIONAL','SHIN_TWO_OUTCOME']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function fail(code){const error=new Error(code);error.code=code;throw error;}
export function americanToDecimal(price){
  if(!finite(price)||Math.abs(price)<100)fail('INVALID_AMERICAN_ODDS');
  const decimal=price>0?1+price/100:1+100/(-price);
  if(!finite(decimal)||decimal<=1)fail('UNREPRESENTABLE_DECIMAL_ODDS');
  return decimal;
}
export function deVigPair(decimalOdds,{method='PROPORTIONAL'}={}){
  if(!NO_VIG_METHODS.includes(method))fail('UNSUPPORTED_NO_VIG_METHOD');
  if(!Array.isArray(decimalOdds)||decimalOdds.length!==2||
    !decimalOdds.every(d=>finite(d)&&d>1))fail('INVALID_TWO_OUTCOME_DECIMAL_ODDS');
  const q=decimalOdds.map(d=>1/d),sum=q[0]+q[1],overround=sum-1;
  if(!q.every(v=>v>0&&v<1)||!finite(sum)||sum<=0)fail('NUMERICAL_DOMAIN');
  let probabilities,parameters={};
  if(method==='PROPORTIONAL')probabilities=q.map(v=>v/sum);
  else{
    if(overround < -ZERO_MARGIN_TOLERANCE)fail('SHIN_UNDERROUND_UNSUPPORTED');
    const difference=q[0]-q[1];
    // The binary Shin solution equals additive de-vig. No general-market solver.
    probabilities=[(1+difference)/2,(1-difference)/2];
    // Derived from the two quadratic identities q_i²/S=(1-z)p_i²+z*p_i.
    // z belongs to the assumed model, not evidence of actual insider activity.
    const z=Math.max(0,overround)*(sum-difference*difference)/(sum*(1-difference*difference));
    if(!finite(z)||z<0||z>=1)fail('SHIN_PARAMETER_OUT_OF_DOMAIN');
    parameters={z,equivalentMethod:'TWO_OUTCOME_ADDITIVE'};
  }
  if(!probabilities.every(v=>finite(v)&&v>0&&v<1)||
    Math.abs(probabilities[0]+probabilities[1]-1)>ZERO_MARGIN_TOLERANCE)fail('NUMERICAL_DOMAIN');
  return {version:NO_VIG_VERSION,method,inputFormat:'DECIMAL',decimalOdds:[...decimalOdds],
    impliedProbabilities:q,probabilities,overround,parameters,
    marginState:Math.abs(overround)<=ZERO_MARGIN_TOLERANCE?'ZERO_WITHIN_FLOATING_TOLERANCE':overround>0?'OVERROUND':'UNDERROUND',
    roundingTolerance:ZERO_MARGIN_TOLERANCE,basis:'MARKET_DERIVED_NOT_INDEPENDENT',
    evidence:'NUMERICAL_TRANSFORM_ONLY',independentlyValidated:false,verifiedEdge:false};
}
export function deVigAmericanPair(prices,options={}){
  if(!Array.isArray(prices)||prices.length!==2)fail('INVALID_TWO_OUTCOME_AMERICAN_ODDS');
  return {...deVigPair(prices.map(americanToDecimal),options),inputFormat:'AMERICAN',americanOdds:[...prices]};
}
