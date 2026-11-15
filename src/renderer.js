import { MEDICINES, VEHICLE, BOX_RULES } from "./config.js";

const STOP_POS = {
  depot: { x: 70, y: 150 },
  H1: { x: 300, y: 150 },
  S1: { x: 470, y: 260 },
  H2: { x: 660, y: 150 },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  draw(sim) {
    const ctx = this.ctx;
    const s = sim.s;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawRoad(ctx, s);
    this._drawStops(ctx, s);
    this._drawVehicle(ctx, s);
    this._drawBoxes(ctx, s);
    this._drawHud(ctx, s);
  }

  _drawRoad(ctx, s) {
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#3a4356";
    const order = ["depot", "H1", "S1", "H2"];
    for (let i = 0; i < order.length - 1; i += 1) {
      const a = STOP_POS[order[i]];
      const b = STOP_POS[order[i + 1]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // 已完成的备用路线高亮
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#37d67a";
    for (const rec of s.routes.records.filter((r) => r.complete)) {
      const [from, to] = rec.key.split("->");
      const a = STOP_POS[from];
      const b = STOP_POS[to];
      ctx.beginPath();
      ctx.setLineDash([10, 8]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _drawStops(ctx, s) {
    for (const [name, p] of Object.entries(STOP_POS)) {
      const queued = s.queue.includes(name);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = name === "S1" && s.station.outageActive
        ? "#d9534f"
        : queued ? "#4f8cff" : "#5a6577";
      ctx.fill();
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(name, p.x, p.y + 34);
      if (name === "S1" && s.station.outageActive) {
        ctx.fillStyle = "#ff9f9c";
        ctx.fillText("停电", p.x, p.y + 50);
      }
    }
  }

  _drawVehicle(ctx, s) {
    const v = s.vehicle;
    let pos;
    if (v.segment) {
      const a = STOP_POS[v.segment.from];
      const b = STOP_POS[v.segment.to];
      const t = v.segment.progress / v.segment.total;
      pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    } else {
      pos = STOP_POS[v.location];
    }
    ctx.save();
    ctx.translate(pos.x, pos.y - 26);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-16, -8, 32, 16);
    ctx.fillStyle = "#27303f";
    ctx.fillRect(-10, -14, 16, 8);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(-10, 9, 4, 0, Math.PI * 2);
    ctx.arc(10, 9, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (v.waitingBlock) {
      ctx.fillStyle = "#ff9f9c";
      ctx.fillText("主路封闭，需改备用", pos.x, pos.y - 40);
    }
  }

  _drawBoxes(ctx, s) {
    const startX = 40;
    const baseY = 340;
    s.boxes.forEach((box, i) => {
      const med = MEDICINES.find((m) => m.box === box.id);
      const x = startX + i * 245;
      const inRange = box.temp >= med.min && box.temp <= med.max;
      ctx.fillStyle = "#1d2433";
      ctx.fillRect(x, baseY, 225, 132);
      ctx.strokeStyle = inRange ? "#37d67a" : "#d9534f";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, baseY, 225, 132);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${box.id} · ${med.name}(${med.id})`, x + 12, baseY + 22);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = inRange ? "#8fe6b6" : "#ff9f9c";
      ctx.fillText(
        `温度 ${box.temp.toFixed(1)}℃ [${med.min}, ${med.max}]`,
        x + 12,
        baseY + 42,
      );
      this._bar(ctx, x + 12, baseY + 52, 200, 10, box.soc / 100,
        box.soc < BOX_RULES.lowSocThreshold ? "#d9534f" : "#4f8cff");
      ctx.fillStyle = "#aeb8cc";
      ctx.fillText(`电量 ${box.soc.toFixed(1)}%${box.degraded ? " 低功率" : ""}`,
        x + 12, baseY + 78);
      this._bar(ctx, x + 12, baseY + 86, 200, 8, box.insulation / 100, "#ffb14f");
      ctx.fillText(
        `保温 ${box.insulation} | 超限 ${box.violations} | ` +
        `${box.compressorOn ? "压缩机开" : "待机"}${box.delivered ? " | 已交付" : ""}`,
        x + 12,
        baseY + 112,
      );
    });
  }

  _bar(ctx, x, y, w, h, ratio, color) {
    ctx.fillStyle = "#0d1220";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, ratio)) * w, h);
  }

  _drawHud(ctx, s) {
    ctx.fillStyle = "#e8ecf4";
    ctx.textAlign = "left";
    ctx.font = "bold 15px sans-serif";
    const dmgRatio = s.vehicle.damage / VEHICLE.damageFailThreshold;
    ctx.fillText(
      `tick ${s.tick} | 状态 ${s.status} | 急刹 ${s.vehicle.hardBrakes} ` +
      `损伤 ${s.vehicle.damage}/${VEHICLE.damageFailThreshold}`,
      40,
      34,
    );
    this._bar(ctx, 40, 44, 260, 10, dmgRatio,
      dmgRatio > 0.8 ? "#d9534f" : "#ffb14f");
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#aeb8cc";
    const last = s.events[s.events.length - 1];
    if (last) {
      ctx.fillText(`最近事件 t${last.tick} ${last.type} ` +
        JSON.stringify(
          Object.fromEntries(
            Object.entries(last).filter(([k]) => !["tick", "type"].includes(k)),
          ),
        ), 320, 34);
    }
    if (s.failure) {
      ctx.fillStyle = "#ff6b68";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(`任务失败：${s.failure.reason} @tick ${s.failure.tick}`, 40, 500);
    } else if (s.status === "success") {
      ctx.fillStyle = "#37d67a";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText("任务成功：全部药品在温交付，备用路线记录完整", 40, 500);
    }
  }
}
