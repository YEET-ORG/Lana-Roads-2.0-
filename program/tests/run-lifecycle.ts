/**
 * Standalone runner for crossy-lifecycle.ts.
 *
 * litesvm's native teardown aborts under mocha's lifecycle (std::bad_alloc
 * in the finalizer); a linear runner with a hard process.exit sidesteps it.
 * Provides describe/it/before shims, executes sequentially, prints a
 * mocha-style summary.
 */
type Fn = () => void | Promise<void>;
interface Case {
  name: string;
  fn: Fn;
}

const cases: Case[] = [];
const befores: Fn[] = [];
let suiteName = "";

(globalThis as any).describe = (name: string, body: () => void) => {
  suiteName = name;
  body();
};
(globalThis as any).before = (fn: Fn) => befores.push(fn);
(globalThis as any).it = (name: string, fn: Fn) => cases.push({ name, fn });

// Minimal mocha `this` support (this.timeout()).
const ctx = { timeout: (_ms: number) => {} };

async function main() {
  await import("./crossy-lifecycle");
  console.log(`\n  ${suiteName}`);
  let passed = 0;
  let failed = 0;
  for (const b of befores) await b.call(ctx);
  for (const c of cases) {
    const started = Date.now();
    try {
      await c.fn.call(ctx);
      passed++;
      console.log(`    ✔ ${c.name} (${Date.now() - started}ms)`);
    } catch (e) {
      failed++;
      console.log(`    ✖ ${c.name}`);
      console.log(`      ${`${e}`.split("\n").slice(0, 6).join("\n      ")}`);
    }
  }
  console.log(`\n  ${passed} passing`);
  if (failed) console.log(`  ${failed} failing`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
