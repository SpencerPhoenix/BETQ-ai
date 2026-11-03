import {createSyntheticEvidenceArchive,syntheticCodePayload} from '../../src/evidence-archive.mjs';

export function makeArchiveFixture({signal=0.25}={}){
  const archive=createSyntheticEvidenceArchive({enabled:true});
  const append=(sourceKind,data,collectorReceivedAt)=>archive.appendReceipt({
    sourceKind,content:typeof data==='string'?data:JSON.stringify(data),collectorReceivedAt});
  const model=append('SYNTHETIC_MODEL',{synthetic:true,modelId:'fixture-logit-v1',
    intercept:-0.2,slope:0.7,trainedThrough:'2025-12-31T23:00:00.000Z'},'2026-01-01T09:00:00.000Z');
  const code=append('SYNTHETIC_CODE',syntheticCodePayload(),'2026-01-01T09:01:00.000Z');
  // Keep noncanonical whitespace to prove exact source-byte retention.
  const featureBytes='{ "synthetic": true, "gameId": "SYNTHETIC_GAME_001", "signal": '+signal+' }\n';
  const features=append('SYNTHETIC_FEATURES',featureBytes,'2026-01-01T09:05:00.000Z');
  const repeated=append('SYNTHETIC_FEATURES',featureBytes,'2026-01-01T09:06:00.000Z');
  const forecastInput={gameId:'SYNTHETIC_GAME_001',frozenAt:'2026-01-01T09:10:00.000Z',
    kickoffAt:'2026-01-01T12:00:00.000Z',inputReceiptId:features.receiptId,
    modelReceiptId:model.receiptId,codeReceiptId:code.receiptId};
  const forecast=archive.freezeForecast(forecastInput);
  const scores={synthetic:true,gameId:'SYNTHETIC_GAME_001',
    kickoffAt:forecast.kickoffAt,completed:true,homeScore:17,awayScore:24};
  const primary=append('SYNTHETIC_PRIMARY_FINAL',scores,'2026-01-01T15:05:00.000Z');
  const secondary=append('SYNTHETIC_SECONDARY_FINAL',scores,'2026-01-01T15:07:00.000Z');
  const settlementInput={forecastId:forecast.forecastId,verifiedAt:'2026-01-01T15:10:00.000Z',
    primaryReceiptId:primary.receiptId,secondaryReceiptId:secondary.receiptId};
  archive.freezeSettlement(settlementInput);
  return {archive,append,features,repeated,model,code,primary,secondary,forecastInput,
    settlementInput,scores,featureBytes,bundle:archive.exportBundle()};
}
