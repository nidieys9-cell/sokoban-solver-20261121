// Sokoban solver: room-decomposed push-optimal A*.
//
// Design (written from scratch for this competition):
// - A level is a 1-wide hallway plus 1-4 rooms, each with a single door.
//   A box never leaves its room, so the level's push-optimal count is the
//   sum of the rooms' optima. Each room is solved on its own with a
//   push-based A* (a move = one push; walks between pushes are filled in
//   by BFS), then the room solutions are stitched together with hallway
//   walks. Rooms are solved so the player can still reach the door at the
//   end, so the player can walk on to the next room.
// - Heuristic: for each box, the minimum pushes needed to reach a goal
//   ignoring the other boxes (reverse push-distance BFS), combined by a
//   minimum assignment of boxes to goals. Admissible and consistent.
// - Deadlock pruning: dead squares (infinite push distance), 2x2 blocks
//   of walls/boxes, and frozen boxes (a box that can never move again).
// - Deterministic by construction: fixed iteration orders, no clock, no
//   randomness; the search is bounded by a count of node expansions, not
//   by time, so two runs produce identical output bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Directions: 0 = up, 1 = down, 2 = left, 3 = right.
const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];
const DCH = ['u', 'd', 'l', 'r'];

// Deterministic work budget: node expansions across the whole run.
// (Counted, never timed, so the output is identical on every run.)
const EXPANSION_CAP = 2000000;
const budget = { used: 0 };

interface Room {
  floor: Set<number>; // room floor cells (door included, hallway excluded)
  boxes: number[];
  goals: number[];
  door: number; // room cell adjacent to the hallway
  entry: number; // hallway cell adjacent to the door
}

interface RoomSolution {
  moves: string;
  finalPlayer: number;
}

function cellId(r: number, c: number, w: number): number {
  return r * w + c;
}

// Flood fill from `start` over `floor` minus `boxes`. Returns the cells.
function flood(start: number, floor: Set<number>, boxes: Set<number>, w: number): number[] {
  const seen = new Set<number>();
  const stack = [start];
  seen.add(start);
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    const r = Math.floor(cur / w);
    const c = cur % w;
    for (let d = 0; d < 4; d++) {
      const n = cellId(r + DR[d], c + DC[d], w);
      if (!floor.has(n) || boxes.has(n) || seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return [...seen];
}

// BFS walk from `from` to `to` over `floor` minus `boxes`.
// Fixed neighbour order, so the returned path is deterministic.
function bfsWalk(floor: Set<number>, boxes: Set<number>, from: number, to: number, w: number): string | null {
  if (from === to) return '';
  const prev = new Map<number, number>();
  const prevDir = new Map<number, number>();
  const queue = [from];
  prev.set(from, -1);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const r = Math.floor(cur / w);
    const c = cur % w;
    for (let d = 0; d < 4; d++) {
      const n = cellId(r + DR[d], c + DC[d], w);
      if (!floor.has(n) || boxes.has(n) || prev.has(n)) continue;
      prev.set(n, cur);
      prevDir.set(n, d);
      if (n === to) {
        let s = '';
        let x = n;
        while (x !== from) {
          s = DCH[prevDir.get(x) as number] + s;
          x = prev.get(x) as number;
        }
        return s;
      }
      queue.push(n);
    }
  }
  return null;
}

// Reverse push-distance BFS from one goal: dist[cell] = minimum pushes to
// move a lone box from `cell` to the goal, with the player allowed to
// stand anywhere on `standFloor` (a relaxation, hence a lower bound).
// A box at `c` came from `prev = c - dir`, pushed by a player standing at
// `prev - dir`; both cells must be floor.
function pushDistances(
  goal: number,
  boxFloor: Set<number>,
  standFloor: Set<number>,
  w: number,
): Map<number, number> {
  const dist = new Map<number, number>();
  dist.set(goal, 0);
  const queue = [goal];
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++];
    const d0 = dist.get(c) as number;
    const r = Math.floor(c / w);
    const cc = c % w;
    for (let dir = 0; dir < 4; dir++) {
      const pr = r - DR[dir];
      const pc = cc - DC[dir];
      const prev = cellId(pr, pc, w);
      if (!boxFloor.has(prev) || dist.has(prev)) continue;
      const sr = pr - DR[dir];
      const sc = pc - DC[dir];
      const stand = cellId(sr, sc, w);
      if (!standFloor.has(stand)) continue;
      dist.set(prev, d0 + 1);
      queue.push(prev);
    }
  }
  return dist;
}

