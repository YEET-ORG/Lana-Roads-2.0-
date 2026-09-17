/** Local SBF execution; no RPC, wallets, or deployed accounts are used.
 * Run: pnpm --dir program exec tsx tests/movement-batch.ts
 * MOVEMENT_TEST_RUNTIME can select an isolated Linux Node dependency directory.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const requireRuntime = createRequire(
  process.env.MOVEMENT_TEST_RUNTIME
    ? path.join(process.env.MOVEMENT_TEST_RUNTIME, "package.json")
    : path.resolve("package.json"),
);
const { LiteSVM, FailedTransactionMetadata } = requireRuntime("litesvm");
const { getTransactionDecoder } = requireRuntime("@solana/kit");
const { Program, BN } = requireRuntime("@coral-xyz/anchor");
const { Keypair, PublicKey, Transaction } = requireRuntime("@solana/web3.js");
const idl = JSON.parse(readFileSync("target/idl/crossy_world.json", "utf8"));
const program = new Program(idl, { connection: {} });
const programId = new PublicKey(idl.address);
const le = (n: number, bytes: number) => new BN(n).toArrayLike(Buffer, "le", bytes);
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId);

// Build fully initialized test accounts from the generated IDL, so fixtures
// track layout changes without copying serialization code into the tests.
function zero(type: any): any {
  if (type === "pubkey") return PublicKey.default;
  if (type === "bool") return false;
  if (type === "u64" || type === "i64" || type === "u128") return new BN(0);
  if (typeof type === "string") return 0;
  if (type.array) return Array.from({ length: type.array[1] }, () => zero(type.array[0]));
  if (type.defined) {
    const def = program.idl.types.find((t: any) => t.name === type.defined.name).type;
    if (def.kind === "enum") return { [def.variants[0].name]: {} };
    return Object.fromEntries(def.fields.map((f: any) => [f.name, zero(f.type)]));
  }
  throw new Error(`Unhandled fixture type: ${JSON.stringify(type)}`);
}

async function fixture(
  options: {
    last?: number;
    slow?: boolean;
    blocked?: boolean;
    occupied?: boolean;
    fatal?: boolean;
    paid?: boolean;
  } = {},
) {
  const svm = new LiteSVM();
  svm.addProgramFromFile(programId.toBase58(), "target/deploy/crossy_world.so");
  const signer = Keypair.generate();
  const wallet = Keypair.generate().publicKey;
  svm.airdrop(signer.publicKey.toBase58(), 1_000_000_000n);
  const clock = svm.getClock();
  clock.slot = 100n;
  clock.unixTimestamp = 1000n;
  svm.setClock(clock);
  const [world, worldBump] = pda(
    Buffer.from("world"),
    le(0, 1),
    le(options.paid ? 0 : 1, 1),
    le(1, 8),
  );
  const [run, runBump] = pda(Buffer.from("run"), world.toBuffer(), wallet.toBuffer());
  const [best, bestBump] = pda(Buffer.from("best"), world.toBuffer(), wallet.toBuffer());
  const [sector, sectorBump] = pda(
    Buffer.from("sector"),
    world.toBuffer(),
    le(0, 1),
    le(0, 4),
  );
  const [chunk, chunkBump] = pda(Buffer.from("chunk"), le(0, 1), le(1, 8), le(0, 4));
  async function set(name: string, address: any, overrides: any) {
    const value = { ...zero({ defined: { name } }), ...overrides };
    const data = await program.coder.accounts.encode(name, value);
    svm.setAccount({
      address: address.toBase58(),
      executable: false,
      programAddress: programId.toBase58(),
      lamports: 100_000_000n,
      data,
      space: BigInt(data.length),
    });
    return value;
  }
  await set("worldHeader", world, {
    bump: worldBump,
    day: new BN(1),
    mode: options.paid ? { paid: {} } : { casual: {} },
    status: { open: {} },
    startTs: new BN(0),
    endTs: new BN(2000),
    spawnReady: true,
    revealedRows: 16,
    activePlayers: 2,
  });
  await set("playerRun", run, {
    bump: runBump,
    world,
    wallet,
    sessionAuthority: signer.publicKey,
    sessionScope: 1,
    sessionExpiry: new BN(3000),
    attemptNonce: 1,
    state: { active: {} },
    x: 1,
    y: 1,
    score: 1,
    lastMoveSlot: new BN(options.last ?? 90),
    slowedUntil: new BN(options.slow ? 1100 : 0),
  });
  await set("dailyBest", best, { bump: bestBump, world, wallet });
  await set("occupancySector", sector, {
    bump: sectorBump,
    world,
    occupancy: new BN(((1n << 9n) | (options.occupied ? 1n << 25n : 0n)).toString()),
    blockers: new BN(options.blocked ? (1n << 25n).toString() : 0),
  });
  const chunkValue = zero({ defined: { name: "chunkDefinition" } });
  // Unsupported river water is deterministically lethal, at every slot.
  if (options.fatal) chunkValue.lanes[3].kind = 2;
  await set("chunkDefinition", chunk, {
    ...chunkValue,
    bump: chunkBump,
    day: new BN(1),
    status: { revealed: {} },
    rowCount: 16,
  });
  const read = (name: string, address: any) =>
    program.coder.accounts.decode(
      name,
      Buffer.from(svm.getAccount(address.toBase58()).data),
    );
  let unique = 0;
  async function send(
    directions: number[],
    seq = 0,
    overrides: any = {},
    attempt = 1,
    legacy = false,
    signingKey = signer,
  ) {
    const builder = legacy
      ? program.methods.moveAction(attempt, new BN(seq), directions[0], new BN(++unique))
      : program.methods.moveBatch(
          attempt,
          new BN(seq),
          Buffer.from(directions),
          new BN(++unique),
        );
    const ix = await builder
      .accountsPartial({
        world,
        run,
        best,
        sourceSector: sector,
        destSector: null,
        chunk,
        signer: signingKey.publicKey,
        ...overrides,
      })
      .instruction();
    const tx = new Transaction().add(ix);
    tx.feePayer = signingKey.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(signingKey);
    return svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
  }
  return { svm, clock, signer, world, run, sector, best, chunk, set, read, send };
}
function success(result: any) {
  assert.ok(
    !(result instanceof FailedTransactionMetadata),
    result.meta?.().logs?.().join("\n"),
  );
}
function failure(result: any, code: string) {
  assert.ok(result instanceof FailedTransactionMetadata, `expected ${code}`);
  assert.match(result.meta().logs().join("\n"), new RegExp(code));
}

async function main() {
  let checks = 0;
  const f = await fixture();
  const batch = await f.send([0, 0, 0, 0]);
  success(batch);
  assert.equal(f.read("playerRun", f.run).y, 5);
  assert.equal(f.read("playerRun", f.run).actionSeq.toNumber(), 4);
  assert.equal(f.read("dailyBest", f.best).bestScore, 5);
  const sectorBytes = Buffer.from(f.svm.getAccount(f.sector.toBase58()).data);
  assert.equal(sectorBytes.readBigUInt64LE(8 + 32 + 1 + 4), 1n << 41n);
  checks++;
  const full = await fixture();
  // Eight steps inside one 8x8 sector: forward, right, forward, left, ...
  const fullBatch = await full.send([0, 3, 0, 2, 0, 3, 0, 2]);
  success(fullBatch);
  assert.equal(full.read("playerRun", full.run).x, 1);
  assert.equal(full.read("playerRun", full.run).y, 5);
  assert.equal(full.read("playerRun", full.run).actionSeq.toNumber(), 8);
  assert.equal(full.read("dailyBest", full.best).bestScore, 5);
  checks++;
  failure(await f.send([0], 0), "BadActionSequence");
  checks++;
  // A four-step batch leaves four of the eight-slot window unspent, so this
  // single move still lands on the leftover credit.
  success(await f.send([0], 4));
  assert.equal(f.read("playerRun", f.run).actionSeq.toNumber(), 5);
  assert.equal(f.read("playerRun", f.run).y, 6);
  checks++;
  for (const directions of [[], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 255]]) {
    failure(
      await f.send(directions, 4),
      directions.includes(255) ? "OutOfBounds" : "CapacityExceeded",
    );
    checks++;
  }
  failure(await f.send([0], 5, {}, 2), "BadAttemptNonce");
  checks++;
  for (const options of [{ blocked: true }, { occupied: true }, { fatal: true }]) {
    const test = await fixture(options);
    success(await test.send([0, 0, 0, 0]));
    const run = test.read("playerRun", test.run);
    assert.equal(run.actionSeq.toNumber(), 2, JSON.stringify(options));
    assert.equal(run.y, options.fatal ? 3 : 2, JSON.stringify(options));
    if (options.fatal) {
      assert.ok(run.state.ended);
      assert.equal(run.score, 2);
      assert.equal(test.read("worldHeader", test.world).activePlayers, 1);
      assert.equal(test.read("occupancySector", test.sector).occupancy.toString(), "0");
    }
    checks++;
  }
  for (const options of [{ last: 98 }, { last: 96, slow: true }, { last: 0 }]) {
    const test = await fixture(options);
    success(await test.send([0, 0, 0, 0]));
    assert.equal(
      test.read("playerRun", test.run).actionSeq.toNumber(),
      options.last === 0 ? 1 : 2,
    );
    checks++;
  }
  const boundary = await fixture();
  success(await boundary.send([3, 3, 3, 3]));
  boundary.clock.slot = 110n;
  boundary.svm.setClock(boundary.clock);
  success(await boundary.send([3, 3, 3, 3], 4));
  assert.equal(boundary.read("playerRun", boundary.run).x, 7);
  assert.equal(boundary.read("playerRun", boundary.run).actionSeq.toNumber(), 6);
  checks++;
  // A second independently signed player cannot claim the first player's tile.
  const contender = Keypair.generate();
  f.svm.airdrop(contender.publicKey.toBase58(), 1_000_000_000n);
  const [otherRun, otherBump] = pda(
    Buffer.from("run"),
    f.world.toBuffer(),
    contender.publicKey.toBuffer(),
  );
  const [otherBest, otherBestBump] = pda(
    Buffer.from("best"),
    f.world.toBuffer(),
    contender.publicKey.toBuffer(),
  );
  await f.set("playerRun", otherRun, {
    ...f.read("playerRun", f.run),
    bump: otherBump,
    wallet: contender.publicKey,
    sessionAuthority: contender.publicKey,
    x: 2,
    y: 5,
    actionSeq: new BN(0),
    lastMoveSlot: new BN(90),
  });
  await f.set("dailyBest", otherBest, {
    bump: otherBestBump,
    world: f.world,
    wallet: contender.publicKey,
  });
  await f.set("occupancySector", f.sector, {
    ...f.read("occupancySector", f.sector),
    occupancy: new BN((3n << 41n).toString()),
  });
  success(
    await f.send([2, 2], 0, { run: otherRun, best: otherBest }, 1, false, contender),
  );
  assert.equal(f.read("playerRun", otherRun).x, 2);
  assert.equal(f.read("playerRun", otherRun).actionSeq.toNumber(), 1);
  assert.equal(f.read("playerRun", f.run).x, 1);
  checks++;
  f.clock.unixTimestamp = 2000n;
  f.clock.slot = 110n;
  f.svm.setClock(f.clock);
  success(await f.send([0], 5));
  assert.equal(f.read("playerRun", f.run).y, 7, "casual remains playable at cutoff");
  const paid = await fixture({ paid: true });
  paid.clock.unixTimestamp = 2000n;
  paid.svm.setClock(paid.clock);
  failure(await paid.send([0]), "CutoffPassed");
  checks++;
  for (const [overrides, error] of [
    [{ sessionAuthority: PublicKey.default }, "BadSession"],
    [{ sessionScope: 0 }, "SessionScope"],
    [{ sessionExpiry: new BN(1000) }, "SessionExpired"],
  ] as const) {
    const test = await fixture();
    await test.set("playerRun", test.run, {
      ...test.read("playerRun", test.run),
      ...overrides,
    });
    failure(await test.send([0]), error);
    checks++;
  }
  const foreign = await fixture();
  await foreign.set("chunkDefinition", foreign.chunk, {
    ...foreign.read("chunkDefinition", foreign.chunk),
    region: 1,
  });
  failure(await foreign.send([0]), "BadChunkState");
  checks++;
  const stale = await fixture();
  await stale.set("occupancySector", stale.sector, {
    ...stale.read("occupancySector", stale.sector),
    sectorX: 1,
  });
  failure(await stale.send([0]), "WrongSector");
  checks++;
  const legacy = await fixture();
  let singleCu = 0n;
  for (let i = 0; i < 4; i++) {
    legacy.clock.slot = BigInt(100 + i);
    legacy.svm.setClock(legacy.clock);
    const result = await legacy.send([0], i, {}, 1, true);
    success(result);
    singleCu += result.computeUnitsConsumed();
  }
  assert.equal(legacy.read("playerRun", legacy.run).y, 5);
  checks++;
  console.log(
    `${checks} SBF movement checks passed; eight-move batch: ${fullBatch.computeUnitsConsumed()} CU; four-move batch: ${batch.computeUnitsConsumed()} CU; four single moves: ${singleCu} CU`,
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
