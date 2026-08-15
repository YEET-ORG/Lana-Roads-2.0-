/**
 * Paid entry: a visible state machine with an explicit review before the
 * wallet signature. Payment confirmed ≠ playing — the player is shown as
 * active only after the ER spawn confirms; failures surface the refund path.
 */
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { pda, ReceiptKind, TransactionReview, WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import { Button, Icon, Loader, Modal, Notice, Steps } from "../../design-system";

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
      // Paid spawn is an ER write too. Resolve before taking payment so a
      // router-selected world can never be spawned on the default/wrong ER.
      if (boot.client.routerUrl) {
        const status = await boot.client.resolveErForWorld(
          pda.world(boot.client.region, WorldMode.Paid, day),
        );
        if (!status.isDelegated || !status.fqdn)
          throw new Error("paid world is not delegated to a live rollup");
      }
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

  const stepIndex =
    stage.name === "loading" || stage.name === "review"
      ? 0
      : stage.name === "signing"
        ? 1
        : stage.name === "payment-confirmed" || stage.name === "spawn-pending"
          ? 2
          : 3;

  return (
    <Modal
      title="Paid entry"
      ariaLabel="Paid entry"
      onClose={
        stage.name === "signing" || stage.name === "spawn-pending" ? undefined : onCancel
      }
    >
      {stage.name !== "failed" && (
        <div style={{ marginBottom: 12 }}>
          <Steps steps={["Review", "Sign", "Spawn", "Play"]} current={stepIndex} />
        </div>
      )}
      {stage.name === "loading" && <Loader label="Preparing review…" />}
      {stage.name === "review" && (
        <>
          <ul className="ds-review">
            <li>
              <Icon name="vault" />
              <span>
                Pay <b>1.00 USDC</b> into today's prize vault
              </span>
            </li>
            <li>
              <Icon name="percent" />
              <span>Winner takes 90%, team 10% — settled after the UTC cutoff</span>
            </li>
            <li>
              <Icon name="lock" />
              <span>Starter agent (Kick only) locked for the attempt</span>
            </li>
            <li>
              <Icon name="key" />
              <span>Session key signs gameplay; it can never spend USDC or NFTs</span>
            </li>
            {stage.review.warnings.map((w) => (
              <li key={w} className="ds-review--warn">
                <Icon name="alert" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => submit(stage.review, stage.attemptNonce, stage.receiptNonce)}
            >
              Confirm & sign
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {stage.name === "signing" && <Loader label="Signing & sending payment…" />}
      {stage.name === "payment-confirmed" && (
        <Loader label="Payment confirmed on Solana." />
      )}
      {stage.name === "spawn-pending" && (
        <Loader label="Payment confirmed — reserving your spawn tile…" />
      )}
      {stage.name === "active" && <Loader label="You're in!" />}
      {stage.name === "failed" && (
        <>
          <Notice tone="error">{stage.message.slice(0, 300)}</Notice>
          {stage.refundable && (
            <p>
              Spawning failed — your 1 USDC entry is refundable. Use the refund action
              once reconciliation confirms the failure.
            </p>
          )}
          <div className="row">
            <Button variant="ghost" onClick={onCancel}>
              Close
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
