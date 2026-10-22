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

## Building and playing

The game has two modes. In **build** mode you edit the level; press **Play**
(or Space) to run it, and **Stop** (or R) to go back to exactly what you built.

| To do this | Do this |
| --- | --- |
| Add a ball, finish or start | pick it on the left, then click |
| Add a ramp or wall | pick **Block**, then drag from one end to the other |
| Draw a curve or funnel | pick **Path**, then draw |
| Add a triangle, hexagon or other shape | pick **Polygon** (or its ▲ / ⬢ preset), then click; change **Sides** for 3 to 12 |
| Make a hollow outline | tick **Hollow** on a block, ball or shape; **Wall** sets how thick |
| Select, move | **Select** tool, click or drag a thing |
| Select several | drag a box around them, or **Shift**+click to add or remove one; **Ctrl+A** selects everything |
| Move or turn several | drag any of them, or use the round handle, arrow keys or **Q** / **E** |
| Resize | drag the square handles: an edge stretches one way, a corner both (hold Shift to keep the shape) |
| Move or re-attach a part | drag a wheel or thruster, or a spring, rope or piston's orange end, onto something else |
| Rotate | drag the round handle above it, or **Q** / **E** (hold Shift for 1°) |
| Nudge | arrow keys |
| Change its settings | use the panel on the right |
| Duplicate / delete | **Ctrl+D** / **Delete** |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** |
| Snap to grid on or off | **G**, or the Snap box |
| Pan | right/middle-drag, or hold **Space** and drag; one finger on touch |
| Zoom | scroll wheel or pinch |

### Machine parts

| Part | How to place it | What it does |
| --- | --- | --- |
| **Wheel** | click on something | a wheel on an axle; drive it with ← / → by default |
| **Hinge** | click where two things overlap (or on one thing, to pin it to the world) | lets them turn around that point; give it a control to make it a motor |
| **Spring** | drag from one thing to another, or to empty space | pushes back when squashed or stretched |
| **Rope** | drag between two things | a hanging, swinging rope as long as you drew it |
| **Piston** | drag between two things | grows and shrinks while its keys are held (↓ / ↑ by default), holds when let go |
| **Muscle** | drag between two things | pulls its ends together while its key is held (J by default) |
| **Thruster** | click on something, then turn it with Q / E | pushes the way it points while its key is held (↑ by default) |
| **Angle gyro** | click on something | keeps it at the angle it was placed at; give it a **Steer** control to tilt it with keys |
| **Position gyro** | click on something | holds that spot still, even against gravity; untick **Hold sideways** to make it hover |

Gyros are PID controllers, the same idea that keeps drones level. **Strength (P)**
pulls back toward the target, **Calming (D)** stops it wobbling past, and
**Catch-up (I)** slowly pushes harder when something keeps leaning on it. Try
turning Calming down to zero to see why it's there.

### Hazards

A **Hazard** (under Course) is a danger zone. Things tagged `player` go back to
where they started, with their wheels and parts, and marbles are destroyed. Its
settings change which tags it sends back or destroys, or let it destroy
anything that moves.

Every active part has a **Control** setting: a key, a pair of keys, "always on",
or an on-screen slider. While playing, a panel in the corner lists which keys do
what and shows any sliders. Parts follow whatever they're attached to: drag a
cart's body and its wheels come with it, delete it and they go too.

Tag something `player` (in its settings panel) and the camera follows it
while playing. A finish counts things with the tag in its **Counts tag**
setting: `marble` by default, or `player` for a vehicle.

Your work is autosaved in the browser. **Save file** downloads the level as
JSON and **Open file** loads one, so you can keep and share levels.

## How it fits together

```
src/
  core/        the engine: knows nothing about specific objects
    Game.ts      physics world, actors, play/pause/reset, events
    Actor.ts     base class every object extends
    registry.ts  the list of actor types the game knows about
    Renderer.ts  draws to a canvas in world units (meters, y up)
    Camera.ts    pan, zoom and rotation
    Connector.ts base class for parts attached to other actors
    input.ts     keys and sliders, and the control strings parts use
  editor/      build mode: tools, palette, settings panel, undo
  actors/      one file per kind of object: shapes, course pieces and machine parts
  ui/          the play-mode controls panel
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

It shows up in the editor's palette straight away. The `props` list does
double duty: it supplies defaults for anything a level leaves out, and the
editor builds the settings panel from it (sliders for numbers with a `min`
and `max`, checkboxes for booleans, color pickers for colors).

Optional `ActorDef` fields for the editor:

| Field | What it does |
| --- | --- |
| `icon` | a symbol or emoji for the palette button |
| `placement` | `"click"` (default) drops it where you click; `"drag-line"` lets you drag it out, setting `width` and `angle`; `"draw-path"` lets you draw it, setting `points` |
| `palette: false` | hides it from the palette |
| `scale` | lets the select tool's handles resize it; `scaleBox()`, `scaleUniform("radius")` and `scalePoints()` in `core/scaling.ts` cover most shapes |
| `variants` | extra palette buttons that place it with preset settings, like the Triangle and Hexagon shapes |

Actors can also override these hooks:

| Hook | When it runs |
| --- | --- |
| `onPlay()` | once, when play starts |
| `update(dt)` | every physics step (60 per second) |
| `onContact(other, contact)` | when this actor starts touching another |
| `draw(renderer)` | every frame; the default draws the body's shapes |
| `hitTest(x, y, tolerance)` | the editor asks if a click landed on it; the default checks the body's shapes |
| `getBounds()` | the box the editor draws when it's selected |
| `destroy()` | when removed; extend it if you made extra bodies or joints |

Actors talk to each other through `game.events`, for example
`game.events.on("finish", ...)`.

### Parts that attach to other things

Extend `Connector` instead of `Actor` (see `src/actors/spring.ts` for a short
one). Spread `connectorFields()` into `props`: they store which actors it joins
(`a` and `b`, or `""` for the world) and the anchor points in each one's own
frame. Use `this.bodyA`, `this.bodyB`, `this.worldA()` and `this.worldB()` in
`build()`, and create joints with `this.addJoint(...)` so they're cleaned up.
Set `layer: 2` (or `1` if other parts can attach to it, like a wheel) so it's
built after the things it joins, and pick a `placement` of `"connect"`,
`"pin"` or `"attach"`.

For something the player drives, add `controlField("keys:ArrowLeft,ArrowRight")`
to `props` and read it in `update()` with `this.game.input.axis(this.props.control)`,
which gives a number from -1 to 1. Control strings are described in
`src/core/input.ts`.

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
2. **Basic editor**: draw and drag objects, edit their settings, build and play modes (done)
3. **Machine parts and controls**: springs, ropes, motor wheels, pistons, muscles, thrusters, keyboard and slider controls (done)
4. **More shapes, hazards and gyros**: polygons and hollow outlines, palette presets, hazard zones, PID gyros (done)
5. **A better select tool**: box select, multi-select, scale handles, dragging part ends (done)
6. **Groups and assemblies**: weld shapes into one, or group a machine; save them to an inventory
7. **Images, scripting and bigger worlds**: image import with masking, gravity direction, script nodes

## License

MIT. See [LICENSE](LICENSE).
