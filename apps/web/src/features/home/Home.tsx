/**
 * Home / mode selection, world-first: the live game world fills the screen
 * behind a Crossy-style overlay. The selected agent is the hero and casual
 * Play is the only giant CTA in this release.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { WorldMode } from "@crossy-world/sdk";
import { Bootstrapped } from "../../lib/client";
import {
  agentModelIdFor,
  agentName,
  getAgentChoice,
  setAgentChoice,
} from "../../lib/agent";
import { agentId, AGENT_COUNT } from "../../game/renderer/assets";
import { sfx } from "../../game/audio";
import { WorldScene } from "../../game/renderer/scene";
import { LeaderboardSheet } from "../leaderboard/LeaderboardSheet";
import { MenuBackdrop } from "./MenuBackdrop";
import { Button, Icon, IconButton, Modal, Notice } from "../../design-system";
import type { Route } from "../../app/App";

interface DayInfo {
  day: bigint;
  /** The casual world exists on the rollup, so free play can start. */
  casualReady: boolean;
}

function agentIndexFromModelId(id: string): number {
  return Number(id.slice(-2));
}

/**
 * A publishable name for a player who has not chosen one.
 *
 * `set_identity` carries both the name and the agent, and the program will
 * not accept a name shorter than two characters — so without something here,
 * an unnamed player could never publish which animal they are. The address
 * prefix is recognisable, valid under the program's character rules, and
 * obviously a placeholder to replace.
 */
function fallbackName(wallet: { toBase58(): string }): string {
  return wallet.toBase58().slice(0, 6);
}

/** Live-world telemetry shown before the player commits to a run. */
interface Presence {
  players: number;
  pingMs: number | null;
}

function pingTone(ms: number | null): "good" | "fair" | "poor" {
  if (ms == null) return "poor";
  return ms < 120 ? "good" : ms < 300 ? "fair" : "poor";
}

