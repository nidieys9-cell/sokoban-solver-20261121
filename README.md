# Sokoban Solver

Push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver,
21 November 2026" bounty.

## How it works

A level is a one-wide hallway plus one to four rooms, each with a single
door, and a box never leaves its room — so the level's push-optimal count
is the sum of its rooms' optima. The solver:

1. splits the level into rooms by removing the hallway row;
2. solves each room on its own with a push-based A* (one move = one push,
   walks between pushes filled in by BFS), using a minimum-assignment
   heuristic over single-box push distances, plus dead-square, 2x2-block
   and frozen-box deadlock pruning;
3. stitches the room solutions together with hallway walks, solving each
   room so the player can still reach its door at the end.

The search is bounded by a counted node-expansion budget, never by the
clock, so two runs produce identical output bytes.

## Run

```
node main.ts            # reads /input/<id>/level.txt, writes /output/<id>/solution.txt
```

Local practice run: `MAKEFUN_INPUT_DIR=practice/input
MAKEFUN_OUTPUT_DIR=out node main.ts`. Practice set: all 5 instances solved
at exactly the known push-optimal counts (13/16/29/47/60 pushes).

## License

MIT — see LICENSE.
