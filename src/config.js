// Global tuning constants. Everything is in metres / seconds.
// Kept in one place so new monsters, cities and enemies can share the same scale.

export const WORLD = {
  gravity: -30, // slightly heavier than real gravity: big things should fall with weight but not slowly
  blocksX: 4,
  blocksZ: 4,
  blockSize: 64,
  roadWidth: 22, // includes both sidewalks
  sidewalk: 4,
  laneWidth: 3.5,
};

export const CELL = {
  size: 4, // horizontal size of one destructible building cell
  height: 4, // one storey
};

export const GORILLA = {
  modelScale: 9.2, // model is authored in "real gorilla" metres (~1.75 tall)
  radius: 3.4,
  height: 15,
  walkSpeed: 10,
  runSpeed: 21,
  accel: 38,
  turnRate: 7.5,
  jumpVelocity: 19,
  maxHealth: 100,
  climbSpeed: 7,
  reach: 9.5,
};

export const DESTRUCTION = {
  winPercent: 60,
  maxPhysicsDebris: 260,
  maxRubble: 9000,
  maxGlass: 2600,
  maxChips: 1800,
};

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const low = q.get('low') === '1';
export const QUALITY = {
  low,
  shadowMapSize: low ? 1024 : 4096,
  bloom: !low,
  msaa: low ? 0 : 4,
  pixelRatioCap: low ? 1 : 1.5,
};
