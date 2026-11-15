const routineSchedule = [
  { at: 3_000, type: 'setPump', station: 'P1', value: 68 },
  { at: 3_000, type: 'setPump', station: 'P4', value: 76 },
  { at: 5_700, type: 'setPriority', order: ['R2', 'R1', 'R3'] },
  { at: 5_850, type: 'setGate', reservoir: 'R2', value: 72 },
  { at: 5_850, type: 'setGate', reservoir: 'R1', value: 64 },
  { at: 6_000, type: 'setPump', station: 'P1', value: 94 },
  { at: 6_000, type: 'setPump', station: 'P2', value: 88 },
  { at: 6_000, type: 'setPump', station: 'P3', value: 88 },
  { at: 6_000, type: 'setPump', station: 'P4', value: 92 },
  { at: 9_600, type: 'setPump', station: 'P1', value: 78 },
  { at: 9_600, type: 'setPump', station: 'P2', value: 72 },
  { at: 9_600, type: 'setPump', station: 'P3', value: 70 },
  { at: 9_600, type: 'setPump', station: 'P4', value: 82 },
  { at: 13_800, type: 'setPump', station: 'P4', value: 70 },
  { at: 13_800, type: 'setPump', station: 'P1', value: 66 },
  { at: 16_200, type: 'setPriority', order: ['R1', 'R3', 'R2'] },
];

const burstFailureSchedule = [
  { at: 3_600, type: 'setPump', station: 'P2', value: 100 },
  { at: 3_600, type: 'setPump', station: 'P3', value: 100 },
  { at: 3_600, type: 'setPump', station: 'P1', value: 82 },
  { at: 3_600, type: 'setPump', station: 'P4', value: 78 },
  { at: 3_660, type: 'setPriority', order: ['R2', 'R1', 'R3'] },
  { at: 3_660, type: 'setGate', reservoir: 'R2', value: 82 },
];

export const SCENARIOS = {
  routine: {
    id: 'routine',
    name: '暴雨值守（平稳流程）',
    description: '按降雨峰值手动调整四站泵速，观察湿井与蓄水池联动。',
    initial: {
      pumpSpeeds: { P1: 54, P2: 57, P3: 53, P4: 61 },
      gates: { R1: 58, R2: 44, R3: 52 },
      priority: ['R2', 'R3', 'R1'],
    },
    schedule: routineSchedule,
  },
  'burst-replan': {
    id: 'burst-replan',
    name: '爆管重规划（可恢复）',
    description: '中心泵组超压触发干管爆管；隔离、降载并重排蓄水优先级后恢复。',
    initial: {
      pumpSpeeds: { P1: 62, P2: 66, P3: 61, P4: 68 },
      gates: { R1: 52, R2: 58, R3: 56 },
      priority: ['R2', 'R3', 'R1'],
    },
    schedule: [
      { at: 3_600, type: 'setPump', station: 'P2', value: 100 },
      { at: 3_600, type: 'setPump', station: 'P3', value: 100 },
      { at: 3_600, type: 'setPump', station: 'P1', value: 88 },
      { at: 3_600, type: 'setPump', station: 'P4', value: 88 },
      { at: 4_200, type: 'isolateBurst', segment: 'S2' },
      { at: 4_200, type: 'setPump', station: 'P1', value: 72 },
      { at: 4_200, type: 'setPump', station: 'P2', value: 86 },
      { at: 4_200, type: 'setPump', station: 'P3', value: 88 },
      { at: 4_200, type: 'setPump', station: 'P4', value: 78 },
      { at: 4_200, type: 'setGate', reservoir: 'R2', value: 38 },
      { at: 4_200, type: 'setPriority', order: ['R2', 'R1', 'R3'] },
      { at: 4_500, type: 'repairBurst', segment: 'S2' },
      { at: 6_600, type: 'setPump', station: 'P1', value: 96 },
      { at: 6_600, type: 'setPump', station: 'P2', value: 86 },
      { at: 6_600, type: 'setPump', station: 'P3', value: 88 },
      { at: 6_600, type: 'setPump', station: 'P4', value: 94 },
      { at: 6_600, type: 'setGate', reservoir: 'R1', value: 58 },
      { at: 6_600, type: 'setGate', reservoir: 'R3', value: 44 },
      { at: 9_900, type: 'setPump', station: 'P1', value: 74 },
      { at: 9_900, type: 'setPump', station: 'P2', value: 70 },
      { at: 9_900, type: 'setPump', station: 'P3', value: 72 },
      { at: 9_900, type: 'setPump', station: 'P4', value: 82 },
      { at: 14_400, type: 'setPump', station: 'P4', value: 68 },
      { at: 17_400, type: 'setPump', station: 'P1', value: 58 },
    ],
  },
  'burst-failure': {
    id: 'burst-failure',
    name: '爆管未处置（失败场景）',
    description: '重复制造中心干管超压爆管，但保持高泵速且不隔离，关键街区将进水。',
    initial: {
      pumpSpeeds: { P1: 62, P2: 66, P3: 61, P4: 68 },
      gates: { R1: 52, R2: 58, R3: 56 },
      priority: ['R2', 'R3', 'R1'],
    },
    schedule: burstFailureSchedule,
  },
};

export const DEFAULT_SCENARIO_ID = 'burst-replan';

export function getScenario(id = DEFAULT_SCENARIO_ID) {
  const scenario = SCENARIOS[id];
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return structuredClone(scenario);
}

export function listScenarios() {
  return Object.values(SCENARIOS).map(({ id, name, description }) => ({ id, name, description }));
}
