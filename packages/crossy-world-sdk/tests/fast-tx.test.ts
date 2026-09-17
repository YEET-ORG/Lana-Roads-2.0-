import { strict as assert } from "node:assert";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { signHotTransaction } from "../src/fast-tx.js";

const FIXED_BLOCKHASH = "11111111111111111111111111111111";

function multiSignerTx() {
  const payer = Keypair.generate();
  const extra = Keypair.generate();
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PublicKey.default,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: extra.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.alloc(29),
    }),
  );
  tx.recentBlockhash = FIXED_BLOCKHASH;
  tx.feePayer = payer.publicKey;
  return { payer, extra, tx };
}

function selfTransfer(payer: Keypair) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1,
    }),
  );
  tx.recentBlockhash = FIXED_BLOCKHASH;
  tx.feePayer = payer.publicKey;
  return tx;
}

describe("hot-path signing", () => {
  it("signs every local signer with a verifiable signature", () => {
    const { payer, extra, tx } = multiSignerTx();
    const raw = signHotTransaction(tx, [payer, extra]);
    const decoded = Transaction.from(raw);
    assert.equal(decoded.verifySignatures(), true);
    assert.deepEqual(
      decoded.signatures.map((s) => s.publicKey.toBase58()).sort(),
      [payer.publicKey.toBase58(), extra.publicKey.toBase58()].sort(),
    );
  });

  it("produces the same wire bytes as web3.js signing", () => {
    const payer = Keypair.generate();
    const referenceTx = selfTransfer(payer);
    referenceTx.sign(payer);
    const reference = referenceTx.serialize();
    const fast = signHotTransaction(selfTransfer(payer), [payer]);
    assert.deepEqual(Buffer.from(fast), Buffer.from(reference));
  });

  it("still fails when a required signer is missing", () => {
    const { payer, tx } = multiSignerTx();
    assert.throws(() => signHotTransaction(tx, [payer]), /signature|signed/i);
  });
});
