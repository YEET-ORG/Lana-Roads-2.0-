/**
 * Cosmetic agent (animal) choice. Purely visual and local: rarity/class
 * mechanics stay authoritative on-chain — this only picks which of the 40
 * voxel animals represents you. Default derives from the wallet.
 */
import { AGENT_COUNT, agentId } from "../game/renderer/assets";

const KEY = "crossy-world:agent";

export const AGENT_NAMES = [
  "UNICORN",
  "HIPPO",
  "RHINO",
  "GIRAFFE",
  "MOOSE",
  "FROG",
  "CROC",
  "PUP",
  "PANDA",
  "PIGLET",
  "PARROT",
  "DUCK",
  "CHICK",
  "SPARROW",
  "ROOSTER",
  "OWL",
  "HOG",
  "COW",
  "PENGUIN",
  "SHEEP",
  "PEEP",
  "LION",
  "BEAR",
  "FOX",
  "GOAT",
  "MONKEY",
  "TIGER",
  "LOBSTER",
  "WHALE",
  "FISH",
  "RACCOON",
  "PENG",
  "SQUIRREL",
  "SEAL",
  "CARDINAL",
  "LLAMA",
  "FIESTA",
  "WORM",
  "KITTY",
  "CUB",
] as const;

export function agentName(index: number): string {
  const i = ((index % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT;
  return AGENT_NAMES[i] ?? `AGENT ${String(i).padStart(2, "0")}`;
}

export function getAgentChoice(): number | null {
  const raw = localStorage.getItem(KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < AGENT_COUNT ? n : null;
}

export function setAgentChoice(n: number) {
  localStorage.setItem(KEY, String(((n % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT));
}

/**
 * The agent a wallet is drawn as, derived from the wallet alone.
 *
 * Deliberately ignores the local player's own pick: this is how OTHER
 * people are identified, and reading our own choice here would name every
 * player on the leaderboard after us. Matches the renderer's own hash so a
 * name on the board belongs to the shape on the road.
 */
export function agentIndexForWallet(wallet: string): number {
  let h = 5381;
  for (let i = 0; i < wallet.length; i++)
    h = (Math.imul(h, 33) ^ wallet.charCodeAt(i)) >>> 0;
  return h % AGENT_COUNT;
}

export function agentModelIdFor(wallet: string): string {
  const choice = getAgentChoice();
  if (choice != null) return agentId(choice);
  let h = 5381;
  for (let i = 0; i < wallet.length; i++)
    h = (Math.imul(h, 33) ^ wallet.charCodeAt(i)) >>> 0;
  return agentId(h % AGENT_COUNT);
}
