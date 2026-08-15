/**
 * Contract-backed gacha shop and pack-opening ceremony.
 *
 * The client never chooses the result: payment snapshots a banner's odds,
 * MagicBlock VRF assigns the rarity and variant, and the final action mints
 * that exact assignment as a Metaplex Core asset.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { PullSummary, VariantSummary } from "@crossy-world/sdk";
import { TIER_NAMES } from "@crossy-world/sdk";
import { Button, Confetti, Icon, Loader, Notice, Pill, Sheet } from "../../design-system";
import type { Bootstrapped } from "../../lib/client";
import { agentName } from "../../lib/agent";
import { agentId } from "../../game/renderer/assets";
import { sfx } from "../../game/audio";
import { AgentPackPreview } from "./AgentPackPreview";

const SEASON = Number(import.meta.env.VITE_SEASON ?? 1);
const POLL_MS = 1500;
const MIN_OPEN_MS = 1800;

const RARITY = ["common", "rare", "epic", "legendary"] as const;
const TIER_COPY = [
  { title: "Scout", strap: "The classic pull", fallbackPrice: 5_000_000n },
  { title: "Ranger", strap: "Higher rare odds", fallbackPrice: 10_000_000n },
  { title: "Crown", strap: "Best epic odds", fallbackPrice: 20_000_000n },
] as const;
const CLASS_NAMES: Record<number, string> = {
  1: "Dash",
  2: "Shield",
  3: "Leap",
  4: "Hook",
};

interface BannerView {
  tier: number;
  price: bigint;
  weights: number[];
}

interface PityView {
  epic: number;
  legendary: number;
}

type Stage =
  | { name: "shop" }
  | { name: "paying"; tier: number }
  | { name: "opening"; pullNonce: number; tier: number; startedAt: number }
  | { name: "revealed"; pull: PullSummary; variant: VariantSummary }
  | { name: "minting"; pull: PullSummary; variant: VariantSummary }
  | { name: "minted"; variant: VariantSummary; asset: string }
  | { name: "refundable"; pullNonce: number; tier: number };

function usdc(v: bigint | number): string {
  return `${(Number(v) / 1e6).toFixed(2)} USDC`;
}

function summaryFromAccount(
  pull: any,
  pullNonce: number,
  address = PublicKey.default,
): PullSummary {
  const state = Object.keys(pull.state)[0] as PullSummary["state"];
  return {
    address,
    pullNonce,
    season: pull.season,
    tier: pull.tier,
    price: BigInt(pull.price.toString()),
    state,
    assignedRarity: pull.assignedRarity,
    assignedVariant: pull.assignedVariant,
    mintedAsset: pull.mintedAsset,
    requestedAt: Number(pull.requestedAt.toString()),
  };
}

export function PackSheet({
  boot,
  onAgentRevealed,
  onClose,
}: {
  boot: Bootstrapped;
  onAgentRevealed?: (modelId: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "shop" });
  const [selectedTier, setSelectedTier] = useState(0);
  const [banners, setBanners] = useState<Array<BannerView | null> | null>(null);
  const [variants, setVariants] = useState<VariantSummary[] | null>(null);
  const [pulls, setPulls] = useState<PullSummary[] | null>(null);
  const [pity, setPity] = useState<PityView[]>(() =>
    Array.from({ length: 3 }, () => ({ epic: 0, legendary: 0 })),
  );
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<PublicKey | null>(null);
  const stageRef = useRef(stage);
  const onAgentRevealedRef = useRef(onAgentRevealed);
  stageRef.current = stage;
  onAgentRevealedRef.current = onAgentRevealed;

  const resumePull = useCallback((pull: PullSummary, list: VariantSummary[]) => {
    // `randomnessReady` sits between paying and being assigned: MagicBlock's
    // VRF has answered but nothing has drawn the variant from it yet. It is
    // still an open pack, so it resumes exactly like `pending` — and it MUST,
    // because the profile holds one unresolved pull at a time, so dropping
    // back to the shop would show a buy button that can only fail.
    if (pull.state === "pending" || pull.state === "randomnessReady") {
      setSelectedTier(pull.tier);
      setStage({
        name: "opening",
        pullNonce: pull.pullNonce,
        tier: pull.tier,
        startedAt: performance.now(),
      });
      return true;
    }
    if (pull.state === "refundable") {
      setSelectedTier(pull.tier);
      setStage({ name: "refundable", pullNonce: pull.pullNonce, tier: pull.tier });
      return true;
    }
    if (pull.state === "assigned") {
      const variant = list.find((v) => v.variantId === pull.assignedVariant);
      if (!variant) return false;
      setSelectedTier(pull.tier);
      onAgentRevealedRef.current?.(agentId(variant.modelId));
      setStage({ name: "revealed", pull, variant });
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [bannerRows, list, history, config, profile] = await Promise.all([
        Promise.all(
          [0, 1, 2].map((tier) => boot.client.getBanner(SEASON, tier).catch(() => null)),
        ),
        boot.client.listVariants(SEASON),
        boot.client.listPulls(),
        boot.client.getConfig(),
        boot.client.getProfile().catch(() => null),
      ]);
      const nextBanners = bannerRows.map((banner: any, tier) =>
        banner
          ? {
              tier,
              price: BigInt(banner.price.toString()),
              weights: [...(banner.baseWeights as number[])],
            }
          : null,
      );
      setBanners(nextBanners);
      setVariants(list);
      setPulls(history);
      setPity(
        [0, 1, 2].map((tier) => ({
          epic: profile?.pity?.[tier]?.epicMisses ?? 0,
          legendary: profile?.pity?.[tier]?.legendaryMisses ?? 0,
        })),
      );

      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const token = getAssociatedTokenAddressSync(
        new PublicKey(config.usdcMint),
        boot.wallet.publicKey,
      );
      tokenRef.current = token;
      const bal = await boot.client.connection
        .getTokenAccountBalance(token)
        .catch(() => null);
      setBalance(bal ? BigInt(bal.value.amount) : 0n);

      // A pull survives closing the sheet and refreshing the page. Surface it
      // immediately so a paid assignment can never become stranded in UI.
      if (stageRef.current.name === "shop") {
        const active = history.find(
          (p) =>
            p.state === "pending" ||
            p.state === "randomnessReady" ||
            p.state === "assigned" ||
            p.state === "refundable",
        );
        if (active) queueMicrotask(() => resumePull(active, list));
      }
    } catch (e) {
      setError(`${(e as { message?: string }).message ?? e}`.slice(0, 160));
      setBanners((current) => current ?? [null, null, null]);
    }
  }, [boot, resumePull]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (stage.name !== "opening") return;
    let live = true;
    let revealing = false;
    const { pullNonce, startedAt } = stage;

    const tick = async () => {
      if (revealing) return;
      const account = await boot.client
        .getPull(boot.wallet.publicKey, pullNonce)
        .catch(() => null);
      if (!live || !account) return;
      const state = Object.keys(account.state)[0];
      if (state === "refundable") {
        setStage({ name: "refundable", pullNonce, tier: account.tier });
        return;
      }
      if (state !== "assigned" && state !== "claimed") return;
      revealing = true;
      const wait = Math.max(0, MIN_OPEN_MS - (performance.now() - startedAt));
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      const list = variants ?? (await boot.client.listVariants(SEASON));
      const variant = list.find((v) => v.variantId === account.assignedVariant);
      if (!variant || !live) return;
      const summary = summaryFromAccount(account, pullNonce);
      onAgentRevealedRef.current?.(agentId(variant.modelId));
      if (variant.rarity >= 2) sfx.fanfare();
      else sfx.confirm();
      setStage({ name: "revealed", pull: summary, variant });
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [boot, stage, variants]);

  async function buy() {
    const banner = banners?.[selectedTier];
    if (!tokenRef.current || !banner) return;
    setError(null);
    setStage({ name: "paying", tier: selectedTier });
    sfx.click();
    try {
      const review = await boot.client.reviewPull({
        seasonIndex: SEASON,
        tier: selectedTier,
        payerToken: tokenRef.current,
      });
      await boot.client.submitReviewed(review);
      setStage({
        name: "opening",
        pullNonce: review.pullNonce,
        tier: selectedTier,
        startedAt: performance.now(),
      });
    } catch (e) {
      const why = `${(e as { message?: string }).message ?? e}`;
      setError(
        /insufficient|0x1$/i.test(why)
          ? "Not enough USDC for this pack."
          : why.slice(0, 160),
      );
      setStage({ name: "shop" });
    }
  }

  async function mint() {
    if (stage.name !== "revealed") return;
    const { pull, variant } = stage;
    setStage({ name: "minting", pull, variant });
    try {
      const { asset } = await boot.client.claimPull({
        pullNonce: pull.pullNonce,
        uri: `https://lanaroads.xyz/agents/season${SEASON}/${variant.variantId}.json`,
      });
      sfx.fanfare();
      setStage({ name: "minted", variant, asset: asset.toBase58() });
      void load();
    } catch (e) {
      setError(`${(e as { message?: string }).message ?? e}`.slice(0, 160));
      setStage({ name: "revealed", pull, variant });
    }
  }

  async function refund() {
    if (stage.name !== "refundable" || !tokenRef.current) return;
    try {
      await boot.client.refundPull({
        pullNonce: stage.pullNonce,
        walletToken: tokenRef.current,
      });
      setStage({ name: "shop" });
      void load();
    } catch (e) {
      setError(`${(e as { message?: string }).message ?? e}`.slice(0, 160));
    }
  }

  const left = (rarity: number) =>
    (variants ?? [])
      .filter((variant) => variant.rarity === rarity && variant.active)
      .reduce((count, variant) => count + variant.remaining, 0);

  const banner = banners?.[selectedTier] ?? null;
  const shownPrice = banner?.price ?? TIER_COPY[selectedTier].fallbackPrice;
  const canAfford = balance == null || (banner != null && balance >= banner.price);

  return (
    <Sheet
      title="Agent packs"
      ariaLabel="Agent pack shop"
      tone="gold"
      className="pack-sheet"
      onClose={onClose}
    >
      {error && <Notice tone="error">{error}</Notice>}

      {stage.name === "shop" && (
        <div className="pack-shop">
          <div className="pack-shop__topline">
            <span>Season {SEASON}</span>
            <span>
              <Icon name="coin" size={14} />{" "}
              {balance == null ? "checking..." : usdc(balance)}
            </span>
          </div>

          <div className="pack-tier-picker" role="radiogroup" aria-label="Pack tier">
            {TIER_COPY.map((copy, tier) => {
              const item = banners?.[tier] ?? null;
              const price = item?.price ?? copy.fallbackPrice;
              return (
                <button
                  key={copy.title}
                  className={`pack-tier pack-tier--${tier} ${selectedTier === tier ? "is-selected" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={selectedTier === tier}
                  onClick={() => {
                    setSelectedTier(tier);
                    sfx.hop();
                  }}
                >
                  <span className="pack-tier__rank">0{tier + 1}</span>
                  <strong>{copy.title}</strong>
                  <small>{copy.strap}</small>
                  <span className="pack-tier__price">
                    {usdc(price).replace(".00", "")}
                  </span>
                  {banners && !item && (
                    <span className="pack-tier__offline">not live</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className={`pack-stage pack-stage--${selectedTier}`}>
            <PackCrate tier={selectedTier} onClick={() => void buy()} />
            <div className="pack-stage__copy">
              <span className="pack-stage__eyebrow">{TIER_NAMES[selectedTier]} pack</span>
              <strong>{TIER_COPY[selectedTier].title} crate</strong>
              <small>One permanent, tradable agent NFT</small>
            </div>
          </div>

          <div className="pack-pity" aria-label="Pity progress">
            <PityMeter
              label="Epic guarantee"
              value={pity[selectedTier].epic}
              max={10}
              tone="epic"
            />
            <PityMeter
              label="Legendary guarantee"
              value={pity[selectedTier].legendary}
              max={100}
              tone="legendary"
            />
          </div>

          <div className="pack-odds-head">
            <h3>Drop chances</h3>
            <span>VRF verified</span>
          </div>
          <div className="odds">
            {RARITY.map((rarity, index) => {
              const chance = banner?.weights[index];
              return (
                <div key={rarity} className={`odds__row odds__row--${rarity}`}>
                  <span className="odds__name">{rarity}</span>
                  <span className="odds__bar">
                    <span style={{ width: `${chance ?? 0}%` }} />
                  </span>
                  <span className="odds__pct">{chance == null ? "-" : `${chance}%`}</span>
                  <span className="odds__left">
                    {variants ? `${left(index)} left` : "..."}
                  </span>
                </div>
              );
            })}
          </div>

          <Button
            variant="play"
            size="giant"
            icon="spark"
            block
            disabled={!banner || !canAfford}
            onClick={() => void buy()}
          >
            {!banner
              ? "Pack unavailable"
              : !canAfford
                ? "Not enough USDC"
                : `Open for ${usdc(shownPrice)}`}
          </Button>
          <p className="pack-trustline">
            <Icon name="lock" size={13} /> Odds lock when you pay. Results come from
            MagicBlock VRF and cannot be rerolled.
          </p>

          {pulls != null && pulls.length > 0 && (
            <section className="pack-collection">
              <h3>Your recent pulls</h3>
              <ul className="pack-history">
                {pulls.slice(0, 6).map((pull) => {
                  const variant = (variants ?? []).find(
                    (item) => item.variantId === pull.assignedVariant,
                  );
                  const resumable =
                    pull.state === "pending" ||
                    pull.state === "randomnessReady" ||
                    pull.state === "assigned" ||
                    pull.state === "refundable";
                  return (
                    <li key={pull.pullNonce} className="pack-history__row">
                      <span
                        className={`rarity-dot rarity-dot--${RARITY[pull.assignedRarity] ?? "common"}`}
                      />
                      <span className="pack-history__name">
                        {variant
                          ? agentName(variant.modelId)
                          : `${TIER_NAMES[pull.tier]} pack`}
                        <small>pull #{pull.pullNonce}</small>
                      </span>
                      {resumable ? (
                        <button
                          type="button"
                          className="pack-history__resume"
                          onClick={() => resumePull(pull, variants ?? [])}
                        >
                          Resume
                        </button>
                      ) : (
                        <span className="pack-history__state">{pull.state}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {(stage.name === "paying" || stage.name === "opening") && (
        <div className={`pack-opening pack-opening--${stage.tier}`}>
          <OpeningSteps step={stage.name === "paying" ? 0 : 1} />
          <div className="pack-opening__theatre">
            <div className="pack-opening__rays" />
            <PackCrate tier={stage.tier} opening />
            <span className="pack-opening__shadow" />
          </div>
          <Loader
            label={stage.name === "paying" ? "locking your odds..." : "VRF is drawing..."}
          />
          <p className="pack-opening__status">
            {stage.name === "paying"
              ? "Confirming payment on Solana"
              : "Your result is being selected from the season inventory"}
          </p>
          <p className="pack-trustline">
            You can close this screen safely. Your paid pull will resume here next time.
          </p>
        </div>
      )}

      {(stage.name === "revealed" || stage.name === "minting") && (
        <Reveal variant={stage.variant} busy={stage.name === "minting"} onMint={mint} />
      )}

      {stage.name === "minted" && (
        <div className={`reveal reveal--${RARITY[stage.variant.rarity]}`}>
          <Confetti count={22} />
          <div className="reveal__burst" />
          <div className="reveal__kicker">
            <Icon name="check" size={14} /> Mint complete
          </div>
          <div className="reveal__model">
            <AgentPackPreview modelId={stage.variant.modelId} />
          </div>
          <div className="reveal__rarity">{RARITY[stage.variant.rarity]}</div>
          <div className="reveal__name">{agentName(stage.variant.modelId)}</div>
          <div className="reveal__meta">Permanent NFT in your wallet</div>
          <code className="reveal__asset">
            {stage.asset.slice(0, 12)}...{stage.asset.slice(-6)}
          </code>
          <div className="row reveal__actions">
            <Button
              variant="play"
              icon="spark"
              onClick={() => setStage({ name: "shop" })}
            >
              Open another
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}

      {stage.name === "refundable" && (
        <div className="pack-refund">
          <span className="pack-refund__icon">
            <Icon name="coin" size={34} />
          </span>
          <h3>This rarity sold out</h3>
          <Notice tone="warn">
            Your pack was not downgraded. The program protected the exact result and
            marked the full payment refundable.
          </Notice>
          <div className="row">
            <Button variant="primary" icon="coin" onClick={() => void refund()}>
              Refund all USDC
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PackCrate({
  tier,
  opening = false,
  onClick,
}: {
  tier: number;
  opening?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="pack-crate__halo" />
      <span className="pack-crate__lid" />
      <span className="pack-crate__band pack-crate__band--v" />
      <span className="pack-crate__band pack-crate__band--h" />
      <span className="pack-crate__badge">
        <Icon name="spark" size={22} />
      </span>
      <span className="pack-crate__rank">0{tier + 1}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`pack-crate pack-crate--${tier}`}
        aria-label={`Open ${TIER_NAMES[tier]} pack`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={`pack-crate pack-crate--${tier} ${opening ? "is-opening" : ""}`}>
      {content}
    </div>
  );
}

function PityMeter({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "epic" | "legendary";
}) {
  const remaining = Math.max(1, max - value);
  return (
    <div className={`pity-meter pity-meter--${tone}`}>
      <div className="pity-meter__copy">
        <span>{label}</span>
        <strong>{remaining === 1 ? "Next pull" : `${remaining} pulls max`}</strong>
      </div>
      <span className="pity-meter__track">
        <span style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </span>
    </div>
  );
}

function OpeningSteps({ step }: { step: number }) {
  return (
    <div className="pack-opening-steps" aria-label="Pack opening progress">
      {["Odds locked", "VRF draw", "Reveal"].map((label, index) => (
        <span key={label} className={index <= step ? "is-active" : ""}>
          <i>{index < step ? <Icon name="check" size={11} /> : index + 1}</i>
          {label}
        </span>
      ))}
    </div>
  );
}

function Reveal({
  variant,
  busy,
  onMint,
}: {
  variant: VariantSummary;
  busy: boolean;
  onMint: () => void;
}) {
  const rarity = RARITY[variant.rarity] ?? "common";
  return (
    <div className={`reveal reveal--${rarity}`}>
      {variant.rarity >= 2 && <Confetti count={20} />}
      <div className="reveal__burst" />
      <div className="reveal__kicker">New agent found</div>
      <div className="reveal__model">
        <AgentPackPreview modelId={variant.modelId} />
      </div>
      <div className="reveal__rarity">{rarity}</div>
      <div className="reveal__name">{agentName(variant.modelId)}</div>
      <div className="reveal__meta">
        <Pill tone="info">
          {CLASS_NAMES[variant.classId] ?? `Class ${variant.classId}`}
        </Pill>
        <Pill tone="neutral">#{variant.variantId}</Pill>
        <Pill tone="neutral">{variant.remaining} left</Pill>
      </div>
      <p className="pack-note">
        The draw is final. Mint this assignment to receive the permanent, tradable NFT.
      </p>
      <Button variant="play" size="giant" icon="spark" block busy={busy} onClick={onMint}>
        {busy ? "Minting agent..." : "Claim agent NFT"}
      </Button>
    </div>
  );
}

/** Deterministic development gallery for visual regression screenshots. */
export function PackRevealPreview() {
  const variant: VariantSummary = {
    address: PublicKey.default,
    variantId: 12,
    classId: 4,
    rarity: 3,
    modelId: 0,
    supplyCap: 60,
    reserved: 7,
    minted: 21,
    active: true,
    remaining: 32,
  };
  return (
    <div className="pack-preview-page">
      <div className="ds-sheet ds-sheet--gold pack-sheet">
        <div className="ds-sheet__handle" />
        <h2 className="ds-sheet__title">Agent packs</h2>
        <Reveal variant={variant} busy={false} onMint={() => undefined} />
      </div>
    </div>
  );
}
