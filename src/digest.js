export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

export function digest(value) {
  const input = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function verificationPayload(result) {
  return {
    taskSequence: result.taskSequence,
    resources: {
      totals: result.totals,
      stations: result.stationSummaries,
      reservoirs: result.reservoirSummaries,
    },
    final: {
      passed: result.passed,
      status: result.status,
      reason: result.reason,
      checks: result.checks,
      floodedFacilities: result.floodedFacilities,
    },
  };
}
