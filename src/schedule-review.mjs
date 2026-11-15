/** Pure schedule parsing and separately observed schedule notes. Never rewrites forecasts or qualifies results. */
export function scheduledInstant(value) {
  if (typeof value !== 'string') return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return NaN;
  const [, y, m, d, h, minute, second, fraction, zone] = parts;
  const milliseconds = Number((fraction || '').padEnd(3, '0'));
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return NaN;
  const at = Date.parse(value), local = new Date(at + offset * 60000);
  if (!Number.isFinite(at) || local.getUTCFullYear() !== Number(y) || local.getUTCMonth() + 1 !== Number(m) ||
      local.getUTCDate() !== Number(d) || local.getUTCHours() !== Number(h) || local.getUTCMinutes() !== Number(minute) ||
      local.getUTCSeconds() !== Number(second) || local.getUTCMilliseconds() !== milliseconds) return NaN;
  return at;
}

// A dated manual observation, NOT a live schedule feed or a scoring receipt.
// Older official release/ticket pages retained 13:05; dated Nov 4–5 team coverage and game centers show 13:25 PST.
const observation = Object.freeze({
  gameId: '2026_09_LV_SF', season: 2026, home: 'SF', away: 'LV', gameDate: '2026-11-08',
  providerEventId: 'ac9d38a18d5c92814233a31aa9a48d78',
  publishedCommenceTime: '2026-11-08T21:25:00.000Z', observedAt: '2026-11-07T19:43:37.000Z',
  sources: Object.freeze([
    Object.freeze({url: 'https://www.49ers.com/news/ways-to-watch-and-listen-raiders-vs-49ers-week-9', publicationDate: '2026-11-04', label: '49ers game information'}),
    Object.freeze({url: 'https://www.raiders.com/news/how-to-watch-listen-to-and-livestream-raiders-at-49ers', publicationDate: '2026-11-05', label: 'Raiders game information'})
  ])
});
export function scheduleReviewFor(identity, now = Date.now()) {
  const base = {status: 'CURRENT_SCHEDULE_UNVERIFIED', frozenCommenceTime: identity?.commenceTime ?? null,
    currentScheduleVerified: false, scoringAuthorization: false, publicationTimeVerified: false,
    publishedCommenceTime: null, observedAt: null, sources: []};
  if (!identity || !Number.isFinite(now) || now < Date.parse(observation.observedAt)) return base;
  const ids = Array.isArray(identity.providerEventIds) ? identity.providerEventIds : [identity.providerEventId];
  if (identity.gameId !== observation.gameId && !ids.includes(observation.providerEventId)) return base;
  if ((identity.gameId !== undefined && identity.gameId !== observation.gameId) ||
      (identity.providerEventIds !== undefined && !Array.isArray(identity.providerEventIds)) ||
      identity.season !== observation.season || identity.home !== observation.home || identity.away !== observation.away ||
      identity.gameDate !== observation.gameDate || !ids.includes(observation.providerEventId) ||
      !Number.isFinite(scheduledInstant(identity.commenceTime))) return {...base, status: 'SCHEDULE_REVIEW_IDENTITY_MISMATCH'};
  return {...base,
    status: scheduledInstant(identity.commenceTime) === Date.parse(observation.publishedCommenceTime) ?
      'MATCHES_DATED_SCHEDULE_OBSERVATION' : 'SCHEDULE_RECONCILIATION_REQUIRED',
    publishedCommenceTime: observation.publishedCommenceTime, observedAt: observation.observedAt,
    sources: observation.sources.map(source => ({...source})),
    notice: 'Separately observed official team schedule, not a live schedule or result receipt. Frozen kickoff and forecast chronology are unchanged.'};
}
export function eventScheduleReview(event, now) {
  // This mapping only adds a dated note for the exact known NFL provider event.
  if (event?.sport_key !== 'americanfootball_nfl' || event?.id !== observation.providerEventId) return scheduleReviewFor(null, now);
  const at = scheduledInstant(event.commence_time);
  return scheduleReviewFor({providerEventId: event.id, season: 2026,
    home: event.home_team === 'San Francisco 49ers' ? 'SF' : event.home_team,
    away: event.away_team === 'Las Vegas Raiders' ? 'LV' : event.away_team,
    gameDate: Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null,
    commenceTime: event.commence_time}, now);
}
