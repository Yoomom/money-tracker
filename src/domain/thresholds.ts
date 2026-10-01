export const T = {
  savingsGreen: 0.2,
  savingsAmber: 0.15,
  fixedGreen: 0.6,
  fixedAmber: 0.65,
  carMax: 0.08,
  efAmberMonths: 3,
  runwayMonths: 12,
  creatorShare: 0.6,
  creatorStreakMonths: 6,
  tol: 0.01,
} as const;

/** Profit First split of creator/freelance income (after giving %). */
export const PROFIT_FIRST = { owner: 0.5, opex: 0.3, tax: 0.15, profit: 0.05 } as const;