// Minimum assignment of boxes to goals using the push distances.
// Returns Infinity when no assignment exists.
function heuristic(
  boxes: number[],
  goals: number[],
  distByGoal: Map<number, number>[],
): number {
  const n = boxes.length;
  const used = new Array<boolean>(n).fill(false);
  let best = Infinity;
  const rec = (i: number, sum: number): void => {
    if (sum >= best) return;
    if (i === n) {
      best = sum;
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = distByGoal[j].get(boxes[i]);
      if (d === undefined) continue;
      used[j] = true;
      rec(i + 1, sum + d);
      used[j] = false;
    }
  };
  rec(0, 0);
  return best;
}

// Deadlock test for a box configuration.
// - a 2x2 block of walls/boxes holding a box off a goal can never move;
// - a frozen box (blocked on both axes by walls or frozen boxes) that is
//   off a goal can never move again.
function isDead(
  boxes: number[],
  boxSet: Set<number>,
  floor: Set<number>,
  goals: Set<number>,
  w: number,
): boolean {
  // 2x2 blocks.
  for (const b of boxes) {
    if (goals.has(b)) continue;
    const r = Math.floor(b / w);
    const c = b % w;
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const cells = [
          cellId(r - dr, c - dc, w),
          cellId(r - dr, c + 1 - dc, w),
          cellId(r + 1 - dr, c - dc, w),
          cellId(r + 1 - dr, c + 1 - dc, w),
        ];
        let allBlocked = true;
        let hasBox = false;
        for (const x of cells) {
          if (boxSet.has(x)) {
            hasBox = true;
          } else if (floor.has(x)) {
            allBlocked = false;
            break;
          }
        }
        if (allBlocked && hasBox) return true;
      }
    }
  }
  // Frozen boxes, fixpoint.
  const frozen = new Set<number>();
  const blocked = (x: number): boolean => !floor.has(x) || frozen.has(x);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of boxes) {
      if (goals.has(b) || frozen.has(b)) continue;
      const r = Math.floor(b / w);
      const c = b % w;
      const vert = blocked(cellId(r - 1, c, w)) || blocked(cellId(r + 1, c, w));
      const horiz = blocked(cellId(r, c - 1, w)) || blocked(cellId(r, c + 1, w));
      if (vert && horiz) {
        frozen.add(b);
        changed = true;
      }
    }
  }
  return frozen.size > 0;
}

interface Node {
  boxes: number[];
  player: number;
  parent: number;
  from: number; // box cell before the push that created this node
  dir: number; // push direction
  g: number; // pushes so far
}

// Binary heap ordered by (f, h, insertion order).
class Heap {
  items: [number, number, number, number][] = []; // [f, h, seq, nodeIdx]
  push(e: [number, number, number, number]): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(a[p], a[i]) <= 0) break;
      const t = a[p];
      a[p] = a[i];
      a[i] = t;
      i = p;
    }
  }
  pop(): [number, number, number, number] | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as [number, number, number, number];
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        const t = a[m];
        a[m] = a[i];
        a[i] = t;
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.items.length;
  }
}