export function Home({
  boot,
  onPlay,
}: {
  boot: Bootstrapped | null;
  onPlay: (r: Route) => void;
}) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const wallet = boot?.wallet.publicKey.toBase58() ?? "offline";
  const [agentIdx, setAgentIdx] = useState(
    () => getAgentChoice() ?? agentIndexFromModelId(agentModelIdFor(wallet)),
  );
  /** This wallet's on-chain identity: what everyone else sees. */
  const [myName, setMyName] = useState<string | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const menuSceneRef = useRef<WorldScene | null>(null);
  const swipeRef = useRef<{ x: number; t: number } | null>(null);
  const agentSaveRef = useRef(0);
  /**
   * The agent currently published on chain, or null if nothing is.
   *
   * Kept so joining only writes when the published choice actually differs
   * from the local one — publishing on every PLAY would be a transaction per
   * game for no change.
   */
  const chainAgentRef = useRef<number | null>(null);

  useEffect(() => {
    if (!boot) {
      setWarn("Cluster offline — practice is still open.");
      setInfo({
        day: 0n,
        casualReady: false,
      });
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const day = await boot.client.getCurrentDay();
        const casual = await boot.client
          .getWorld(WorldMode.Casual, day)
          .catch(() => null);
        if (!live) return;
        if (!casual) {
          setWarn(`Today's casual world (day ${day}) is not live yet.`);
          setInfo({ day, casualReady: false });
          return false;
        }
        setWarn(null);
        setInfo({ day, casualReady: true });
        return true;
      } catch {
        if (live) setWarn("Can't reach the casual world — practice is still open.");
        return false;
      }
    };

    // Public devnet RPC throttles, and one refused call here is the whole
    // difference between the real world and offline practice — the Play
    // button reads this state. Keep asking until the world answers.
    let timer = 0;
    const attempt = async () => {
      const ready = await load();
      if (!live || ready) return;
      timer = window.setTimeout(() => void attempt(), 6000);
    };
    void attempt();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [boot]);

  // Live presence: how busy the casual world is and how far away its rollup is.
  useEffect(() => {
    if (!boot || !info || info.day === 0n) return;
    let live = true;
    const ping = async () => {
      // Timed on its own: a round-trip measured across a batch would report
      // the slowest call in the batch, not the latency of the link.
      const t0 = performance.now();
      const slot = await boot.client.erConnection.getSlot("processed").catch(() => null);
      return slot == null ? null : Math.round(performance.now() - t0);
    };
    const poll = async () => {
      const [casual, pingMs] = await Promise.all([
        boot.client.getWorld(WorldMode.Casual, info.day).catch(() => null),
        ping(),
      ]);
      if (!live) return;
      setPresence({ players: casual?.activePlayers ?? 0, pingMs });
    };
    void poll();
    const id = setInterval(() => void poll(), 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [boot, info]);

  // Load the identity once; it is what other players draw and label us by.
  useEffect(() => {
    if (!boot) return;
    let live = true;
    boot.client
      .getIdentity()
      .then((id) => {
        if (!live || !id) return;
        setMyName(id.name);
        setAgentIdx(id.agent);
        setAgentChoice(id.agent);
        chainAgentRef.current = id.agent;
        menuSceneRef.current?.setLocalModel(agentId(id.agent));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [boot]);

  function cycleAgent(delta: number) {
    const next = (((agentIdx + delta) % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT;
    setAgentIdx(next);
    setAgentChoice(next);
    menuSceneRef.current?.setLocalModel(agentId(next));
    sfx.hop();
    // A choice kept in this browser is a choice nobody else can see. Publish
    // it — debounced, because the picker is a thing you flick through.
    //
    // This used to bail when the player had no name yet, which meant the
    // agent was published only by people who had already named themselves.
    // Everyone else picked an animal that existed nowhere but their own
    // screen, and other clients fell back to hashing their wallet — the
    // "I chose a fox and my friend sees a duck" bug. The program requires a
    // name of at least two characters, so unnamed players get a placeholder
    // from their address until they choose one.
    if (!boot) return;
    window.clearTimeout(agentSaveRef.current);
    agentSaveRef.current = window.setTimeout(() => {
      void boot.client
        .setIdentity({ name: myName ?? fallbackName(boot.wallet.publicKey), agent: next })
        .then(() => {
          chainAgentRef.current = next;
        })
        .catch(() => {});
    }, 1200);
  }

  async function saveIdentity() {
    if (!boot) return;
    setSaving(true);
    setNameError(null);
    try {
      await boot.client.setIdentity({ name: nameDraft.trim(), agent: agentIdx });
      chainAgentRef.current = agentIdx;
      setMyName(nameDraft.trim());
      setNameOpen(false);
      sfx.confirm();
    } catch (e) {
      // The program is the authority on what a name may be; show what it said.
      const why = `${(e as { message?: string }).message ?? e}`;
      setNameError(
        /InvalidName/.test(why)
          ? "2-20 characters: letters, numbers, space, . _ - '"
          : why.slice(0, 120),
      );
    } finally {
      setSaving(false);
    }
  }

  function onSwipeStart(e: PointerEvent) {
    swipeRef.current = { x: e.clientX, t: performance.now() };
  }
  function onSwipeEnd(e: PointerEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 40) return;
    cycleAgent(dx < 0 ? 1 : -1);
  }

  return (
    <div className="world-home">
      <MenuBackdrop
        modelId={agentId(agentIdx)}
        onScene={(s) => (menuSceneRef.current = s)}
      />
      <div className="home-overlay">
        {warn && (
          <div className="notice-float">
            <Notice>{warn}</Notice>
          </div>
        )}

        {presence && (
          <div className="home-live">
            <span className="live-chip" title="players in a live run right now">
              <Icon name="users" size={13} />
              {presence.players} online
            </span>
            <span
              className={`live-chip live-chip--${pingTone(presence.pingMs)}`}
              title="round-trip to the ephemeral rollup"
            >
              <Icon name="signal" size={13} />
              {presence.pingMs == null ? "offline" : `${presence.pingMs} ms`}
            </span>
          </div>
        )}

        <div className="home-spacer" />

        <div
          className="agent-hero"
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => {
            swipeRef.current = null;
          }}
        >
          <IconButton
            icon="chevron-left"
            label="previous agent"
            variant="sun"
            size="lg"
            onClick={() => cycleAgent(-1)}
          />
          <div className="agent-nameplate">
            <span className="agent-name" key={agentIdx}>
              {agentName(agentIdx)}
            </span>
            {boot ? (
              <button
                className="agent-sub agent-sub--button"
                onClick={() => {
                  sfx.click();
                  setNameDraft(myName ?? "");
                  setNameOpen(true);
                }}
              >
                <Icon name="user" size={11} style={{ verticalAlign: "-1px" }} />{" "}
                {myName ? myName : "set your name"}
              </button>
            ) : (
              <span className="agent-sub">
                <Icon name="paw" size={11} style={{ verticalAlign: "-1px" }} /> swipe or
                tap to switch
              </span>
            )}
          </div>
          <IconButton
            icon="chevron-right"
            label="next agent"
            variant="sun"
            size="lg"
            onClick={() => cycleAgent(1)}
          />
        </div>

        <div className="home-cta">
          <Button
            variant="play"
            size="giant"
            icon="play"
            onClick={() => {
              // Free play needs exactly one thing: a live casual world.
              if (!boot || !info || !info.casualReady) {
                onPlay({ name: "demo" });
                return;
              }
              // Nobody else can see an agent that was only ever chosen in
              // this browser. A player who never opened the picker has
              // published nothing, so every other client falls back to
              // hashing their wallet and draws a different animal than the
              // one on their own screen. Publishing on the way in is the
              // last point where that can still be fixed silently.
              if (chainAgentRef.current !== agentIdx) {
                chainAgentRef.current = agentIdx;
                void boot.client
                  .setIdentity({
                    name: myName ?? fallbackName(boot.wallet.publicKey),
                    agent: agentIdx,
                  })
                  .catch(() => {
                    // Let the next join try again rather than pretending it
                    // landed; an unpublished agent is the whole bug.
                    chainAgentRef.current = null;
                  });
              }
              onPlay({
                name: "play",
                mode: WorldMode.Casual,
                day: info.day,
                attemptNonce: 0,
                receiptNonce: 0,
              });
            }}
          >
            PLAY
          </Button>
          <div className="home-links">
            <Button variant="link" icon="target" onClick={() => onPlay({ name: "demo" })}>
              Practice offline
            </Button>
            {boot && info && info.day !== 0n && (
              <Button
                variant="link"
                icon="trophy"
                onClick={() => {
                  sfx.click();
                  setBoardOpen(true);
                }}
              >
                Standings
              </Button>
            )}
          </div>
        </div>
      </div>

      {nameOpen && boot && (
        <Modal
          title="Your name"
          ariaLabel="Set your name"
          onClose={() => setNameOpen(false)}
        >
          <p className="ds-dim">
            Shown on the leaderboard and over your head in the world. Everyone sees it, so
            the program checks it: 2-20 characters, letters, numbers, space and{" "}
            <code>. _ - '</code>
          </p>
          <input
            className="name-input"
            value={nameDraft}
            maxLength={20}
            autoFocus
            placeholder="e.g. Lana"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameDraft.trim().length >= 2) void saveIdentity();
            }}
          />
          {nameError && <Notice tone="error">{nameError}</Notice>}
          <div className="row">
            <Button
              variant="primary"
              busy={saving}
              disabled={nameDraft.trim().length < 2}
              onClick={saveIdentity}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setNameOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {boardOpen && boot && info && (
        <LeaderboardSheet
          boot={boot}
          day={info.day}
          onClose={() => setBoardOpen(false)}
        />
      )}
    </div>
  );
}
