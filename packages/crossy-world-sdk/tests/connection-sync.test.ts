import { strict as assert } from "node:assert";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { CrossyClient } from "../src/client.js";
import { pda } from "../src/pda.js";
import { WorldMode } from "../src/constants.js";

function client(routerUrl?: string) {
  const payer = Keypair.generate();
  const wallet = {
    publicKey: payer.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
      if ("partialSign" in tx) tx.partialSign(payer);
      else tx.sign([payer]);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
      return Promise.all(txs.map((tx) => this.signTransaction(tx)));
    },
  };
  const connection = new Connection("http://127.0.0.1:8899");
  const erConnection = new Connection("http://127.0.0.1:7799");
  return new CrossyClient({ connection, erConnection, routerUrl, wallet });
}

describe("CrossyClient connection synchronization", () => {
  it("removes a slot listener from the connection that created it", () => {
    const c = client();
    const old = c.erConnection as any;
    let removedFromOld = 0;
    old.onSlotChange = () => 41;
    old.removeSlotChangeListener = async (id: number) => {
      assert.equal(id, 41);
      removedFromOld += 1;
    };

    const stop = c.subscribeSlot(() => {});
    c.erConnection = new Connection("http://127.0.0.1:7800");
    stop();
    stop();

    assert.equal(removedFromOld, 1);
  });

  it("closes raw realtime listeners before router retargeting", async () => {
    const c = client("https://router.invalid");
    const old = c.erConnection as any;
    let removed = 0;
    old.onSlotChange = () => 7;
    old.removeSlotChangeListener = async () => {
      removed += 1;
    };
    c.subscribeSlot(() => {});

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            isDelegated: true,
            fqdn: "https://devnet-as.magicblock.app/",
            delegationRecord: { authority: Keypair.generate().publicKey.toBase58() },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    try {
      await c.resolveErForWorld(pda.world(0, WorldMode.Casual, 1n));
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(removed, 1);
    assert.match(c.erConnection.rpcEndpoint, /devnet-as\.magicblock\.app/);
  });

  it("reads immutable map chunks from base, not the ER", async () => {
    const c = client();
    const expected = {
      day: 1n,
      chunkIndex: 2,
      rowStart: 32,
      rowCount: 16,
      status: { revealed: {} },
      lanes: [],
    };
    let baseReads = 0;
    (c.program.account.chunkDefinition as any).fetchNullable = async () => {
      baseReads += 1;
      return expected;
    };
    (c.erProgram.account.chunkDefinition as any).fetchNullable = async () => {
      throw new Error("ER chunk reader must not be used");
    };

    assert.equal(await c.getChunk(1n, 2), expected);
    assert.equal(baseReads, 1);
  });

  it("batches cold-start chunk snapshots at the RPC limit", async () => {
    const c = client();
    const batchSizes: number[] = [];
    (c.connection as any).getMultipleAccountsInfo = async (addresses: unknown[]) => {
      batchSizes.push(addresses.length);
      return addresses.map(() => null);
    };
    (c.erConnection as any).getMultipleAccountsInfo = async (addresses: unknown[]) =>
      addresses.map(() => null);

    const chunks = await c.getChunks(1n, 0, 205);

    assert.equal(chunks.length, 205);
    assert.deepEqual(batchSizes, [100, 100, 5]);
    assert.ok(chunks.every((chunk) => chunk === null));
  });

  it("uses only a bound revealed ER chunk when base is unavailable", async () => {
    const c = client();
    const revealed = {
      day: 9n,
      chunkIndex: 3,
      rowStart: 48,
      rowCount: 16,
      status: { revealed: {} },
    };
    (c.program.account.chunkDefinition as any).fetchNullable = async () => null;
    (c.erProgram.account.chunkDefinition as any).fetchNullable = async () => revealed;

    assert.equal(await c.getChunk(9n, 3), revealed);

    (c.erProgram.account.chunkDefinition as any).fetchNullable = async () => ({
      ...revealed,
      chunkIndex: 4,
    });
    assert.equal(await c.getChunk(9n, 3), null);
  });
});
