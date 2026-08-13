/**
 * Point `config.vrf_authority` at a key the operator actually holds, so the
 * frontier keeper can publish authenticated chunk randomness. Revealed
 * chunks are immutable, so rotating never rewrites existing map.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROGRAM_ID = new web3.PublicKey("GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX");
const RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";

const admin = web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      readFileSync(
        process.env.ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
        "utf8",
      ),
    ),
  ),
);
const target = process.env.VRF_AUTHORITY
  ? new web3.PublicKey(process.env.VRF_AUTHORITY)
  : admin.publicKey;

async function main() {
  const conn = new web3.Connection(RPC, "confirmed");
  const idl = JSON.parse(
    readFileSync(resolve(__dirname, "../target/idl/crossy_world.json"), "utf8"),
  );
  const program = new Program(
    idl,
    new anchor.AnchorProvider(conn, new anchor.Wallet(admin), {
      commitment: "confirmed",
    }),
  ) as Program<any>;

  const [config] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID,
  );
  const before = await program.account.globalConfig.fetch(config);
  console.log("before:", before.vrfAuthority.toBase58());
  if (before.vrfAuthority.equals(target)) {
    console.log("already set; nothing to do");
  } else {
    const sig = await program.methods
      .setVrfAuthority(target)
      .accountsPartial({ config, admin: admin.publicKey })
      .rpc();
    const after = await program.account.globalConfig.fetch(config);
    console.log("after: ", after.vrfAuthority.toBase58(), sig.slice(0, 8));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
