// Client-safe display helpers.

export const nf = (n: number | null | undefined, dp = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const int = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-IN"));

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
