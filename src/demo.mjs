/**
 * Synthetic data: fictional teams and invented prices.
 * Every consumer must keep the DEMO label; never treat as current games/odds.
 */
export function demoEvents(sport = 'americanfootball_nfl', asOf = Date.now()) {
  const sets = [
    ['Metro Comets', 'Coastal Wolves', [135, -155], [112, -125], [118, -130], [110, -120]],
    ['Summit Arrows', 'Capital Forge', [-135, 125], [-132, 120], [-125, 115], [-128, 118]],
    ['Prairie Orbit', 'Harbor Titans', [-105, -105], [-110, 100], [-115, 102], [-108, -102]]
  ];
  const books = [
    ['demo-alpha', 'Demo Book Alpha'],
    ['demo-bravo', 'Demo Book Bravo'],
    ['demo-charlie', 'Demo Book Charlie'],
    ['demo-delta', 'Demo Book Delta']
  ];
  return sets.map(([home, away, ...prices], eventIndex) => {
    const start = new Date(asOf + (eventIndex + 2) * 3600000).toISOString();
    return {
      id: 'demo-' + (eventIndex + 1), sport_key: sport,
      home_team: home, away_team: away, commence_time: start,
      bookmakers: books.map(([key, title], bookIndex) => {
        const [homePrice, awayPrice] = prices[bookIndex];
        const spread = eventIndex === 1 ? -2.5 : -3.5;
        const total = eventIndex === 2 ? 44.5 : 47.5;
        const update = new Date(asOf - 30000 - bookIndex * 15000).toISOString();
        return {
          key, title, last_update: update, markets: [
            { key: 'h2h', last_update: update, outcomes: [
              { name: home, price: homePrice }, { name: away, price: awayPrice }
            ] },
            { key: 'spreads', last_update: update, outcomes: [
              { name: home, price: bookIndex === 0 ? -102 : -112, point: spread },
              { name: away, price: bookIndex === 0 ? -118 : -108, point: -spread }
            ] },
            { key: 'totals', last_update: update, outcomes: [
              { name: 'Over', price: bookIndex === 0 ? +105 : -110, point: total },
              { name: 'Under', price: bookIndex === 0 ? -125 : -110, point: total }
            ] }
          ]
        };
      })
    };
  });
}
