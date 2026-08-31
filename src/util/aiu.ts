/**
 * Copilot bills usage in "AI credits" (AIC), reported by the CLI/backend as
 * nano-AIU (1 AIC = 1e9 nano-AIU) and displayed to users as USD at a fixed
 * 1 AIC = $0.01 rate. These constants are shared by the statusline (which
 * reads nano-AIU straight from the CLI's own status payload) and the OTel
 * parser (which reads the same figure off each `github.copilot.nano_aiu`
 * span attribute) so both paths convert nano-AIU to USD identically.
 */
export const NANO_AIU_PER_AIC = 1_000_000_000;
export const AIC_PER_USD = 100;

export function nanoAiuToUsd(nano: number): number {
  return nano / NANO_AIU_PER_AIC / AIC_PER_USD;
}
