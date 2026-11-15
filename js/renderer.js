import { round6 } from './util.js';

export function createSceneGraph() {
  const names = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'weapon'];
  return names.map((name) => ({
    name,
    x: 0, y: 0, angle: 0, len: 26, r: 10, visible: true,
    version: 0,
  }));
}

export function poseCharacter(graph, fsm, width, height) {
  const snap = fsm.snapshot();
  const ground = height - 56;
  const cx = width / 2 + snap.x * 0.6;
  const p = (2 * Math.PI * snap.frame) / snap.frameCount;
  const st = snap.state;
  const phase = snap.phase;
  const blend = snap.inTransition ? snap.blend : 1;
  const set = (i, x, y, angle, len, r) => {
    const node = graph[i];
    const next = { x: round6(x), y: round6(y), angle: round6(angle), len, r };
    let changed = false;
    for (const key of Object.keys(next)) {
      if (node[key] !== next[key]) { node[key] = next[key]; changed = true; }
    }
    if (changed) node.version++;
  };
  const bob = st === 'move' ? Math.sin(p) * 4 : st === 'idle' ? Math.sin(p * 0.5) * 2 : 0;
  set(0, cx, ground - 46 + bob, 0, 46, 14);
  set(1, cx, ground - 72 + bob, 0, 0, 11);
  const swing = st === 'move' ? Math.sin(p) * 0.7 : 0.15;
  const crouch = st === 'attack' && phase === 'charge' ? 5 : 0;
  set(2, cx - 12, ground - 40 + bob + crouch, -swing + (st === 'hit' ? -0.5 : 0), 24, 5);
  const armAngle = st === 'attack'
    ? (phase === 'charge' ? -1.4 : phase === 'strike' ? 0.9 : 0.4)
    : swing;
  set(3, cx + 12, ground - 40 + bob + crouch, armAngle, 24, 5);
  set(4, cx - 7, ground - 24 + bob, st === 'move' ? -swing * 0.6 : 0, 26, 6);
  set(5, cx + 7, ground - 24 + bob, st === 'move' ? swing * 0.6 : 0, 26, 6);
  set(6, cx + 12, ground - 40 + bob + crouch, armAngle, 34, 3);
  return { cx, ground, blend, changedNodes: graph.filter((n) => n.version > 0).length };
}

const STATE_COLOR = {
  idle: '#7dd3fc',
  move: '#86efac',
  hit: '#fca5a5',
  attack: '#fcd34d',
};

export function drawScene(canvas, fsm, view, opts = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const graph = opts.graph || createSceneGraph();
  const pose = poseCharacter(graph, fsm, width, height);
  const snap = fsm.snapshot();
  const tint = view.tint || STATE_COLOR[snap.state];
  const region = opts.dirtyRegion;
  const regions = Array.isArray(region) ? region : (region ? [region] : null);

  ctx.save();
  if (regions) {
    for (const r of regions) {
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (view.grid) drawBackdrop(ctx, width, height, view, r);
    }
    drawGround(ctx, width, pose.ground);
  } else {
    ctx.clearRect(0, 0, width, height);
    drawBackdrop(ctx, width, height, view);
    drawGround(ctx, width, pose.ground);
  }
  if (view.frameLines) drawFrameLines(ctx, fsm, width, height, tint);
  if (view.ghost && snap.prevState) drawGhost(ctx, fsm, pose);
  drawCharacter(ctx, graph, tint, pose.blend);
  if (view.eventMarkers) drawEventMarkers(ctx, fsm, pose, width);
  drawStateBadge(ctx, snap, tint);
  ctx.restore();
  return { graph, region: regions || { x: 0, y: 0, w: width, h: height } };
}

function drawBackdrop(ctx, width, height, view, region = null) {
  ctx.fillStyle = '#0f172a';
  if (!region) ctx.fillRect(0, 0, width, height);
  if (!view.grid) return;
  if (region) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  const x0 = region ? Math.floor(region.x / 32) * 32 : 0;
  const x1 = region ? region.x + region.w : width;
  const y0 = region ? Math.floor(region.y / 32) * 32 : 0;
  const y1 = region ? region.y + region.h : height;
  for (let x = x0; x <= x1; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = y0; y <= y1; y += 32) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  if (region) ctx.restore();
}

function drawGround(ctx, width, y) {
  ctx.strokeStyle = 'rgba(226,232,240,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
}

function drawFrameLines(ctx, fsm, width, height, tint) {
  const st = fsm.config.states[fsm.state];
  const barY = height - 26;
  const seg = width / st.frameCount;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, barY - 10, width, 22);
  ctx.clip();
  ctx.strokeStyle = 'rgba(226,232,240,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= st.frameCount; i++) {
    ctx.beginPath();
    ctx.moveTo(i * seg, barY - 8);
    ctx.lineTo(i * seg, barY + 8);
    ctx.stroke();
  }
  ctx.fillStyle = tint;
  ctx.fillRect(fsm.frame * seg, barY - 5, Math.max(2, seg - 2), 4);
  ctx.restore();
}

function drawEventMarkers(ctx, fsm, pose, width) {
  const st = fsm.config.states[fsm.state];
  const seg = width / st.frameCount;
  ctx.fillStyle = '#f472b6';
  for (const ev of st.events) {
    const x = ev.at * st.frameCount * seg;
    ctx.beginPath();
    ctx.arc(x, pose.ground - 92, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGhost(ctx, fsm, pose) {
  ctx.globalAlpha = 0.25 * (1 - pose.blend);
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(pose.cx - 24, pose.ground - 60, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawCharacter(ctx, graph, tint, blend) {
  ctx.strokeStyle = tint;
  ctx.fillStyle = tint;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const [body, head, armL, armR, legL, legR, weapon] = graph;
  limb(ctx, body.x, body.y, body.x + 2, body.y + body.len, body.r);
  ctx.beginPath(); ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2); ctx.fill();
  limb(ctx, armL.x, armL.y, armL.x + Math.sin(armL.angle) * armL.len,
    armL.y + Math.cos(armL.angle) * armL.len, armL.r);
  limb(ctx, armR.x, armR.y, armR.x + Math.sin(armR.angle) * armR.len,
    armR.y + Math.cos(armR.angle) * armR.len, armR.r);
  limb(ctx, legL.x, legL.y, legL.x + Math.sin(legL.angle) * legL.len,
    legL.y + Math.cos(legL.angle) * legL.len, legL.r);
  limb(ctx, legR.x, legR.y, legR.x + Math.sin(legR.angle) * legR.len,
    legR.y + Math.cos(legR.angle) * legR.len, legR.r);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = weapon.r;
  limb(ctx, weapon.x, weapon.y,
    weapon.x + Math.sin(weapon.angle) * weapon.len,
    weapon.y + Math.cos(weapon.angle) * weapon.len, 1);
}

function limb(ctx, x1, y1, x2, y2, width) {
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function drawStateBadge(ctx, snap, tint) {
  ctx.font = '13px monospace';
  ctx.fillStyle = tint;
  const label = `${snap.state} f${snap.frame + 1}/${snap.frameCount}` +
    (snap.phase ? ` [${snap.phase}]` : '');
  ctx.fillText(label, 12, 22);
  ctx.fillStyle = 'rgba(226,232,240,0.75)';
  ctx.fillText(`v=${snap.velocity} x=${snap.x}`, 12, 40);
}
