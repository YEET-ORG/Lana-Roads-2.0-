/**
 * Packs: buy one, watch it open, mint what it gave you.
 *
 * The sequence is not cosmetic — it is what the program actually does, and
 * the screen says so at each step. You pay; the odds are snapshotted at
 * that moment; the VRF authority assigns a rarity and a variant from the
 * season's remaining inventory; only then does an asset get minted to you.
 * Nothing here decides the outcome, and the wait between paying and
 * knowing is real, so it is dressed rather than hidden.
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

const SEASON = Number(import.meta.env.VITE_SEASON ?? 1);
const TIER = 0;

const RARITY = ["common", "rare", "epic", "legendary"] as const;
type Rarity = (typeof RARITY)[number];

/** How often to ask whether the pack has been assigned yet. */
const POLL_MS = 1500;

type Stage =
  | { name: "shop" }
  | { name: "paying" }
  | { name: "opening"; pullNonce: number }
  | { name: "revealed"; pull: PullSummary; variant: VariantSummary }
  | { name: "minting"; pull: PullSummary; variant: VariantSummary }
  | { name: "minted"; variant: VariantSummary; asset: string }
  | { name: "refundable"; pullNonce: number };

function usdc(v: bigint | number): string {
  return `${(Number(v) / 1e6).toFixed(2)} USDC`;
}

