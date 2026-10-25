// Campaign tracks. Pieces chain from the start cursor (cell i, j, level k, heading h).
// Medal times come from tools/sim.mjs (the bot's time sets the author medal).
export const CAMPAIGN = [
  {
    id: '01', name: 'Opening Lap', tier: 'Easy', author: 22.909,
    start: { i: 30, j: 4, k: 0, h: 0 },
    pieces: 'START S T S S R2 S CP S S L2 U1 S D1 R3 S T S CP S R1 L1 S FIN',
  },
  {
    id: '02', name: 'Switchback', tier: 'Easy', author: 29.849,
    start: { i: 20, j: 4, k: 1, h: 0 },
    pieces: 'START S R1 L1 S CP U1 R2 S D1 L1 R1 S T S L2 CP S R1 S L1 L1 S FIN',
  },
  {
    id: '03', name: 'Kick Off', tier: 'Medium', author: 19.361,
    start: { i: 34, j: 4, k: 2, h: 0 },
    pieces: 'START S S K G G S S CP S R2 S K2 G G G DN S S S S S CP S L3 S K G RING S S FIN',
  },
  {
    id: '04', name: 'Red Dust', tier: 'Medium', author: 39.482,
    start: { i: 30, j: 6, k: 0, h: 0 },
    pieces: 'START S:dirt S:dirt R2:dirt S:dirt L1:dirt R1:dirt S:dirt CP:dirt S:dirt L2:dirt U1:dirt R1:dirt S:dirt S:dirt D1:dirt L3:dirt S:dirt CP S R2:dirt S:dirt FIN',
  },
  {
    id: '05', name: 'Glass Floor', tier: 'Medium', author: 56.001,
    start: { i: 6, j: 30, k: 0, h: 2 },
    pieces: 'START S T S:ice S:ice R2:ice S:ice S CP S L2 S:ice S:ice R3:ice S T S CP L1 S:ice S:ice S FIN',
  },
  {
    id: '06', name: 'Loop Theory', tier: 'Hard', author: 19.057,
    start: { i: 30, j: 6, k: 1, h: 0 },
    pieces: 'START S T S LOOPR S CP BR2 S S T S BL2 S CP S WR S S T LOOPL S FIN',
  },
  {
    id: '07', name: 'Highline', tier: 'Hard', author: 25.799,
    start: { i: 36, j: 36, k: 6, h: 2 },
    pieces: 'START S T2 NE D2 D2 RS CP S L2 S K2 G G G DN S S S S S CP S S WR S U1 S T S BR3 S FIN',
  },
  {
    id: '08', name: 'Carousel', tier: 'Hard', laps: 3, author: 51.282,
    start: { i: 20, j: 20, k: 1, h: 0 },
    pieces: 'START S S S R2 S S CP S R2 S S S S S R2 S S CP S R2 S',
  },
  {
    id: '09', name: 'Afterburner', tier: 'Medium', author: 26.951,
    start: { i: 32, j: 4, k: 0, h: 0 },
    pieces: 'START S T S K G S S S R2 S T2 S S R3 CP S L2 S K G S S S L2 T S S R1 CP S S T S FIN',
  },
  {
    id: '10', name: 'Double Loop', tier: 'Hard', author: 23.452,
    start: { i: 30, j: 4, k: 1, h: 0 },
    pieces: 'START S T S LOOPR S CP S R2 S WL S S T S LOOPL S CP BR3 S T S K G S S S S L2 S FIN',
  },
  {
    id: '11', name: 'Sky Garden', tier: 'Hard', author: 30.25,
    start: { i: 8, j: 36, k: 5, h: 2 },
    pieces: 'START S T2 D2 S R2 S K G RING S S S CP L2 D1 S WR S S T S L1 S K2 G G DN S S S CP R2 S FIN',
  },
  {
    id: '12', name: 'Turbo Ring', tier: 'Hard', laps: 2, author: 47.56,
    start: { i: 24, j: 8, k: 1, h: 0 },
    pieces: 'START S T S K G S S S BR2 S CP S S T S BR2 S S LOOPR S S S S S S S BR2 S CP S S S BR2 S',
  },
];
