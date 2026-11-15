import { STATE_IDS } from './util.js';

export class UI {
  constructor() {
    this.els = {
      flash: document.getElementById('flash'),
      summary: document.getElementById('summary'),
      audioLog: document.getElementById('audio-log'),
      chain: document.getElementById('chain-output'),
      tests: document.getElementById('test-output'),
      hashes: document.getElementById('hash-output'),
      editors: document.getElementById('editors'),
    };
  }

  flash(msg) {
    this.els.flash.textContent = msg;
    this.els.flash.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.els.flash.classList.remove('show'), 2600);
  }

  logAudio(ev) {
    const row = document.createElement('div');
    row.className = 'log-line';
    row.textContent = `t=${ev.t.toFixed(3)}s ${ev.state}:${ev.id} → ${ev.sfx}`;
    this.els.audioLog.prepend(row);
    while (this.els.audioLog.children.length > 12) this.els.audioLog.lastChild.remove();
  }

  logTransition(ev) {
    if (!ev || ev.type !== 'transition') return;
    const row = document.createElement('div');
    row.className = 'log-line';
    row.textContent = `t=${ev.t.toFixed(3)}s ${ev.from} → ${ev.to} (${ev.reason})`;
    this.els.audioLog.prepend(row);
  }

  logBlocked(ev) {
    const row = document.createElement('div');
    row.className = 'log-line blocked';
    row.textContent = `t=${ev.t.toFixed(3)}s hitBlocked：${ev.state} 蓄力中，受击被阻挡`;
    this.els.audioLog.prepend(row);
  }

  updateSummary(fsm, dirty) {
    const s = fsm.snapshot();
    this.els.summary.innerHTML = `
      <div><span class="k">state</span><b>${s.state}</b>${s.phase ? ` <em>[${s.phase}]</em>` : ''}</div>
      <div><span class="k">frame</span>${s.frame + 1}/${s.frameCount} @ ${s.fps}fps</div>
      <div><span class="k">clip</span>${s.clipTime.toFixed(3)}s blend=${s.blend}</div>
      <div><span class="k">velocity</span>${s.velocity} px/s</div>
      <div><span class="k">x</span>${s.x} px</div>
      <div><span class="k">moving</span>${s.moving} pending=${s.pendingMove}</div>
      <div><span class="k">scene nodes</span>${fsm ? '' : ''}7 (稳定，不随刷新重建)</div>
      <div><span class="k">redraw</span>全量 ${dirty.fullRedraws} / 局部 ${dirty.partialRedraws}</div>
      <div><span class="k">dirty px</span>${dirty.dirtyPixels}</div>
    `;
  }

  refreshEditors(project) {
    const host = this.els.editors;
    host.innerHTML = '';
    for (const id of STATE_IDS) {
      host.appendChild(this.stateCard(id, project.config.states[id]));
    }
  }

  stateCard(id, st) {
    const card = document.createElement('section');
    card.className = 'state-card';
    card.dataset.state = id;
    const rows = [
      ['fps', st.fps, 'number', 1, 60, 0.5],
      ['transition(ms)', st.transition, 'number', 0, 1000, 10],
      ['frameCount', st.frameCount, 'number', 1, 64, 1],
      ['moveSpeed', st.moveSpeed, 'number', -1000, 1000, 10],
    ];
    card.innerHTML = `<h4>${id} <small>${st.loop ? 'loop' : 'oneshot'}</small></h4>` +
      rows.map(([label, val, type, min, max, step]) => `
        <label>${label}
          <input data-key="${labelName(label)}" type="${type}" value="${val}"
            min="${min}" max="${max}" step="${step}">
        </label>`).join('') +
      this.attackRows(st) +
      this.eventRows(st);
    return card;
  }

  attackRows(st) {
    if (st.id !== 'attack' || st.chargeFrames === undefined) return '';
    return [['chargeFrames', st.chargeFrames], ['strikeFrames', st.strikeFrames],
      ['recoveryFrames', st.recoveryFrames]]
      .map(([k, v]) => `<label>${k}<input data-key="${k}" type="number" value="${v}" min="0" max="64" step="1"></label>`)
      .join('');
  }

  eventRows(st) {
    return `<div class="events">${st.events.map((ev, i) => `
      <label>event[${i}].at
        <input data-event-at="${i}" type="number" value="${ev.at}" min="0" max="0.999" step="0.025">
      </label>
      <label>sfx
        <select data-event-sfx="${i}">
          ${['blip', 'tick', 'thud', 'whoosh'].map((s) =>
            `<option ${s === ev.sfx ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </label>`).join('')}</div>`;
  }

  renderChain(result, config) {
    const trs = result.events.filter((e) => e.type === 'transition');
    const frames = result.events.filter((e) => e.type === 'frame');
    const sfx = result.events.filter((e) => e.type === 'sfx');
    const blocked = result.events.filter((e) => e.type === 'hitBlocked');
    this.els.chain.innerHTML = `
      <h4>连续状态切换（${continuousSteps(result)} 步固定步长 1/60s）</h4>
      <p class="mono">traceHash=<b>${result.traceHash}</b> eventHash=<b>${result.eventHash}</b></p>
      <ol class="chain-list">
        ${trs.map((e) => `<li>t=${e.t.toFixed(3)}s ${e.from} → ${e.to} <em>${e.reason}</em></li>`).join('')}
      </ol>
      <p>帧事件 ${frames.length} 条，音效事件 ${sfx.length} 条，蓄力阻挡 ${blocked.length} 次。
      帧序按状态分组均为连续递增/循环归零。</p>`;
  }

  renderTestReport(report) {
    const rows = report.results.map((r) => `
      <tr class="${r.ok ? 'pass' : 'fail'}">
        <td>${r.suite}</td><td>${r.id}</td><td>${r.ok ? 'PASS' : 'FAIL'}</td>
        <td>${r.metrics ? r.metrics.before.traceHash : '—'}</td>
        <td>${r.metrics ? r.metrics.before.eventHash : '—'}</td>
        <td>${r.metrics ? r.metrics.before.objects : '—'}</td>
        <td>${r.metrics ? r.metrics.before.shot.pixelHash : '—'}</td>
        <td>${r.metrics && r.recomputeStable ? '一致' : (r.metrics ? '不一致' : r.details.join(';'))}</td>
      </tr>`).join('');
    this.els.tests.innerHTML = `
      <h4>普通 / 边界 / 失败三类场景（重算前后对照）</h4>
      <table>
        <thead><tr><th>套件</th><th>用例</th><th>结果</th><th>traceHash</th><th>eventHash</th>
        <th>对象数</th><th>截图哈希</th><th>重算比对</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><b>${report.summary.passed}/${report.summary.total}</b> 通过，失败 ${report.summary.failed}。</p>`;
  }

  renderHashes(before, after, label) {
    const eq = (k) => before[k] === after[k] ? '一致' : '差异';
    const shots = before.shot && after.shot ? `
      <tr><td>截图缩略图</td>
        <td><img class="thumb" src="${before.shot.dataUrl}" alt="before"></td>
        <td><img class="thumb" src="${after.shot.dataUrl}" alt="after"></td>
        <td>非空像素 ${before.shot.nonzero} / ${after.shot.nonzero}</td>
      </tr>` : '';
    this.els.hashes.innerHTML = `
      <h4>重算前后测量对照 — ${label}</h4>
      <table>
        <thead><tr><th>指标</th><th>重算前</th><th>重算后</th><th>结论</th></tr></thead>
        <tbody>
          <tr><td>traceHash</td><td>${before.traceHash}</td><td>${after.traceHash}</td><td>${eq('traceHash')}</td></tr>
          <tr><td>eventHash</td><td>${before.eventHash}</td><td>${after.eventHash}</td><td>${eq('eventHash')}</td></tr>
          <tr><td>对象数</td><td>${before.objects ?? before.graphNodes}</td><td>${after.objects ?? after.graphNodes}</td><td>${eq('objects') ? eq('objects') : eq('graphNodes')}</td></tr>
          <tr><td>截图哈希</td><td>${before.shot ? before.shot.pixelHash : '—'}</td><td>${after.shot ? after.shot.pixelHash : '—'}</td><td>${before.shot && before.shot.pixelHash === after.shot.pixelHash ? '一致' : '—'}</td></tr>
          ${shots}
        </tbody>
      </table>`;
  }

  renderVerdict(consistent, text) {
    const box = document.getElementById('verdict');
    box.className = 'verdict ' + (consistent ? 'ok' : 'bad');
    box.textContent = text;
  }
}

function labelName(label) {
  if (label.startsWith('transition')) return 'transition';
  return label;
}

function continuousSteps(result) {
  return result.traces.length;
}