export function PackSheet({
  boot,
  onAgentRevealed,
  onClose,
}: {
  boot: Bootstrapped;
  /** Show the pulled agent in the world behind the sheet. */
  onAgentRevealed?: (modelId: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "shop" });
  const [banner, setBanner] = useState<{ price: bigint; weights: number[] } | null>(null);
  const [variants, setVariants] = useState<VariantSummary[] | null>(null);
  const [pulls, setPulls] = useState<PullSummary[] | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<PublicKey | null>(null);

  // Everything the shop needs: price, odds, what is left, what you own.
  const load = useCallback(async () => {
    try {
      const [b, v, p, config] = await Promise.all([
        boot.client.getBanner(SEASON, TIER),
        boot.client.listVariants(SEASON),
        boot.client.listPulls(),
        boot.client.getConfig(),
      ]);
      if (b)
        setBanner({
          price: BigInt(b.price.toString()),
          weights: [...(b.baseWeights as number[])],
        });
      setVariants(v);
      setPulls(p);
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
    } catch (e) {
      setError(`${e}`.slice(0, 140));
    }
  }, [boot]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a pack is open, watch the pull account for the assignment.
  useEffect(() => {
    if (stage.name !== "opening") return;
    let live = true;
    const tick = async () => {
      const pull = await boot.client
        .getPull(boot.wallet.publicKey, stage.pullNonce)
        .catch(() => null);
      if (!live || !pull) return;
      const state = Object.keys(pull.state)[0];
      if (state === "refundable") {
        setStage({ name: "refundable", pullNonce: stage.pullNonce });
        return;
      }
      if (state !== "assigned" && state !== "claimed") return;
      const list = variants ?? (await boot.client.listVariants(SEASON));
      const variant = list.find((v) => v.variantId === pull.assignedVariant);
      if (!variant || !live) return;
      const summary: PullSummary = {
        address: boot.client.program.programId, // unused in this view
        pullNonce: stage.pullNonce,
        season: pull.season,
        tier: pull.tier,
        price: BigInt(pull.price.toString()),
        state: state as PullSummary["state"],
        assignedRarity: pull.assignedRarity,
        assignedVariant: pull.assignedVariant,
        mintedAsset: pull.mintedAsset,
        requestedAt: Number(pull.requestedAt.toString()),
      };
      onAgentRevealed?.(agentId(variant.modelId));
      if (variant.rarity >= 2) sfx.fanfare();
      else sfx.confirm();
      setStage({ name: "revealed", pull: summary, variant });
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.name, (stage as { pullNonce?: number }).pullNonce]);

  async function buy() {
    if (!tokenRef.current) return;
    setError(null);
    setStage({ name: "paying" });
    sfx.click();
    try {
      const review = await boot.client.reviewPull({
        seasonIndex: SEASON,
        tier: TIER,
        payerToken: tokenRef.current,
      });
      await boot.client.submitReviewed(review);
      setStage({ name: "opening", pullNonce: review.pullNonce });
    } catch (e) {
      const why = `${(e as { message?: string }).message ?? e}`;
      setError(
        /insufficient|0x1$/i.test(why)
          ? "Not enough USDC for a pack."
          : why.slice(0, 140),
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
      setError(`${(e as { message?: string }).message ?? e}`.slice(0, 140));
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
      setError(`${(e as { message?: string }).message ?? e}`.slice(0, 140));
    }
  }

  const left = (rarity: number) =>
    (variants ?? [])
      .filter((v) => v.rarity === rarity && v.active)
      .reduce((n, v) => n + v.remaining, 0);

  return (
    <Sheet title="Packs" ariaLabel="Agent packs" tone="gold" onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}

      {stage.name === "shop" && (
        <>
          <div className="pack-hero">
            <div
              className="pack-box"
              onClick={buy}
              role="button"
              aria-label="open a pack"
            >
              <span className="pack-box__lid" />
              <span className="pack-box__glow" />
              <Icon name="spark" size={30} />
            </div>
            <div className="pack-price">
              {banner ? usdc(banner.price) : "…"}
              <small>
                {balance == null ? "checking balance…" : `you hold ${usdc(balance)}`}
              </small>
            </div>
          </div>

          <h3 className="setting-group">Odds this season</h3>
          <div className="odds">
            {RARITY.map((r, i) => (
              <div key={r} className={`odds__row odds__row--${r}`}>
                <span className="odds__name">{r}</span>
                <span className="odds__bar">
                  <span style={{ width: `${banner?.weights[i] ?? 0}%` }} />
                </span>
                <span className="odds__pct">{banner?.weights[i] ?? 0}%</span>
                <span className="odds__left">{left(i)} left</span>
              </div>
            ))}
          </div>
          <p className="ds-dim pack-note">
            The odds are snapshotted when you pay, so a pack cannot get worse while it is
            being opened. If the rarity it lands on has sold out, the pack becomes
            refundable rather than dropping you to a lower one.
          </p>

          <div className="row">
            <Button
              variant="play"
              icon="spark"
              disabled={!banner || (balance != null && banner && balance < banner.price)}
              onClick={buy}
            >
              Open a pack
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>

          {pulls != null && pulls.length > 0 && (
            <>
              <h3 className="setting-group">Your packs</h3>
              <ul className="pack-history">
                {pulls.slice(0, 6).map((p) => {
                  const v = (variants ?? []).find(
                    (x) => x.variantId === p.assignedVariant,
                  );
                  return (
                    <li key={p.pullNonce} className="pack-history__row">
                      <span
                        className={`rarity-dot rarity-dot--${RARITY[p.assignedRarity] ?? "common"}`}
                      />
                      <span className="pack-history__name">
                        {v ? agentName(v.modelId) : "unopened"}
                      </span>
                      <span className="pack-history__state">{p.state}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {(stage.name === "paying" || stage.name === "opening") && (
        <div className="pack-opening">
          <div className={`pack-box pack-box--shaking`}>
            <span className="pack-box__lid" />
            <span className="pack-box__glow" />
            <Icon name="spark" size={30} />
          </div>
          <Loader
            label={
              stage.name === "paying" ? "paying…" : "the chain is picking your agent…"
            }
          />
          <p className="ds-dim pack-note">
            Your payment is in. The outcome is being drawn against the odds you just
            bought — this is the part nobody, including us, can hurry.
          </p>
        </div>
      )}

      {(stage.name === "revealed" || stage.name === "minting") && (
        <Reveal variant={stage.variant} busy={stage.name === "minting"} onMint={mint} />
      )}

      {stage.name === "minted" && (
        <div className={`reveal reveal--${RARITY[stage.variant.rarity]}`}>
          <Confetti />
          <div className="reveal__rarity">{RARITY[stage.variant.rarity]}</div>
          <div className="reveal__name">{agentName(stage.variant.modelId)}</div>
          <div className="reveal__meta">minted to your wallet</div>
          <code className="reveal__asset">{stage.asset.slice(0, 16)}…</code>
          <div className="row">
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
        <>
          <Notice tone="warn">
            The rarity this pack landed on sold out while it was being opened. The program
            marked it refundable rather than giving you something worse.
          </Notice>
          <div className="row">
            <Button variant="primary" icon="coin" onClick={refund}>
              Refund my USDC
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
          </div>
        </>
      )}
    </Sheet>
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
      {variant.rarity >= 2 && <Confetti />}
      <div className="reveal__burst" />
      <div className="reveal__rarity">{rarity}</div>
      <div className="reveal__name">{agentName(variant.modelId)}</div>
      <div className="reveal__meta">
        <Pill tone="info">class {variant.classId}</Pill>
        <Pill tone="neutral">
          {variant.minted + variant.reserved} of {variant.supplyCap} claimed
        </Pill>
      </div>
      <p className="ds-dim pack-note">
        It is yours the moment it is minted — a Metaplex Core asset in your wallet, not a
        row in our database.
      </p>
      <div className="row">
        <Button variant="play" icon="spark" busy={busy} onClick={onMint}>
          {busy ? "Minting…" : "Mint it"}
        </Button>
      </div>
    </div>
  );
}
