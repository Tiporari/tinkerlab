import { Box } from "planck";
import { Actor } from "../core/Actor";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleBox } from "../core/scaling";

interface HazardProps extends Record<string, number | string | boolean> {
  width: number;
  height: number;
  respawns: string;
  removes: string;
  removeAnything: boolean;
}

/**
 * A danger zone. Things tagged `respawns` (normally "player") go back to
 * where they started; things tagged `removes` (normally "marble") are destroyed.
 */
export class Hazard extends Actor<HazardProps> {
  private flash = 0;

  build(): void {
    this.body = this.own(
      this.game.world.createBody({ type: "static", position: { x: this.x, y: this.y }, angle: this.angle }),
    );
    this.body.createFixture(new Box(this.props.width / 2, this.props.height / 2), { isSensor: true });
  }

  onContact(other: Actor | null): void {
    if (!other || other === this) return;
    const p = this.props;
    // A wheel or thruster on a player's cart counts as the cart.
    const owner = this.ownerOf(other);
    if (p.respawns && owner.tags.has(p.respawns)) {
      this.flash = 0.5;
      this.game.respawn(owner);
      this.game.events.emit("hazard", { hazard: this, actor: owner, result: "respawned" });
    } else if (
      (p.removes && other.tags.has(p.removes)) ||
      (p.removeAnything && other.body?.getType() === "dynamic" && other.dependsOn().length === 0)
    ) {
      this.flash = 0.5;
      this.game.remove(other);
      this.game.events.emit("hazard", { hazard: this, actor: other, result: "removed" });
    }
  }

  /** Follow attachments up to the thing a part belongs to. */
  private ownerOf(actor: Actor): Actor {
    let current = actor;
    for (let i = 0; i < 10; i++) {
      if (current.tags.has(this.props.respawns)) return current;
      const parent = current.dependsOn().map((id) => this.game.find(id)).find(Boolean);
      if (!parent) return actor;
      current = parent;
    }
    return actor;
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const { width: w, height: h } = this.props;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.fillStyle = this.flash > 0 ? "rgba(239,68,68,0.45)" : "rgba(239,68,68,0.18)";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // Warning stripes.
    ctx.strokeStyle = "rgba(185,28,28,0.45)";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (let s = -w - h; s < w + h; s += 0.5) {
      ctx.moveTo(s - h / 2, -h / 2);
      ctx.lineTo(s + h / 2, h / 2);
    }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2 * r.px;
    ctx.strokeStyle = "#b91c1c";
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.rotate(-this.angle);
    ctx.translate(-this.x, -this.y);
    r.drawLabel("DANGER", this.x, this.y + h / 2 + 12 * r.px, "#b91c1c", 11);
  }
}

const hazard: ActorDef = {
  type: "hazard",
  label: "Hazard",
  category: "Course",
  icon: "☠",
  description: "A danger zone. Sends players back to the start and destroys marbles.",
  scale: scaleBox(),
  props: [
    { key: "width", label: "Width", kind: "number", default: 3, min: 0.2, max: 100, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 0.6, min: 0.2, max: 100, step: 0.1 },
    { key: "respawns", label: "Sends back tag", kind: "string", default: "player", help: "Things with this tag go back to where they started." },
    { key: "removes", label: "Destroys tag", kind: "string", default: "marble", help: "Things with this tag are destroyed." },
    { key: "removeAnything", label: "Destroy anything that moves", kind: "boolean", default: false },
  ],
  create: (game, data) => new Hazard(game, data),
};

export default hazard;