function cmp(a: [number, number, number, number], b: [number, number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

// Push-optimal A* for one room. The player starts on `entry` (a hallway
// cell next to the door). Boxes may only move within the room floor.
// When `requireExit` is set, the goal test also requires the player to
// be able to reach the door in the final configuration.
function solveRoom(room: Room, requireExit: boolean, w: number): RoomSolution | null {
  const floorAll = new Set<number>(room.floor);
  floorAll.add(room.entry);
  const goals = [...room.goals].sort((a, b) => a - b);
  const goalSet = new Set<number>(goals);
  const distByGoal = goals.map((g) => pushDistances(g, room.floor, floorAll, w));

  const startBoxes = [...room.boxes].sort((a, b) => a - b);
  const h0 = heuristic(startBoxes, goals, distByGoal);
  if (!isFinite(h0)) return null;

  const nodes: Node[] = [{ boxes: startBoxes, player: room.entry, parent: -1, from: -1, dir: -1, g: 0 }];
  const heap = new Heap();
  let seq = 0;
  heap.push([h0, h0, seq++, 0]);
  const closed = new Map<string, number>();
  const regionOf = (player: number, boxSet: Set<number>): number[] =>
    flood(player, floorAll, boxSet, w);
  const startRegion = regionOf(room.entry, new Set<number>(startBoxes));
  const startRep = Math.min(...startRegion);
  closed.set(startBoxes.join(',') + '|' + startRep, 0);

  while (heap.size > 0) {
    const [, , , idx] = heap.pop() as [number, number, number, number];
    const node = nodes[idx];
    const key = node.boxes.join(',') + '|' + Math.min(...regionOf(node.player, new Set<number>(node.boxes)));
    if ((closed.get(key) as number) < node.g) continue;

    // Goal test: every box on a goal (and the door reachable when asked).
    if (node.boxes.every((b) => goalSet.has(b))) {
      if (!requireExit) {
        return finishRoom(nodes, idx, floorAll, w);
      }
      const region = regionOf(node.player, new Set<number>(node.boxes));
      if (region.includes(room.door)) {
        return finishRoom(nodes, idx, floorAll, w);
      }
      // Otherwise keep searching for an exitable optimum.
    }

    if (budget.used >= EXPANSION_CAP) return null;
    budget.used++;
    const boxSet = new Set<number>(node.boxes);
    const region = regionOf(node.player, boxSet);
    const regionSet = new Set<number>(region);

    for (let bi = 0; bi < node.boxes.length; bi++) {
      const b = node.boxes[bi];
      const r = Math.floor(b / w);
      const c = b % w;
      for (let dir = 0; dir < 4; dir++) {
        const dest = cellId(r + DR[dir], c + DC[dir], w);
        if (!room.floor.has(dest) || boxSet.has(dest)) continue;
        const stand = cellId(r - DR[dir], c - DC[dir], w);
        if (!regionSet.has(stand)) continue;
        const nb = [...node.boxes];
        nb[bi] = dest;
        nb.sort((a, b2) => a - b2);
        const h = heuristic(nb, goals, distByGoal);
        if (!isFinite(h)) continue;
        const nbSet = new Set<number>(nb);
        if (isDead(nb, nbSet, floorAll, goalSet, w)) continue;
        const rep = Math.min(...regionOf(b, nbSet));
        const nkey = nb.join(',') + '|' + rep;
        const ng = node.g + 1;
        const prev = closed.get(nkey);
        if (prev !== undefined && prev <= ng) continue;
        closed.set(nkey, ng);
        const nidx = nodes.length;
        // After the push the player stands on the box's old cell.
        nodes.push({ boxes: nb, player: b, parent: idx, from: b, dir, g: ng });
        heap.push([ng + h, h, seq++, nidx]);
      }
    }
  }
  return null;
}

// Rebuild the full move string for a goal node: walks plus pushes.
function finishRoom(nodes: Node[], goalIdx: number, floorAll: Set<number>, w: number): RoomSolution {
  const steps: string[] = [];
  let idx = goalIdx;
  while (nodes[idx].parent >= 0) {
    const node = nodes[idx];
    const parent = nodes[node.parent];
    const stand = cellId(
      Math.floor(node.from / w) - DR[node.dir],
      (node.from % w) - DC[node.dir],
      w,
    );
    const walk = bfsWalk(floorAll, new Set<number>(parent.boxes), parent.player, stand, w);
    if (walk === null) return { moves: '', finalPlayer: -1 };
    steps.push(walk + DCH[node.dir]);
    idx = node.parent;
  }
  steps.reverse();
  return { moves: steps.join(''), finalPlayer: nodes[goalIdx].player };
}

// Split a level into rooms by removing the hallway row (the player's row).
// Returns null when the level does not fit that shape.
function decompose(
  floorAll: Set<number>,
  boxes: number[],
  goals: number[],
  player: number,
  w: number,
  h: number,
): Room[] | null {
  const hallRow = Math.floor(player / w);
  const rest = new Set<number>();
  for (const cell of floorAll) {
    if (Math.floor(cell / w) !== hallRow) rest.add(cell);
  }
  const boxSet = new Set<number>(boxes);
  const goalSet = new Set<number>(goals);
  const seen = new Set<number>();
  const rooms: Room[] = [];
  const coveredBoxes = new Set<number>();
  const coveredGoals = new Set<number>();
  for (const start of rest) {
    if (seen.has(start)) continue;
    const comp = flood(start, rest, new Set<number>(), w);
    for (const x of comp) seen.add(x);
    const compSet = new Set<number>(comp);
    const rBoxes = boxes.filter((b) => compSet.has(b));
    if (rBoxes.length === 0) continue;
    const rGoals = goals.filter((g) => compSet.has(g));
    if (rGoals.length !== rBoxes.length) return null;
    // The door: the room cell touching a hallway floor cell.
    let door = -1;
    let entry = -1;
    for (const x of comp) {
      const r = Math.floor(x / w);
      const c = x % w;
      for (let d = 0; d < 4; d++) {
        const n = cellId(r + DR[d], c + DC[d], w);
        if (Math.floor(n / w) === hallRow && floorAll.has(n)) {
          if (door === -1 || x < door) {
            door = x;
            entry = n;
          }
        }
      }
    }
    if (door === -1) return null;
    for (const b of rBoxes) coveredBoxes.add(b);
    for (const g of rGoals) coveredGoals.add(g);
    rooms.push({ floor: compSet, boxes: rBoxes, goals: rGoals, door, entry });
  }
  if (coveredBoxes.size !== boxSet.size || coveredGoals.size !== goalSet.size) return null;
  if (rooms.length === 0) return null;
  return rooms;
}

function solveLevel(text: string): string {
  const rawLines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const h = rawLines.length;
  if (h === 0) return '';
  const w = Math.max(...rawLines.map((l) => l.length));
  const floorAll = new Set<number>();
  const boxes: number[] = [];
  const goals: number[] = [];
  let player = -1;
  for (let r = 0; r < h; r++) {
    const line = rawLines[r];
    for (let c = 0; c < w; c++) {
      const ch = c < line.length ? line[c] : '#';
      if (ch === '#') continue;
      const id = cellId(r, c, w);
      floorAll.add(id);
      if (ch === '$' || ch === '*') boxes.push(id);
      if (ch === '.' || ch === '*' || ch === '+') goals.push(id);
      if (ch === '@' || ch === '+') player = id;
    }
  }
  if (player === -1 || boxes.length === 0) return '';
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);

  let rooms = decompose(floorAll, boxes, goals, player, w, h);
  let single = false;
  if (rooms === null) {
    // Fallback: treat the whole level as one room, entered at the player.
    rooms = [{ floor: floorAll, boxes, goals, door: -1, entry: player }];
    single = true;
  }

  // Solve every room; a room whose optimal solution cannot exit is solved
  // without the exit requirement and played last.
  const solved: { room: Room; sol: RoomSolution; last: boolean }[] = [];
  for (const room of rooms) {
    let sol: RoomSolution | null = null;
    let last = false;
    if (!single && room.door !== -1) {
      sol = solveRoom(room, true, w);
      if (sol === null) {
        sol = solveRoom(room, false, w);
        last = true;
      }
    } else {
      sol = solveRoom(room, false, w);
    }
    if (sol === null || sol.finalPlayer === -1) return '';
    solved.push({ room, sol, last });
  }
  solved.sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0));

  // Stitch the room solutions together with hallway walks.
  let moves = '';
  let playerNow = player;
  const boxesNow = new Set<number>(boxes);
  for (const { room, sol } of solved) {
    const walk = bfsWalk(floorAll, boxesNow, playerNow, room.entry, w);
    if (walk === null) return '';
    moves += walk;
    moves += sol.moves;
    playerNow = sol.finalPlayer;
    for (const b of room.boxes) boxesNow.delete(b);
    for (const g of room.goals) boxesNow.add(g);
  }
  return moves;
}

for (const id of readdirSync(I, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
