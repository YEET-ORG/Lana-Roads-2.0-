/**
 * Paid entry: a visible state machine with an explicit review before the
 * wallet signature. Payment confirmed ≠ playing — the player is shown as
 * active only after the ER spawn confirms; failures surface the refund path.
 */
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ReceiptKind, TransactionReview } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";

type Stage =
  | {
      name: "review";
      review: TransactionReview;
      attemptNonce: number;
      receiptNonce: number;
    }
  | { name: "signing" }
  | { name: "payment-confirmed"; attemptNonce: number; receiptNonce: number }
  | { name: "spawn-pending"; attemptNonce: number; receiptNonce: number }
  | { name: "active"; attemptNonce: number; receiptNonce: number }
  | { name: "failed"; message: string; refundable: boolean }
  | { name: "loading" };

export function EntryFlow({
  boot,
  day,
  onCancel,
  onActive,
}: {
  boot: Bootstrapped;
  day: bigint;
  onCancel: () => void;
  onActive: (attemptNonce: number, receiptNonce: number) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const config = await boot.client.getConfig();
        // The wallet's canonical USDC ATA for the configured mint.
        const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const payerToken = getAssociatedTokenAddressSync(
          new PublicKey(config.usdcMint),
          boot.wallet.publicKey,
        );
        const profile = await boot.client.getProfile();
        const review = await boot.client.reviewPaidEntry({
          day,
          payerToken,
          usdcMint: new PublicKey(config.usdcMint),
          sessionAuthority: boot.session.publicKey,
          sessionExpiry: Math.floor(Date.now() / 1000) + 8 * 3600,
        });
        if (live)
          setStage({
            name: "review",
            review,
            attemptNonce: review.attemptNonce,
            receiptNonce: profile?.receiptCount ?? 0,
          });
      } catch (e) {
        if (live) setStage({ name: "failed", message: `${e}`, refundable: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [boot, day]);

  async function submit(
    review: TransactionReview,
    attemptNonce: number,
    receiptNonce: number,
  ) {
    setStage({ name: "signing" });
    try {
      await boot.client.submitReviewed(review);
      setStage({ name: "payment-confirmed", attemptNonce, receiptNonce });
      setStage({ name: "spawn-pending", attemptNonce, receiptNonce });
      await boot.client.spawn({ day, attemptNonce, receiptNonce, session: boot.session });
      // Reconcile the receipt into the prize pool (permissionless).
      boot.client
        .reconcileReceipt({
          day,
          wallet: boot.wallet.publicKey,
          kind: ReceiptKind.Entry,
          receiptNonce,
        })
        .catch(() => {});
      setStage({ name: "active", attemptNonce, receiptNonce });
      onActive(attemptNonce, receiptNonce);
    } catch (e) {
      setStage({
        name: "failed",
        message: `${e}`,
        refundable: `${e}`.includes("WorldFull") || `${e}`.includes("EntryFailed"),
      });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h2>Paid entry</h2>
        {stage.name === "loading" && <p>Preparing review…</p>}
        {stage.name === "review" && (
          <>
            <ul className="review">
              <li>
                Pay <b>1.00 USDC</b> into today's prize vault
              </li>
              <li>Winner takes 90%, team 10% — settled after the UTC cutoff</li>
              <li>Starter agent (Kick only) locked for the attempt</li>
              <li>Session key signs gameplay; it can never spend USDC or NFTs</li>
              {stage.review.warnings.map((w) => (
                <li key={w} className="warn">
                  {w}
                </li>
              ))}
            </ul>
            <div className="row">
              <button
                onClick={() =>
                  submit(stage.review, stage.attemptNonce, stage.receiptNonce)
                }
              >
                Confirm & sign
              </button>
              <button className="ghost" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}
        {stage.name === "signing" && <p>Signing & sending payment…</p>}
        {stage.name === "payment-confirmed" && <p>Payment confirmed on Solana ✓</p>}
        {stage.name === "spawn-pending" && (
          <p>Payment confirmed ✓ — reserving your spawn tile…</p>
        )}
        {stage.name === "active" && <p>You're in! ✓</p>}
        {stage.name === "failed" && (
          <>
            <p className="error">{stage.message.slice(0, 300)}</p>
            {stage.refundable && (
              <p>
                Spawning failed — your 1 USDC entry is refundable. Use the refund action
                once reconciliation confirms the failure.
              </p>
            )}
            <button className="ghost" onClick={onCancel}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
