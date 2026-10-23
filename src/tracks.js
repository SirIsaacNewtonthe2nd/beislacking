// Campaign tracks. Pieces chain from the start cursor (cell i, j, level k, heading h).
// Medal times come from tools/sim.mjs (the bot's time sets the author medal).
export const CAMPAIGN = [
  {
    id: '01', name: 'Opening Lap', tier: 'Easy', author: 25.3,
    start: { i: 30, j: 4, k: 0, h: 0 },
    pieces: 'START S T S S R2 S CP S S L2 U1 S D1 R3 S T S CP S R1 L1 S FIN',
  },
  {
    id: '02', name: 'Switchback', tier: 'Easy', author: 32.096,
    start: { i: 20, j: 4, k: 1, h: 0 },
    pieces: 'START S R1 L1 S CP U1 R2 S D1 L1 R1 S T S L2 CP S R1 S L1 L1 S FIN',
  },
  {
    id: '03', name: 'Kick Off', tier: 'Medium', author: 21.464,
    start: { i: 34, j: 4, k: 2, h: 0 },
    pieces: 'START S S K G G S S CP S R2 S K2 G G G DN S S S S S CP S L3 S K G RING S S FIN',
  },
  {
    id: '04', name: 'Red Dust', tier: 'Medium', author: 41.11,
    start: { i: 30, j: 6, k: 0, h: 0 },
    pieces: 'START S:dirt S:dirt R2:dirt S:dirt L1:dirt R1:dirt S:dirt CP:dirt S:dirt L2:dirt U1:dirt R1:dirt S:dirt S:dirt D1:dirt L3:dirt S:dirt CP S R2:dirt S:dirt FIN',
  },
  {
    id: '05', name: 'Glass Floor', tier: 'Medium', author: 57.018,
    start: { i: 6, j: 30, k: 0, h: 2 },
    pieces: 'START S T S:ice S:ice R2:ice S:ice S CP S L2 S:ice S:ice R3:ice S T S CP L1 S:ice S:ice S FIN',
  },
  {
    id: '06', name: 'Loop Theory', tier: 'Hard', author: 20.083,
    start: { i: 30, j: 6, k: 1, h: 0 },
    pieces: 'START S T S LOOPR S CP BR2 S S T S BL2 S CP S WR S S T LOOPL S FIN',
  },
  {
    id: '07', name: 'Highline', tier: 'Hard', author: 28.375,
    start: { i: 36, j: 36, k: 6, h: 2 },
    pieces: 'START S T2 NE D2 D2 RS CP S L2 S K2 G G G DN S S S S S CP S S WR S U1 S T S BR3 S FIN',
  },
  {
    id: '08', name: 'Carousel', tier: 'Hard', laps: 3, author: 59.322,
    start: { i: 20, j: 20, k: 1, h: 0 },
    pieces: 'START S S S R2 S S CP S R2 S S S S S R2 S S CP S R2 S',
  },
];
