import type { GradedMon } from "./types";

export interface TradeFlags {
  /** DUMP copies that count as a raid attacker, including pre-evolutions. */
  tradeRaid: boolean;
  /** DUMP copies whose family has a seat in a bright league. */
  tradePvp: boolean;
}

/**
 * A DUMP worth trading for candy. Shadows stay out: a shadow trade spends the daily special trade.
 * A copy that matches both switches is still one row.
 */
export function isForTrade(row: GradedMon, flags: TradeFlags): boolean {
  if (row.mon.shadow) return false;
  if (flags.tradeRaid && row.raidIv != null) return true;
  if (flags.tradePvp && row.pvpFamily === true) return true;
  return false;
}

/** Split a scan-ordered DUMP list. Each side keeps that order. */
export function splitDump(rows: GradedMon[], flags: TradeFlags): { trade: GradedMon[]; transfer: GradedMon[] } {
  const trade: GradedMon[] = [];
  const transfer: GradedMon[] = [];
  for (const row of rows) {
    if (isForTrade(row, flags)) trade.push(row);
    else transfer.push(row);
  }
  return { trade, transfer };
}
