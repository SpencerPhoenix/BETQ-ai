/**
 * Independent, zero-Odds-API settlement reconciliation.
 * This module has no betting, odds, or Render imports. The only remote source
 * it can request is the existing public nflverse schedules release.
 * Scores in that community-maintained source are not official NFL certification.
 */
import {createHash} from 'node:crypto';

export const NFLVERSE_SCHEDULES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const MAX_SCHEDULE_CHARS = 12_000_000;
const POST_KICKOFF_GUARD_MS = 24 * 60 * 60 * 1000;
const allowedGameTypes = new Set(['REG', 'WC', 'DIV', 'CON', 'SB']);
const aliases = Object.freeze({STL:'LA', OAK:'LV', SD:'LAC', JAC:'JAX', WSH:'WAS'});
const canonical = code => aliases[code] ?? code;
const fingerprint = text => createHash('sha256').update(text).digest('hex').slice(0,24);
const asDate = n => new Date(n).toISOString();
/** NFL season boundary, reused by the command and its GitHub audit. */
export function nflSeasonAt(now=Date.now()){
  if(!Number.isFinite(now)) throw Error('INVALID_SEASON_TIMESTAMP');
  const date=new Date(now);
  return date.getUTCFullYear()-(date.getUTCMonth()<2?1:0);
}
const completedScore = n => typeof n === 'string' && /^\d{1,3}$/.test(n.trim()) &&
  Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 100;

/** One bounded, explicit free-source GET; no retries, API keys or live slate. */
export async function fetchNflverseScheduleCsv(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw Error('SCHEDULE_FETCH_UNAVAILABLE');
  const response = await fetchImpl(NFLVERSE_SCHEDULES_URL, {
    headers: {Accept: 'text/csv,text/plain'},
    signal: AbortSignal.timeout(30000)
  });
  if (!response?.ok) throw Error('NFLVERSE_SCHEDULE_HTTP_' + (response?.status ?? 'UNKNOWN'));
  const csv = await response.text();
  if (typeof csv !== 'string' || !csv.length || csv.length > MAX_SCHEDULE_CHARS)
    throw Error('NFLVERSE_SCHEDULE_INVALID_SIZE');
  return csv;
}

/**
 * Append-only settlement revisions; never touches or re-generates snapshots.
 * A game ID with conflicting team/date metadata fails closed (manual review).
 * Wait at least 24 hours after scheduled kickoff AND the following UTC date
 * before accepting community scores. This decreases provisional-score risk
 * but does NOT independently certify a game's final status.
 */
export function selectFinalizedResults(journal, rows, {now=Date.now()}={}) {
  if (!journal || journal.schema !== 1 || journal.sport !== 'americanfootball_nfl' ||
      !Number.isInteger(journal.season) || !Array.isArray(journal.snapshots) ||
      !Array.isArray(journal.settlements) || !Array.isArray(rows) || rows.length > 30000 ||
      !Number.isFinite(now)) throw Error('INVALID_SETTLEMENT_INPUT');

  const tracked = new Map();
  for (const s of journal.snapshots) {
    if (!s || typeof s.gameId !== 'string' || typeof s.gameDate !== 'string' ||
        typeof s.home !== 'string' || typeof s.away !== 'string' ||
        !Number.isFinite(Date.parse(s.commenceTime))) throw Error('INVALID_TRACKED_GAME');
    const identity = {
      season:s.season, home:canonical(s.home), away:canonical(s.away),
      date:s.gameDate, kickoff:Date.parse(s.commenceTime)
    };
    const old=tracked.get(s.gameId);
    if (old && (old.home!==identity.home || old.away!==identity.away ||
      old.season!==identity.season || old.date!==identity.date ||
      old.kickoff!==identity.kickoff)) throw Error('CONTRADICTORY_TRACKED_GAME_ID');
    tracked.set(s.gameId, identity);
  }

  const today=asDate(now).slice(0,10);
  const finalized=new Map();
  for(const row of rows){
    if (!row || typeof row.game_id!=='string') continue;
    const game=tracked.get(row.game_id);
    if (!game) continue;
    // Reject source-ID collisions instead of crediting another game's result.
    if (Number(row.season)!==journal.season ||
        canonical(row.home_team)!==game.home ||
        canonical(row.away_team)!==game.away || row.gameday!==game.date)
      throw Error('SOURCE_GAME_IDENTITY_MISMATCH: '+row.game_id);
    if (!allowedGameTypes.has(row.game_type) || row.gameday>=today ||
        now<game.kickoff+POST_KICKOFF_GUARD_MS ||
        !completedScore(row.home_score) || !completedScore(row.away_score)) continue;
    const homeScore=Number(row.home_score), awayScore=Number(row.away_score);
    const old=finalized.get(row.game_id);
    if (old && (old.homeScore!==homeScore || old.awayScore!==awayScore))
      throw Error('CONTRADICTORY_SOURCE_SCORES: '+row.game_id);
    finalized.set(row.game_id,{
      gameId:row.game_id, gameDate:row.gameday, homeScore, awayScore,
      outcome:homeScore===awayScore?'TIE':homeScore>awayScore?'HOME':'AWAY',
      source:'NFLVERSE_SCHEDULES',
      finalityBasis:'COMMUNITY_SCORE_24H_AFTER_KICKOFF_NOT_LEAGUE_CERTIFIED',
      resultHash:fingerprint(row.game_id+'|'+homeScore+'|'+awayScore)
    });
  }

  return [...finalized.values()];
}

/** Appends corrections exactly once, retaining every prior revision. */
export function reconcileSettlements(journal, rows, {now=Date.now()}={}) {
  const candidates=selectFinalizedResults(journal,rows,{now});
  const latest = new Map();
  for (const s of journal.settlements) {
    if (!s || typeof s.gameId !== 'string' || !Number.isInteger(s.revision) ||
        s.revision<1) throw Error('INVALID_EXISTING_SETTLEMENT');
    const previous=latest.get(s.gameId);
    if (!previous || s.revision>previous.revision) latest.set(s.gameId,s);
    else if (s.revision===previous.revision &&
      (s.homeScore!==previous.homeScore || s.awayScore!==previous.awayScore))
      throw Error('CONTRADICTORY_SETTLEMENT_REVISION');
  }

  const updated=structuredClone(journal);
  const added=[];
  for (const result of candidates) {
    const old=latest.get(result.gameId);
    if (old?.homeScore===result.homeScore && old?.awayScore===result.awayScore) continue;
    const revision=(old?.revision ?? 0)+1;
    const record={...result,verifiedAt:asDate(now),revision};
    updated.settlements.push(record);
    latest.set(result.gameId,record);
    added.push({gameId:result.gameId,revision,outcome:result.outcome});
  }
  return {journal:updated,appended:added.length,added,sourceFinalScoreCandidates:candidates.length};
}
