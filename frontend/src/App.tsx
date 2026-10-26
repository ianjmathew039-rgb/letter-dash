import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import "./index.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const socket = io(SERVER_URL, { autoConnect: false });
const COLS = 8;
const ROWS = 6;
const LETTER_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 26];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Letter = { letter: string; x: number; y: number; collected?: boolean };
type Player = { id: string; name: string; role: string };
type GameState = {
  code: string;
  status: string;
  players: Player[];
  round: number;
  letterCount: number;
  phase: string;
  spawnerId: string | null;
  catcherId: string | null;
  letters: Letter[];
  nextLetter: string | null;
  catcherPosition: { x: number; y: number };
  scores: Record<string, number>;
  combo: number;
  timeLeft: number;
  message: string;
  lastEvent: string | null;
  replayVotes?: string[];
};
type SocketResult = { ok?: boolean; code?: string; error?: string; reconnected?: boolean };

function App() {
  const [name, setName] = useState(() => sessionStorage.getItem("letterDashName") || "");
  const [roomCode, setRoomCode] = useState(() => sessionStorage.getItem("letterDashRoomCode") || "");
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const me = game?.players.find((player) => player.id === socket.id);
  const isHost = game?.players[0]?.id === socket.id;
  const isSpawner = game?.spawnerId === socket.id;
  const isCatcher = game?.catcherId === socket.id;
  const isLobby = game?.phase === "waiting";
  const isFinished = game?.phase === "finished";
  const hasVotedReplay = Boolean(game?.replayVotes?.includes(socket.id));

  const occupied = useMemo(
    () => new Map((game?.letters || []).map((letter) => [`${letter.x},${letter.y}`, letter] as [string, Letter])),
    [game?.letters],
  );

  const handleKey = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable) return;
    const keys: Record<string, [number, number]> = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    };
    const direction = keys[event.key];
    if (!direction || !game || !["placing", "playing"].includes(game.phase) || game.catcherId !== socket.id) return;
    event.preventDefault();
    socket.emit("move", { dx: direction[0], dy: direction[1] });
  }, [game]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setError("");
      const savedName = sessionStorage.getItem("letterDashName");
      const savedCode = sessionStorage.getItem("letterDashRoomCode");
      if (!savedName || !savedCode) return;
      socket.emit("joinRoom", { name: savedName, code: savedCode }, (result: SocketResult) => {
        if (result?.error) setError(result.error);
        if (result?.code) setRoomCode(result.code);
      });
    };
    const onDisconnect = () => setConnected(false);
    const onGameState = (state: GameState) => {
      setGame(state);
      setRoomCode(state.code);
      sessionStorage.setItem("letterDashRoomCode", state.code);
      setBusy(false);
    };
    const onRoomClosed = (data: { message: string }) => {
      setGame(null);
      setBusy(false);
      setError(data.message);
      sessionStorage.removeItem("letterDashRoomCode");
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("gameState", onGameState);
    socket.on("roomClosed", onRoomClosed);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("gameState", onGameState);
      socket.off("roomClosed", onRoomClosed);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  function createRoom() {
    if (!name.trim()) return setError("Enter your player name first.");
    if (!connected) return setError("Waiting for the server connection.");
    setError(""); setBusy(true);
    const cleanName = name.trim().slice(0, 16);
    sessionStorage.setItem("letterDashName", cleanName);
    socket.emit("createRoom", { name: cleanName }, (result: SocketResult) => {
      setBusy(false);
      if (result?.error) setError(result.error);
      if (result?.code) { setRoomCode(result.code); sessionStorage.setItem("letterDashRoomCode", result.code); }
    });
  }

  function joinRoom() {
    if (!name.trim()) return setError("Enter your player name first.");
    if (roomCode.trim().length !== 5) return setError("Room codes contain five characters.");
    if (!connected) return setError("Waiting for the server connection.");
    setError(""); setBusy(true);
    const cleanName = name.trim().slice(0, 16);
    sessionStorage.setItem("letterDashName", cleanName);
    socket.emit("joinRoom", { name: cleanName, code: roomCode.trim().toUpperCase() }, (result: SocketResult) => {
      setBusy(false);
      if (result?.error) setError(result.error);
      if (result?.code) { setRoomCode(result.code); sessionStorage.setItem("letterDashRoomCode", result.code); }
    });
  }

  function startGame() {
    setError("");
    socket.emit("startGame", (result: SocketResult) => { if (result?.error) setError(result.error); });
  }

  function changeLetterCount(count: number) {
    setError("");
    socket.emit("setLetterCount", { count }, (result: SocketResult) => { if (result?.error) setError(result.error); });
  }

  function placeLetter(x: number, y: number) {
    if (game?.phase !== "placing" || game.spawnerId !== socket.id) return;
    socket.emit("placeLetter", { x, y }, (result: SocketResult) => {
      if (result?.error) setError(result.error); else setError("");
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(game?.code || roomCode);
      setCopied(true); setError("");
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setError("Copy failed. You can copy the room code manually."); }
  }

  function replay() {
    setError("");
    socket.emit("replay", (result: SocketResult) => { if (result?.error) setError(result.error); });
  }

  function leaveRoom() {
    sessionStorage.removeItem("letterDashName");
    sessionStorage.removeItem("letterDashRoomCode");
    socket.disconnect();
    setGame(null); setRoomCode(""); setError(""); setName("");
    socket.connect();
  }

  const playerA = game?.players[0];
  const playerB = game?.players[1];
  const scoreA = playerA ? game?.scores[playerA.id] || 0 : 0;
  const scoreB = playerB ? game?.scores[playerB.id] || 0 : 0;
  const winner = isFinished && playerA && playerB
    ? scoreA === scoreB ? "DRAW GAME" : scoreA > scoreB ? `${playerA.name} WINS` : `${playerB.name} WINS`
    : "";

  return (
    <main className={`app-shell ${game && !isLobby ? "match-shell" : ""}`}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Letter Dash home">
          <span className="brand-mark">LD</span><span>LETTER<span className="brand-accent">DASH</span></span>
        </a>
        <div className="topbar-right">
          {game && <div className="room-chip"><span>ROOM</span><strong>{game.code}</strong><button onClick={copyCode} aria-label="Copy room code">{copied ? "COPIED" : "COPY ↗"}</button></div>}
          <div className="connection"><span className={`status-dot ${connected ? "online" : ""}`} />{connected ? "SERVER ONLINE" : "CONNECTING"}</div>
        </div>
      </header>

      {!game ? (
        <section className="landing-layout">
          <div className="landing-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> REAL-TIME · TWO-PLAYER ARENA</div>
            <h1>MAKE<br />SOME <span className="gradient-text">CHAOS.</span></h1>
            <p>One scatters the alphabet. One hunts it down.<br className="desktop-break" /> Quick hands win. Panic is optional.</p>
            <div className="landing-pills"><span><i /> LIVE MULTIPLAYER</span><span>01 — 26 LETTERS</span><span>ROUND-BASED DUELS</span></div>
            <div className="landing-art" aria-hidden="true"><span className="art-letter letter-a">A</span><span className="art-letter letter-m">M</span><span className="art-letter letter-z">Z</span><span className="art-cross">✳</span><span className="art-orbit" /></div>
          </div>
          <section className="lobby-card">
            <div className="card-kicker"><span className="kicker-icon">✳</span> PLAYER TERMINAL <span className="kicker-line" /></div>
            <h2>ENTER THE<br /><span>ARENA.</span></h2>
            <label htmlFor="player-name">YOUR CALLSIGN</label>
            <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={16} placeholder="e.g. ALPHA" autoComplete="nickname" />
            <button className="button button-primary" onClick={createRoom} disabled={busy || !connected}>{busy ? <><span className="button-spinner" /> CREATING ROOM</> : <>CREATE A ROOM <span>↗</span></>}</button>
            <div className="split-label"><span /> OR JOIN A FRIEND <span /></div>
            <div className="join-row"><input aria-label="Room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="ROOM CODE" maxLength={5} /><button className="button button-secondary" onClick={joinRoom} disabled={busy || !connected}>JOIN <span>→</span></button></div>
            {error && <p className="error-message" role="alert">{error}</p>}
            <div className="lobby-foot"><span className={`status-dot ${connected ? "online" : ""}`} /> {connected ? "CONNECTION SECURE" : "CONNECTING TO SERVER…"}<span>V. 2.0</span></div>
          </section>
        </section>
      ) : isLobby ? (
        <section className="waiting-layout">
          <div className="waiting-main">
            <div className="eyebrow"><span className="eyebrow-line" /> PRE-MATCH LOBBY</div>
            <h1>YOUR ARENA.<br /><span className="gradient-text">YOUR RULES.</span></h1>
            <p className="section-copy">Invite your rival, lock in the alphabet size, then let the chaos begin.</p>
            <div className="room-share-card"><div><span className="field-label">YOUR ROOM CODE</span><strong className="large-room-code">{game.code}</strong></div><button className="button button-secondary" onClick={copyCode}>{copied ? "COPIED ✓" : "COPY CODE ↗"}</button></div>
            <div className="players-lobby-grid">
              {[game.players[0], game.players[1]].map((player, index) => (
                <div className={`lobby-player ${player ? "player-present" : "player-empty"}`} key={player?.id || `empty-${index}`}>
                  <div className="avatar-block">{player ? player.name.slice(0, 1).toUpperCase() : <span>＋</span>}</div>
                  <div className="lobby-player-info"><span className="field-label">{index === 0 ? "PLAYER 01 · HOST" : "PLAYER 02 · CHALLENGER"}</span><strong>{player?.name || "Waiting for rival"}</strong><span className="player-presence">{player ? player.id === socket.id ? "● YOU · CONNECTED" : "● CONNECTED" : "○ SHARE CODE TO INVITE"}</span></div>
                </div>
              ))}
            </div>
            {isHost && <div className="settings-card"><div><span className="field-label">MATCH CONFIGURATION</span><strong>Alphabet size</strong><p>More letters. More pressure.</p></div><select aria-label="Alphabet size" value={game.letterCount} disabled={game.status !== "waiting"} onChange={(event) => changeLetterCount(Number(event.target.value))}>{LETTER_OPTIONS.map((count) => <option key={count} value={count}>{count} LETTERS · A–{ALPHABET[count - 1]}</option>)}</select></div>}
            {error && <p className="error-message" role="alert">{error}</p>}
            {isHost ? <button className="button button-primary start-button" disabled={game.players.length !== 2} onClick={startGame}>START MATCH <span>↗</span></button> : <div className="waiting-note"><span className="loading-pulse" /> WAITING FOR THE HOST TO START</div>}
            <button className="quiet-button" onClick={leaveRoom}>← LEAVE LOBBY</button>
          </div>
          <aside className="waiting-aside"><div className="aside-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><span className="orbit-core">LD</span><span className="orbit-float float-one">A</span><span className="orbit-float float-two">Z</span><span className="orbit-float float-three">?</span></div><div className="aside-note"><span className="field-label">HOW IT WORKS</span><div><b>01</b><p>SPAWNER hides the alphabet across the grid.</p></div><div><b>02</b><p>CATCHER moves fast and collects letters in order.</p></div><div><b>03</b><p>Switch roles after round one. Highest score wins.</p></div></div></aside>
        </section>
      ) : (
        <section className="match-layout">
          <div className="match-main">
            <div className="match-heading"><div><div className="eyebrow"><span className="live-pip" /> LIVE MATCH <span className="eyebrow-divider">/</span> ROUND {game.round} OF 2</div><h1>{game.phase === "finished" ? "MATCH COMPLETE." : game.phase === "roundOver" ? "ROUND COMPLETE." : game.phase === "placing" ? "SET THE BOARD." : "CHASE THE ORDER."}</h1><p>
  {game.phase === "placing"
    ? isSpawner
      ? `Place A–${ALPHABET[game.letterCount - 1]} in order. Your rival cannot see the letters yet.`
      : "The Spawner is setting the board. Get ready to move."
    : game.phase === "playing"
      ? isCatcher
        ? `Find ${game.nextLetter || "the final letter"} next. Move with WASD or the arrow keys.`
        : "Your rival is hunting the alphabet. Watch the action."
      : game.phase === "finished"
        ? winner === "DRAW GAME"
          ? "Dead even. Time for a rematch."
          : `${winner}. Run it back?`
        : "Round complete. Get ready for the role swap."}
</p></div><div className="phase-pill"><span className="phase-dot" />{game.phase === "placing" ? "PLACEMENT" : game.phase === "playing" ? "IN PROGRESS" : game.phase === "roundOver" ? "ROUND BREAK" : "FINAL RESULTS"}</div></div>

            {isFinished ? (
              <div className="result-card"><div className="result-spark">✳</div><span className="field-label">FINAL RESULT</span><h2>{winner}</h2><p>{scoreA === scoreB ? "Dead even. The rematch is calling." : `${scoreA > scoreB ? playerA?.name : playerB?.name} takes the win. Run it back?`}</p><div className="final-scores"><div><span>{playerA?.name || "PLAYER 1"}</span><strong>{scoreA.toLocaleString()}</strong></div><span className="versus">VS</span><div><span>{playerB?.name || "PLAYER 2"}</span><strong>{scoreB.toLocaleString()}</strong></div></div><button className="button button-primary replay-button" onClick={replay} disabled={hasVotedReplay}>{hasVotedReplay ? <><span className="button-spinner" /> WAITING FOR RIVAL</> : <>VOTE TO PLAY AGAIN <span>↻</span></>}</button><p className="replay-hint">{hasVotedReplay ? "Your vote is in. The match restarts when your rival agrees." : "Both players must vote to start a fresh match."}</p>{error && <p className="error-message" role="alert">{error}</p>}</div>
            ) : (
              <>
                <div className="arena-topline"><span><i /> PIXEL ARENA</span><span>{COLS} × {ROWS} GRID <b>·</b> {game.letterCount} LETTERS</span></div>
                <div className={`arena-frame phase-${game.phase}`}><div className="arena-corner corner-tl" /><div className="arena-corner corner-tr" /><div className="arena-corner corner-bl" /><div className="arena-corner corner-br" /><div className="arena-grid">{Array.from({ length: COLS * ROWS }, (_, index) => {
                  const x = index % COLS; const y = Math.floor(index / COLS); const letter = occupied.get(`${x},${y}`);
                  const isCatcherCell = game.catcherPosition.x === x && game.catcherPosition.y === y;
                  return <button key={index} className={["arena-cell", letter ? "has-letter" : "", letter?.collected ? "collected" : "", isCatcherCell ? "catcher-cell" : ""].filter(Boolean).join(" ")} onClick={() => placeLetter(x, y)} disabled={game.phase !== "placing" || !isSpawner || Boolean(letter)} aria-label={`Cell ${x + 1}, ${y + 1}${letter ? `, ${letter.letter}` : ""}`}>
                    {letter && !letter.collected && <span className="letter-tile">{letter.letter}</span>}{letter?.collected && <span className="collected-mark">✓</span>}{isCatcherCell && <span className="catcher-sprite" aria-label="Catcher">▶</span>}
                  </button>;
                })}</div></div>
                <div className="arena-message"><span className="message-icon">{game.phase === "placing" ? "⌁" : "↗"}</span><span>{game.phase === "placing" && isSpawner ? `PLACE LETTER ${Math.min(game.letters.length + 1, game.letterCount)} OF ${game.letterCount}` : game.phase === "placing" ? "WAITING FOR THE REVEAL" : game.phase === "playing" && isCatcher ? `YOUR TARGET  /  ${game.nextLetter || "COMPLETE"}` : game.phase === "playing" ? "OPPONENT IN MOTION" : "NEXT ROUND LOADING"}</span><span className="message-right">{game.phase === "playing" && isCatcher ? "WASD / ARROWS" : "LIVE SYNC"}</span></div>
                <div className="match-bottom-stats"><div><span className="field-label">NEXT LETTER</span><strong>{game.phase === "placing" ? "—" : game.nextLetter || "✓"}</strong></div><div><span className="field-label">COMBO</span><strong>×{game.combo}</strong></div><div className="event-stat"><span className="field-label">LAST EVENT</span><strong>{game.lastEvent || "Awaiting action"}</strong></div></div>
              </>
            )}
            {error && !isFinished && <p className="error-message" role="alert">{error}</p>}
          </div>

          <aside className="match-sidebar">
            <div className="hud-card timer-card"><div className="hud-card-heading"><span className="field-label">TIME REMAINING</span><span className="timer-live"><i /> LIVE</span></div><strong className={`big-timer ${game.timeLeft <= 10 ? "timer-danger" : ""}`}>{String(Math.floor(game.timeLeft / 60)).padStart(2, "0")}:{String(game.timeLeft % 60).padStart(2, "0")}</strong><div className="timer-track"><span style={{ width: `${Math.max(0, Math.min(100, game.timeLeft / Math.max(1, game.phase === "placing" ? ({ 4: 15, 6: 18, 8: 22, 12: 25, 16: 28, 20: 32, 24: 36, 26: 40 } as Record<number, number>)[game.letterCount] || 22 : Math.round(45 * game.letterCount / 8)) * 100))}%` }} /></div><div className="timer-foot"><span>ROUND {game.round} / 2</span><span>{game.letterCount} LETTERS</span></div></div>
            <div className="hud-section-title">THE PLAYERS <span>02</span></div>
            {[playerA, playerB].map((player, index) => {
              if (!player) return <div className="hud-player hud-player-empty" key={`empty-${index}`}>WAITING FOR PLAYER</div>;
              const own = player.id === socket.id;
              const role = game.phase === "waiting" ? player.role : game.spawnerId === player.id ? "SPAWNER" : game.catcherId === player.id ? "CATCHER" : player.role;
              const score = game.scores[player.id] || 0;
              return <div className={`hud-player ${own ? "hud-player-own" : ""} ${role === "CATCHER" ? "role-catcher" : "role-spawner"}`} key={player.id}><div className="hud-player-top"><div className="hud-avatar">{player.name.slice(0, 1).toUpperCase()}</div><div className="hud-player-name"><strong>{player.name}</strong><span>{own ? "YOU" : `PLAYER 0${index + 1}`}</span></div><span className="player-index">0{index + 1}</span></div><div className="hud-player-bottom"><span className="role-tag"><i />{role}</span><strong className="hud-score">{score.toLocaleString()}</strong></div></div>;
            })}
            <div className="hud-card objective-card"><span className="field-label">CURRENT OBJECTIVE</span><div className="objective-letter">{game.phase === "placing" ? "A–" + ALPHABET[game.letterCount - 1] : game.nextLetter || "✓"}</div><p>{game.phase === "placing" ? isSpawner ? "Place each letter on an empty tile." : "Keep your hands ready. Board reveal incoming." : game.phase === "playing" ? isCatcher ? "Collect letters in alphabetical order." : "Your opponent is racing the clock." : game.phase === "roundOver" ? "Prepare for the role swap." : "Match finished. Vote for a rematch."}</p></div>
            <button className="quiet-button sidebar-leave" onClick={leaveRoom}>↙ LEAVE MATCH</button>
          </aside>
        </section>
      )}

      <footer className={`footer ${game && !isLobby ? "footer-match" : ""}`}><span>LETTER DASH <b>© 2026</b></span><span>ONE CREATES THE CHAOS. THE OTHER RESTORES ORDER.</span><span className="footer-build">BUILT FOR THE QUICK</span></footer>
    </main>
  );
}

export default App;