# TinkerLab

A 2D physics sandbox that runs in the browser. Build marble runs, machines and
contraptions, then press play and watch them go.

It's built to be tinkered with: every kind of object in the game is a small,
self-contained file, and levels are plain JSON you can read and edit by hand.

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev      # open the URL it prints
```

Other commands:

```sh
npm test         # run the tests (includes playing the marble run headless)
npm run build    # build a static site into dist/ you can host anywhere
```

Controls: drag to pan, scroll or pinch to zoom, **Space** plays and pauses,
**R** resets. **Save level** downloads the current level as JSON and **Open
level** loads one.

## How it fits together

```
src/
  core/        the engine: knows nothing about specific objects
    Game.ts      physics world, actors, play/pause/reset, events
    Actor.ts     base class every object extends
    registry.ts  the list of actor types the game knows about
    Renderer.ts  draws to a canvas in world units (meters, y up)
    Camera.ts    pan, zoom and rotation
  actors/      one file per kind of object (ball, block, path, start, finish)
  levels/      built-in levels as JSON
tests/         headless tests that run levels without a browser
```

Physics is [Planck.js](https://piqnt.com/planck.js/), a JavaScript port of
Box2D. Units are meters, kilograms and seconds, and gravity points down
(negative y).

## Adding a new kind of object

Create a file in `src/actors/`. Anything there that default-exports an
`ActorDef` is picked up automatically, with no list to update. A minimal
example, a bouncy square:

```ts
import { Box } from "planck";
import { Actor } from "../core/Actor";
import { colorField } from "../core/fields";
import type { ActorDef } from "../core/registry";

class Bouncer extends Actor<{ size: number; color: string }> {
  build(): void {
    this.body = this.own(
      this.game.world.createBody({ type: "dynamic", position: { x: this.x, y: this.y } }),
    );
    this.body.createFixture(new Box(this.props.size / 2, this.props.size / 2), {
      density: 1,
      restitution: 0.9,
    });
  }
}

const bouncer: ActorDef = {
  type: "bouncer",
  label: "Bouncer",
  category: "Shapes",
  props: [
    { key: "size", label: "Size", kind: "number", default: 1, min: 0.1, max: 10 },
    colorField("#ec4899"),
  ],
  create: (game, data) => new Bouncer(game, data),
};

export default bouncer;
```

Then use it in a level with `{ "type": "bouncer", "x": 0, "y": 5 }`.

The `props` list does double duty: it supplies defaults for anything a level
leaves out, and the editor (coming next) will build its settings panel from it.

Actors can also override these hooks:

| Hook | When it runs |
| --- | --- |
| `onPlay()` | once, when play starts |
| `update(dt)` | every physics step (60 per second) |
| `onContact(other, contact)` | when this actor starts touching another |
| `draw(renderer)` | every frame; the default draws the body's shapes |
| `destroy()` | when removed; extend it if you made extra bodies or joints |

Actors talk to each other through `game.events`, for example
`game.events.on("finish", ...)`.

## Level files

```json
{
  "format": "tinkerlab/level",
  "version": 1,
  "name": "My level",
  "gravity": [0, -10],
  "camera": { "x": 0, "y": 4, "zoom": 40 },
  "actors": [
    { "type": "start", "x": -5, "y": 8, "props": { "count": 3 } },
    { "type": "block", "x": 0, "y": 5, "angle": -0.2, "props": { "width": 10 } },
    { "type": "finish", "x": 6, "y": 0 }
  ]
}
```

`angle` is in radians, counter-clockwise. Any prop you leave out uses the
actor type's default.

## Roadmap

1. **Core framework and a marble run** (done)
2. **Basic editor**: draw and drag objects, edit their settings, build and play modes
3. **Machine parts and controls**: springs, ropes, motor wheels, pistons, muscles, thrusters, keyboard and slider controls
4. **Images, scripting and bigger worlds**: image import with masking, large scrolling levels, script nodes

## License

MIT. See [LICENSE](LICENSE).
