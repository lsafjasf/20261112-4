import { SeededRandom } from "./rng.js";

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Renderer {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.seed = seed;
    this.width = 900;
    this.height = 720;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.shake = 0;
    this.last = null;
    this.ambient = this.makeAmbient(seed);
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas.parentElement);
    this.resize();
  }

  makeAmbient(seed) {
    const random = new SeededRandom(`${seed}-renderer`);
    return Array.from({ length: 90 }, () => ({
      x: random.range(0, 1600),
      y: random.range(0, 1000),
      size: random.range(0.5, 2.2),
      drift: random.range(2, 10),
      phase: random.range(0, TAU),
      alpha: random.range(0.08, 0.35),
    }));
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  setWorldTransform(game) {
    const ctx = this.ctx;
    const scale = Math.min(this.width / game.world.width, this.height / game.world.height);
    this.scale = scale;
    this.offsetX = (this.width - game.world.width * scale) / 2;
    this.offsetY = (this.height - game.world.height * scale) / 2;
    const shakeX = this.shake > 0 ? Math.sin(this.last * 91) * this.shake * 5 : 0;
    const shakeY = this.shake > 0 ? Math.cos(this.last * 73) * this.shake * 3 : 0;
    ctx.setTransform(
      this.dpr * scale,
      0,
      0,
      this.dpr * scale,
      this.dpr * (this.offsetX + shakeX),
      this.dpr * (this.offsetY + shakeY),
    );
  }

  triggerShake(amount = 1) {
    this.shake = Math.max(this.shake, amount);
  }

  draw(game, timeSeconds = performance.now() / 1000) {
    const ctx = this.ctx;
    this.last = timeSeconds;
    this.shake *= 0.9;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#02080c";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.setWorldTransform(game);
    this.drawBackdrop(game, timeSeconds);
    this.drawRiskRoute(game);
    this.drawSafeRoute(game, timeSeconds);
    this.drawHull(game, timeSeconds);
    this.drawObstacles(game, timeSeconds);
    this.drawSilt(game, timeSeconds);
    this.drawHome(game, timeSeconds);
    this.drawArtifacts(game, timeSeconds);
    this.drawPings(game, timeSeconds);
    this.drawRov(game, timeSeconds);
    this.drawWorldLabels(game, timeSeconds);
    this.drawVignette();
  }

  drawBackdrop(game, time) {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(860, 510, 30, 860, 510, 760);
    gradient.addColorStop(0, "rgba(20, 70, 77, 0.2)");
    gradient.addColorStop(0.42, "rgba(7, 31, 39, 0.11)");
    gradient.addColorStop(1, "rgba(0, 3, 6, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, game.world.width, game.world.height);

    ctx.save();
    ctx.strokeStyle = "rgba(90, 153, 163, 0.055)";
    ctx.lineWidth = 1;
    for (let band = 0; band < 11; band += 1) {
      const baseY = 260 + band * 48;
      ctx.beginPath();
      for (let x = 0; x <= game.world.width; x += 28) {
        const y = baseY
          + Math.sin(x * 0.006 + band * 0.8 + time * 0.07) * (9 + band * 0.7)
          + Math.cos(x * 0.013 - band) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    for (const particle of this.ambient) {
      const x = (particle.x + Math.sin(time * 0.08 + particle.phase) * particle.drift + 1600) % 1600;
      const y = (particle.y - ((time * particle.drift * 0.22) % 1000) + 1000) % 1000;
      const alpha = particle.alpha * (0.55 + Math.sin(time * 0.8 + particle.phase) * 0.28);
      ctx.fillStyle = `rgba(166, 224, 223, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, particle.size, 0, TAU);
      ctx.fill();
    }
  }

  tracePath(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  }

  drawRiskRoute(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([7, 12]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(255, 116, 107, 0.2)";
    this.tracePath(game.world.riskShortcut);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 116, 107, 0.42)";
    ctx.font = "10px 'JetBrains Mono Local', monospace";
    ctx.textAlign = "center";
    ctx.fillText("RISK SHORTCUT", 725, 742);
    ctx.restore();
  }

  drawSafeRoute(game, time) {
    const ctx = this.ctx;
    const surveyed = game.routeNodes.filter((node) => node.surveyed).length;
    if (surveyed === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -time * 16;
    ctx.lineWidth = 1.5;
    const gradient = ctx.createLinearGradient(1200, 700, 130, 850);
    gradient.addColorStop(0, "rgba(114, 231, 225, 0.7)");
    gradient.addColorStop(1, "rgba(114, 231, 225, 0.16)");
    ctx.strokeStyle = gradient;
    this.tracePath(game.world.safeRoute);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const node of game.routeNodes) {
      if (!node.surveyed) continue;
      ctx.fillStyle = "rgba(114, 231, 225, 0.14)";
      ctx.strokeStyle = "rgba(114, 231, 225, 0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 9, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(node.x - 4, node.y);
      ctx.lineTo(node.x + 4, node.y);
      ctx.moveTo(node.x, node.y - 4);
      ctx.lineTo(node.x, node.y + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(170, 224, 226, 0.55)";
      ctx.font = "8px 'JetBrains Mono Local', monospace";
      ctx.textAlign = "left";
      ctx.fillText(node.id, node.x + 13, node.y + 3);
    }
    ctx.restore();
  }

  drawHull(game, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(123, 186, 190, 0.055)";
    ctx.setLineDash([4, 9]);
    ctx.lineWidth = 0.8;
    this.tracePath(game.hull.map((segment) => segment.a));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    for (const segment of game.hull) {
      const remaining = segment.revealUntil - game.time;
      if (!segment.seen && remaining <= 0) continue;
      const flash = remaining > 0 ? clamp(remaining / 6.8, 0, 1) : 0;
      const alpha = segment.seen ? 0.12 + flash * 0.68 : 0.028 + flash * 0.4;
      ctx.save();
      ctx.strokeStyle = `rgba(122, 226, 224, ${alpha})`;
      ctx.shadowColor = "rgba(114, 231, 225, 0.55)";
      ctx.shadowBlur = remaining > 0 ? 9 : 0;
      ctx.lineWidth = 1.3 + flash * 1.2;
      ctx.beginPath();
      ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);
      ctx.stroke();
      if (remaining > 0) {
        ctx.strokeStyle = `rgba(196, 255, 252, ${0.28 * flash})`;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([2, 8]);
        ctx.stroke();
      }
      ctx.restore();
    }

    const first = game.hull[0];
    if (first?.seen) {
      ctx.save();
      ctx.fillStyle = "rgba(145, 212, 213, 0.25)";
      ctx.font = "9px 'JetBrains Mono Local', monospace";
      ctx.fillText("WRECK 19-B / SONAR TRACE", 1128, 310);
      ctx.restore();
    }
  }

  drawObstacles(game, time) {
    const ctx = this.ctx;
    const nearbyBoost = Math.hypot(game.velocity.x, game.velocity.y) > 50 ? 0.08 : 0;
    for (const obstacle of game.world.obstacles) {
      const distanceToRov = Math.hypot(obstacle.x - game.position.x, obstacle.y - game.position.y);
      const proximity = clamp(1 - distanceToRov / 240, 0, 1);
      const alpha = 0.085 + proximity * 0.14 + nearbyBoost;
      ctx.save();
      ctx.translate(obstacle.x, obstacle.y);
      ctx.strokeStyle = `rgba(137, 177, 181, ${alpha + 0.04})`;
      ctx.fillStyle = `rgba(0, 5, 8, ${alpha + 0.2})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (obstacle.kind === "mast") {
        const r = obstacle.radius;
        ctx.moveTo(-r * 0.55, r * 0.8);
        ctx.lineTo(-r * 0.25, -r * 0.9);
        ctx.lineTo(0, -r * 1.2);
        ctx.lineTo(r * 0.18, -r * 0.5);
        ctx.lineTo(r * 0.62, r * 0.65);
        ctx.closePath();
      } else if (obstacle.kind === "vent") {
        for (let point = 0; point < 12; point += 1) {
          const angle = (point / 12) * TAU;
          const radius = obstacle.radius * (0.8 + Math.sin(point * 2.7) * 0.14);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius * 0.72;
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      } else {
        for (let point = 0; point < 9; point += 1) {
          const angle = (point / 9) * TAU + obstacle.radius;
          const radius = obstacle.radius * (0.74 + Math.sin(point * 4.13 + obstacle.x) * 0.2);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius * 0.8;
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      if (obstacle.drill) {
        ctx.strokeStyle = `rgba(255, 116, 107, ${0.1 + Math.sin(time * 2) * 0.03})`;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, obstacle.radius + 14, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawSilt(game, time) {
    const ctx = this.ctx;
    for (const cloud of game.silt) {
      const remaining = 1 - cloud.age / cloud.life;
      for (let layer = 0; layer < 7; layer += 1) {
        const angle = layer * 1.87 + cloud.x * 0.01;
        const radius = cloud.radius * (0.32 + layer * 0.09);
        const drift = cloud.age * (5 + layer);
        const x = cloud.x + Math.cos(angle) * drift;
        const y = cloud.y + Math.sin(angle * 1.3) * drift * 0.48;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(166, 151, 108, ${0.12 * remaining})`);
        gradient.addColorStop(0.5, `rgba(132, 124, 94, ${0.075 * remaining})`);
        gradient.addColorStop(1, "rgba(112, 103, 80, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(194, 174, 119, ${0.08 * remaining})`;
      ctx.setLineDash([2, 9]);
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, cloud.radius * (0.7 + cloud.age * 0.02), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawHome(game, time) {
    const ctx = this.ctx;
    const home = game.world.home;
    const inRange = Math.hypot(game.position.x - home.x, game.position.y - home.y) < home.radius;
    ctx.save();
    ctx.translate(home.x, home.y);
    ctx.strokeStyle = inRange ? "rgba(166, 219, 123, 0.8)" : "rgba(166, 219, 123, 0.3)";
    ctx.fillStyle = "rgba(166, 219, 123, 0.055)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, home.radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([4, 8]);
    ctx.lineDashOffset = time * 10;
    ctx.beginPath();
    ctx.arc(0, 0, home.radius + 9, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(166, 219, 123, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(22, 0);
    ctx.moveTo(0, -22);
    ctx.lineTo(0, 22);
    ctx.stroke();
    ctx.fillStyle = "rgba(190, 233, 156, 0.7)";
    ctx.font = "8px 'JetBrains Mono Local', monospace";
    ctx.textAlign = "center";
    ctx.fillText("MOTHER SHIP", 0, home.radius + 24);
    ctx.restore();
  }

  drawArtifacts(game, time) {
    const ctx = this.ctx;
    for (const artifact of game.artifacts) {
      const silt = game.siltAt(artifact.x, artifact.y);
      const known = artifact.discovered || artifact.sampled;
      const echoActive = artifact.echoUntil > game.time;
      if (!known && !echoActive) continue;
      const pulse = 0.5 + Math.sin(time * 3.1 + artifact.nodeIndex) * 0.5;
      ctx.save();
      ctx.translate(artifact.x, artifact.y);
      if (!known) {
        ctx.strokeStyle = `rgba(241, 185, 102, ${0.35 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + pulse * 5, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(241, 185, 102, 0.45)";
        ctx.font = "8px 'JetBrains Mono Local', monospace";
        ctx.textAlign = "center";
        ctx.fillText("ANOMALY", 0, 29);
        ctx.restore();
        continue;
      }
      const color = artifact.sampled ? "166, 219, 123" : silt > 0.5 ? "241, 185, 102" : "114, 231, 225";
      ctx.strokeStyle = `rgba(${color}, 0.52)`;
      ctx.fillStyle = `rgba(${color}, 0.075)`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 24 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${color}, 0.9)`;
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, TAU);
      ctx.fill();
      ctx.font = "8px 'JetBrains Mono Local', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${artifact.code}${artifact.sampled ? " / STOWED" : silt > 0.5 ? " / OBSCURED" : ""}`, 28, 2);
      if (artifact.sampleProgress > 0 && artifact.sampleProgress < 1) {
        ctx.strokeStyle = "rgba(114, 231, 225, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * artifact.sampleProgress);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawPings(game, time) {
    const ctx = this.ctx;
    for (const pulse of game.pings) {
      const life = clamp(pulse.age / 1.16, 0, 1);
      const alpha = (1 - life) * 0.48;
      ctx.save();
      ctx.translate(pulse.x, pulse.y);
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = Math.max(0, pulse.radius - ring * 39);
        if (radius <= ring * 7) continue;
        ctx.strokeStyle = `rgba(114, 231, 225, ${alpha / (ring + 1)})`;
        ctx.lineWidth = 1.5 - ring * 0.35;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TAU);
        ctx.stroke();
      }
      const sweep = -Math.PI / 2 + life * TAU * 1.2;
      const gradient = ctx.createLinearGradient(0, 0, Math.cos(sweep) * pulse.radius, Math.sin(sweep) * pulse.radius);
      gradient.addColorStop(0, "rgba(114, 231, 225, 0.03)");
      gradient.addColorStop(1, `rgba(114, 231, 225, ${alpha * 0.34})`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, pulse.radius, sweep - 0.28, sweep);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawRov(game, time) {
    const ctx = this.ctx;
    const speed = Math.hypot(game.velocity.x, game.velocity.y);
    const sampling = game.sampling;
    const cog = game.cogPercent / 100;
    const bodyLength = 29;
    ctx.save();
    ctx.translate(game.position.x, game.position.y);
    ctx.rotate(game.heading);

    if (speed > 44) {
      ctx.strokeStyle = "rgba(114, 231, 225, 0.15)";
      ctx.lineWidth = 1;
      for (let trail = 1; trail < 4; trail += 1) {
        ctx.beginPath();
        ctx.arc(-bodyLength - trail * 8, Math.sin(time * 6 + trail) * 2, 4 + trail * 2, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(117, 230, 225, 0.13)";
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(-18, -bodyLength);
    ctx.quadraticCurveTo(-80, -42, -210, -22);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(114, 231, 225, 0.1)";
    ctx.strokeStyle = "rgba(114, 231, 225, 0.78)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-18, -11, 36, 22, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(5, 20, 25, 0.95)";
    ctx.beginPath();
    ctx.roundRect(-11, -7, 18, 14, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(178, 246, 240, 0.5)";
    ctx.stroke();

    ctx.fillStyle = "#f1b966";
    ctx.beginPath();
    ctx.arc(10, 0, 2.2, 0, TAU);
    ctx.fill();
    ctx.shadowColor = "#f1b966";
    ctx.shadowBlur = 10;
    ctx.fillRect(17, -2.5, 4, 5);
    ctx.shadowBlur = 0;

    const thruster = game.controls.thrust;
    ctx.strokeStyle = `rgba(114, 231, 225, ${0.2 + Math.abs(thruster) * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-19, -10);
    ctx.lineTo(-28, -15 - Math.abs(thruster) * (game.controls.boost ? 9 : 4));
    ctx.moveTo(-19, 10);
    ctx.lineTo(-28, 15 + Math.abs(thruster) * (game.controls.boost ? 9 : 4));
    ctx.stroke();

    const armExtension = sampling ? 15 + sampling.elapsed * 3 : 5 + cog * 8;
    ctx.strokeStyle = "rgba(200, 228, 229, 0.58)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(17, 4);
    ctx.lineTo(25, 8);
    ctx.lineTo(25 + armExtension, 4 + Math.sin(time * 6) * 1.5);
    ctx.stroke();
    ctx.fillStyle = sampling ? "#72e7e1" : "#8d9cff";
    ctx.beginPath();
    ctx.arc(25 + armExtension, 4 + Math.sin(time * 6) * 1.5, 2.2, 0, TAU);
    ctx.fill();

    if (game.controls.boost && Math.abs(thruster) > 0.2) {
      ctx.fillStyle = "rgba(241, 185, 102, 0.16)";
      ctx.beginPath();
      ctx.moveTo(-18, -6);
      ctx.lineTo(-38, 0);
      ctx.lineTo(-18, 6);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(game.position.x, game.position.y);
    ctx.strokeStyle = game.activeFault ? "rgba(255, 116, 107, 0.62)" : "rgba(114, 231, 225, 0.3)";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 27 + Math.sin(time * 2.3) * 2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (game.activeFault) {
      ctx.strokeStyle = `rgba(255, 116, 107, ${0.2 + Math.sin(time * 5) * 0.1})`;
      ctx.beginPath();
      ctx.arc(0, 0, 35, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorldLabels(game, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "8px 'JetBrains Mono Local', monospace";
    ctx.fillStyle = "rgba(165, 211, 215, 0.38)";
    ctx.textAlign = "left";
    ctx.fillText("BLACKWATER BASIN / DEPTH 1,840 m", 32, 52);
    ctx.fillStyle = "rgba(241, 185, 102, 0.35)";
    ctx.fillText("SEABED CURRENT 0.6 kn / VISIBILITY 4 m", 32, 67);
    ctx.strokeStyle = "rgba(145, 206, 208, 0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(game.position.x, game.position.y, 42, Math.PI * 0.85 + Math.sin(time * 0.2) * 0.06, Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();
  }

  drawVignette() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const width = this.canvas.width;
    const height = this.canvas.height;
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.18,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.78,
    );
    vignette.addColorStop(0, "rgba(0, 4, 7, 0)");
    vignette.addColorStop(0.72, "rgba(0, 3, 6, 0.18)");
    vignette.addColorStop(1, "rgba(0, 1, 3, 0.66)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}
