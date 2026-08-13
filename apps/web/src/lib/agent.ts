/**
 * Cosmetic agent (animal) choice. Purely visual and local: rarity/class
 * mechanics stay authoritative on-chain — this only picks which of the 40
 * voxel animals represents you. Default derives from the wallet.
 */
import { AGENT_COUNT, agentId } from "../game/renderer/assets";

const KEY = "crossy-world:agent";

export function getAgentChoice(): number | null {
  const raw = localStorage.getItem(KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < AGENT_COUNT ? n : null;
}

export function setAgentChoice(n: number) {
  localStorage.setItem(KEY, String(((n % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT));
}

export function agentModelIdFor(wallet: string): string {
  const choice = getAgentChoice();
  if (choice != null) return agentId(choice);
  let h = 5381;
  for (let i = 0; i < wallet.length; i++)
    h = (Math.imul(h, 33) ^ wallet.charCodeAt(i)) >>> 0;
  return agentId(h % AGENT_COUNT);
}
