import { strict as assert } from "node:assert";
import { Direction, WorldMode } from "../src/constants.js";
import { selectMoveBatch, moveDestination, MAX_MOVE_BATCH } from "../src/movement.js";
import { CrossyClient } from "../src/client.js";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

function moves(count: number, x = 1, y = 1, direction = Direction.Forward) {
  return Array.from({ length: count }, (_, i) => {
    const move = { kind: "move", x, y, direction, seq: i, attempt: 1 };
    ({ x, y } = moveDestination(x, y, direction));
    return move;
  });
}

describe("bounded movement batches", () => {
  it("caps batching and splits at all sector boundaries", () => {
    assert.equal(selectMoveBatch(moves(6)).length, MAX_MOVE_BATCH);
    assert.equal(selectMoveBatch(moves(4, 1, 6)).length, 1);
    assert.equal(selectMoveBatch(moves(4, 1, 14)).length, 1);
    assert.equal(selectMoveBatch(moves(4, 6, 1, Direction.Right)).length, 1);
    assert.equal(selectMoveBatch(moves(4, 1, 1, Direction.Left)).length, 1);
    assert.equal(selectMoveBatch(moves(1, 63, 1, Direction.Right)).length, 0);
  });

  it("never batches across combat, retries, sequence gaps or attempt changes", () => {
    for (const change of [
      { kind: "kick" },
      { sent: true },
      { seq: 9 },
      { attempt: 2 },
      { x: 7 },
    ]) {
      const queue = moves(4);
      Object.assign(queue[1], change);
      assert.equal(selectMoveBatch(queue).length, 1);
    }
    const queue = moves(4);
    Object.assign(queue[1], { blocked: true });
    assert.equal(selectMoveBatch(queue).length, 2);
  });

  it("builds one signed, bounded transaction using generated instruction encoding", async () => {
    const session = Keypair.generate();
    const connection = new Connection("http://127.0.0.1:8899");
    const wallet = {
      publicKey: session.publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };
    const client = new CrossyClient({ connection, wallet });
    let sent = 0;
    (client.erConnection as any).getLatestBlockhash = async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
    });
    (client.erConnection as any).sendRawTransaction = async (
      raw: Buffer,
      options: any,
    ) => {
      const tx = Transaction.from(raw);
      assert.equal(tx.instructions.length, 1);
      assert.equal(tx.verifySignatures(), true);
      assert.ok(raw.length <= 1232);
      assert.equal(options.maxRetries, 0);
      const decoded = client.erProgram.coder.instruction.decode(tx.instructions[0].data)!;
      assert.equal(decoded.name, "moveBatch");
      assert.deepEqual([...(decoded.data as any).directions], [0, 0, 0, 0]);
      sent++;
      return "test-signature";
    };
    const params = {
      day: 1n,
      mode: WorldMode.Casual,
      session,
      x: 1,
      y: 1,
      attemptNonce: 1,
      actionSeq: 0,
    };
    await client.sendMoveBatch({ ...params, directions: [0, 0, 0, 0] });
    await assert.rejects(client.sendMoveBatch({ ...params, directions: [] }), /1–4/);
    await assert.rejects(
      client.sendMoveBatch({ ...params, directions: [0, 0, 0, 0, 0] }),
      /1–4/,
    );
    await assert.rejects(
      client.sendMoveBatch({ ...params, y: 7, directions: [0] }),
      /sector/,
    );
    assert.equal(sent, 1);
  });
});
