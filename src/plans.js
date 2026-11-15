export const AUDIT_PLANS = {
  standard: [
    { tick: 0, type: "toggleAerator", cageId: 1 },
    { tick: 0, type: "toggleAerator", cageId: 2 },
    { tick: 0, type: "toggleAerator", cageId: 3 },
    { tick: 0, type: "cleanNet", cageId: 1 },
    { tick: 0, type: "cleanNet", cageId: 2 },
    { tick: 0, type: "cleanNet", cageId: 3 },
    { tick: 0, type: "feed", cageId: 1, amount: 4 },
    { tick: 0, type: "feed", cageId: 2, amount: 4 },
    { tick: 0, type: "feed", cageId: 3, amount: 4 },
    { tick: 60, type: "cleanNet", cageId: 2 },
    { tick: 60, type: "feed", cageId: 1, amount: 4 },
    { tick: 60, type: "feed", cageId: 2, amount: 4 },
    { tick: 60, type: "feed", cageId: 3, amount: 4 }
  ],
  storm: [
    { tick: 0, type: "toggleAerator", cageId: 1 },
    { tick: 0, type: "toggleAerator", cageId: 2 },
    { tick: 0, type: "toggleAerator", cageId: 3 },
    { tick: 0, type: "cleanNet", cageId: 1 },
    { tick: 0, type: "cleanNet", cageId: 2 },
    { tick: 0, type: "cleanNet", cageId: 3 },
    { tick: 0, type: "feed", cageId: 1, amount: 4 },
    { tick: 0, type: "feed", cageId: 2, amount: 4 },
    { tick: 0, type: "feed", cageId: 3, amount: 4 },
    { tick: 33, type: "repairNet", cageId: 3 },
    { tick: 60, type: "cleanNet", cageId: 2 },
    { tick: 60, type: "cleanNet", cageId: 3 },
    { tick: 60, type: "feed", cageId: 1, amount: 4 },
    { tick: 60, type: "feed", cageId: 2, amount: 4 },
    { tick: 60, type: "feed", cageId: 3, amount: 4 }
  ]
};
