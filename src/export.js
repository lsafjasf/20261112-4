import {
  buildReservoirSummaries,
  buildStationSummaries,
  compactSnapshot,
} from './engine.js';
import { formatClock } from './model.js';

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function stationsToCsv(state) {
  const rows = buildStationSummaries(state);
  const headers = [
    '站点',
    '名称',
    '平均泵速(%)',
    '最低泵速(%)',
    '最高泵速(%)',
    '累计抽水(m3)',
    '耗电(kWh)',
    '湿井溢流(m3)',
    '最终湿井水位',
    '涉及故障数',
  ];
  const data = rows.map((row) => [
    row.station,
    row.name,
    row.avgSpeedPct,
    row.minSpeedPct,
    row.maxSpeedPct,
    row.pumpedM3,
    row.energyKWh,
    row.overflowM3,
    row.finalWetWellLevel,
    row.incidents,
  ]);
  return `\uFEFF${[headers, ...data].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function buildAuditReport(state, extra = {}) {
  const facilitySummaries = Object.values(state.facilities).map((facility) => ({
    id: facility.id,
    name: facility.name,
    kind: facility.kind,
    floodM3: facility.floodM3,
    peakFloodM3: facility.peakFloodM3,
    flooded: facility.flooded,
    floodedAt: facility.floodedAt === null ? null : formatClock(facility.floodedAt),
    limitM3: facility.floodLimitM3,
  }));
  return {
    generatedAt: new Date().toISOString(),
    scenario: {
      id: state.scenarioId,
      name: state.scenarioName,
      hash: extra.inputHash ?? null,
    },
    run: {
      clock: formatClock(state.timeSec),
      timeSec: state.timeSec,
      result: state.result,
      finalSnapshot: compactSnapshot(state),
    },
    stationSummaries: buildStationSummaries(state),
    reservoirSummaries: buildReservoirSummaries(state),
    facilitySummaries,
    recoveryWatch: state.recoveryWatch,
    faults: state.faultRecords,
    taskSequence: state.tasks,
    events: state.events,
    history: state.history,
    determinism: extra.determinism ?? null,
  };
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
