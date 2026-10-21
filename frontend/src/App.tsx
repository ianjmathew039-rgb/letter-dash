
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import "./index.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

const socket = io(SERVER_URL, { autoConnect: false });

const COLS = 8;
const ROWS = 6;
const LETTER_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 26];
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Letter = {
  letter: string;
  x: number;
  y: number;
  collected?: boolean;
};

type Player = {
  id: string;
  name: string;
  role: string;
};

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
};

type SocketResult = {
  ok?: boolean;
  code?: string;
  error?: string;
};

function App() {
  const [name, setName] = useState(
    () => sessionStorage.getItem("letterDashName") || "",
  );
  const [roomCode, setRoomCode] = useState(
    () => sessionStorage.getItem("letterDashRoomCode") || "",
  );
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      const keys: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        w: [0, -1],
        W: [0, -1],
        ArrowDown: [0, 1],
        s: [0, 1],
        S: [0, 1],
        ArrowLeft: [-1, 0],
        a: [-1, 0],
        A: [-1, 0],
        ArrowRight: [1, 0],
        d: [1, 0],
        D: [1, 0],
      };

      const direction = keys[event.key];

      if (
        !direction ||
        !game ||
        !["placing", "playing"].includes(game.phase)
      ) {
        return;
      }

      if (game.catcherId !== socket.id) return;

      event.preventDefault();

      socket.emit("move", {
        dx: direction[0],
        dy: direction[1],
      });
    },
    [game],
  );

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setError("");

      const savedName = sessionStorage.getItem("letterDashName");
      const savedCode = sessionStorage.getItem("letterDashRoomCode");

      if (!savedName || !savedCode) return;

      socket.emit(
        "joinRoom",
        {
          name: savedName,
          code: savedCode,
        },
        (result: SocketResult & { reconnected?: boolean }) => {
          if (result?.error) {
            setError(result.error);
            return;
          }

          if (result?.code) {
            setRoomCode(result.code);
          }
        },
      );
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

    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [handleKey]);

  function createRoom() {
    if (!name.trim()) {
      setError("Enter your player name.");
      return;
    }

    if (!connected) {
      setError("Waiting for server connection.");
      return;
    }

    setError("");
    setBusy(true);

    socket.emit(
      "createRoom",
      { name: name.trim() },
      (result: SocketResult) => {
        setBusy(false);

        if (result?.error) setError(result.error);
        if (result?.code) {
          setRoomCode(result.code);
          sessionStorage.setItem("letterDashRoomCode", result.code);
        }
      },
    );
  }

  function joinRoom() {
    if (!name.trim()) {
      setError("Enter your player name.");
      return;
    }

    if (roomCode.trim().length !== 5) {
      setError("Enter a five-character room code.");
      return;
    }

    if (!connected) {
      setError("Waiting for server connection.");
      return;
    }

    setError("");
    sessionStorage.setItem("letterDashName", name.trim());
    setBusy(true);

    socket.emit(
      "joinRoom",
      {
        name: name.trim(),
        code: roomCode.trim().toUpperCase(),
      },
      (result: SocketResult) => {
        setBusy(false);

        if (result?.error) setError(result.error);
        if (result?.code) setRoomCode(result.code);
      },
    );
  }

  function startGame() {
    setError("");

    socket.emit("startGame", (result: SocketResult) => {
      if (result?.error) setError(result.error);
    });
  }

  function changeLetterCount(count: number) {
    setError("");

    socket.emit(
      "setLetterCount",
      { count },
      (result: SocketResult) => {
        if (result?.error) setError(result.error);
      },
    );
  }

  function placeLetter(x: number, y: number) {
    if (game?.phase !== "placing" || game.spawnerId !== socket.id) {
      return;
    }

    socket.emit(
      "placeLetter",
      { x, y },
      (result: SocketResult) => {
        if (result?.error) setError(result.error);
        else setError("");
      },
    );
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(game?.code || roomCode);
      setError("");
    } catch {
      setError("Copy failed. Copy the room code manually.");
    }
  }

  function leaveRoom() {
    sessionStorage.removeItem("letterDashName");
    sessionStorage.removeItem("letterDashRoomCode");

    socket.disconnect();
    setGame(null);
    setRoomCode("");
    setError("");
    socket.connect();
  }

  const isHost = game?.players[0]?.id === socket.id;
  const isSpawner = game?.spawnerId === socket.id;
  const isCatcher = game?.catcherId === socket.id;
  const isLobby = game?.phase === "waiting";

  const occupied = new Map(
    (game?.letters || []).map((letter) => [
      `${letter.x},${letter.y}`,
      letter,
    ]),
  );

  return (
    <main className="app-shell">
      <div className="scanlines" />

      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">LD</span>
          LETTER<span className="brand-accent"> DASH</span>
        </a>

        <div className="connection">
          <span className={`status-dot ${connected ? "online" : ""}`} />
          {connected ? "SERVER ONLINE" : "CONNECTING..."}
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          TWO PLAYERS. ONE ALPHABET.
          <span className="eyebrow-line" />
        </div>

        <h1>
          CREATE THE
          <br />
          <span className="chaos-text">CHAOS.</span>
          <br />
          RESTORE ORDER<span className="title-period">.</span>
        </h1>

        <p className="hero-copy">
          One scatters the letters. One races to collect them.
          <br />
          How fast can you restore the alphabet?
        </p>

        {!game ? (
          <section className="panel">
            <div className="panel-heading">▣ PLAYER LOBBY</div>

            <label htmlFor="player-name">YOUR CALLSIGN</label>
            <input
              id="player-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={16}
              placeholder="Enter your name..."
            />

            <button
              className="primary-button"
              onClick={createRoom}
              disabled={busy || !connected}
            >
              {busy ? "PLEASE WAIT..." : "+ CREATE ROOM"}
            </button>

            <div className="or-divider">
              <span /> OR JOIN A FRIEND <span />
            </div>

            <div className="join-row">
              <input
                aria-label="Room code"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 5),
                  )
                }
                placeholder="ROOM CODE"
                maxLength={5}
              />

              <button
                className="secondary-button"
                onClick={joinRoom}
                disabled={busy || !connected}
              >
                JOIN →
              </button>
            </div>

            {error && <p className="error-message">{error}</p>}
          </section>
        ) : (
          <section className={`game-panel ${isLobby ? "lobby-mode" : `phase-${game.phase}`}`}>
            <div className="game-toolbar">
              <div>
                <span className="small-label">ROOM</span>
                <button className="toolbar-code" onClick={copyCode}>
                  {game.code} ⧉
                </button>
              </div>

              <div className="round-badge">ROUND {game.round} / 2</div>

              <div className="timer-block">
                <span className="small-label">TIME</span>
                <strong>{game.timeLeft}s</strong>
              </div>
            </div>

            <div className="scoreboard">
              {game.players.map((player) => (
                <div className="score-card" key={player.id}>
                  <span>{player.name}</span>
                  <strong>{game.scores[player.id] || 0}</strong>
                  <small>
                    {player.role}
                    {player.id === socket.id ? " · YOU" : ""}
                  </small>
                </div>
              ))}
            </div>

            <div className="game-status">
              <span className="pulse-dot" />
              {game.message}
            </div>

            {isLobby ? (
              <div className="lobby-content">
                <p className="room-caption">
                  SHARE THE CODE WITH YOUR OPPONENT
                </p>

                <button className="room-code" onClick={copyCode}>
                  {game.code} <span>▣ COPY</span>
                </button>

                {game.players.map((player) => (
                  <div className="player-card" key={player.id}>
                    <div className="player-avatar">
                      {player.name[0]?.toUpperCase()}
                    </div>

                    <div className="player-details">
                      <strong>{player.name}</strong>
                      <span>
                        {player.id === socket.id ? "YOU" : "OPPONENT"}
                      </span>
                    </div>

                    <span className="player-status ready">CONNECTED</span>
                  </div>
                ))}

                {game.players.length < 2 && (
                  <p className="waiting-message">
                    WAITING FOR PLAYER TWO...
                  </p>
                )}

                {isHost && (
                  <>
                    <div className="letter-settings">
                      <label htmlFor="letter-count">ALPHABET SIZE</label>

                      <select
                        id="letter-count"
                        value={game.letterCount}
                        disabled={game.status !== "waiting"}
                        onChange={(event) =>
                          changeLetterCount(Number(event.target.value))
                        }
                      >
                        {LETTER_OPTIONS.map((count) => (
                          <option key={count} value={count}>
                            {count} LETTERS (A–{ALPHABET[count - 1]})
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="primary-button"
                      disabled={game.players.length !== 2}
                      onClick={startGame}
                    >
                      START GAME →
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="arena-heading">
                  <span>PIXEL ARENA</span>
                  <span>{COLS} × {ROWS} GRID</span>
                </div>

                <div className="arena-grid">
                  {Array.from({ length: COLS * ROWS }, (_, index) => {
                    const x = index % COLS;
                    const y = Math.floor(index / COLS);
                    const letter = occupied.get(`${x},${y}`);
                    const isCatcherCell =
                      game.catcherPosition.x === x &&
                      game.catcherPosition.y === y;

                    return (
                      <button
                        key={index}
                        className={[
                          "arena-cell",
                          letter ? "has-letter" : "",
                          letter?.collected ? "collected" : "",
                          isCatcherCell ? "catcher-cell" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => placeLetter(x, y)}
                        disabled={
                          game.phase !== "placing" ||
                          !isSpawner ||
                          Boolean(letter)
                        }
                        aria-label={`Cell ${x + 1}, ${y + 1}${
                          letter ? `, ${letter.letter}` : ""
                        }`}
                      >
                        {letter && !letter.collected && (
                          <span className="letter-tile">
                            {letter.letter}
                          </span>
                        )}

                        {letter?.collected && (
                          <span className="collected-mark">✓</span>
                        )}

                        {isCatcherCell && (
                          <span className="catcher-sprite">▶</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="game-instructions">
                  {game.phase === "placing" && isSpawner && (
                    <p>
                      CLICK EMPTY CELLS TO PLACE A–{ALPHABET[game.letterCount - 1]} IN ORDER.
                    </p>
                  )}

                  {game.phase === "placing" && isCatcher && (
                    <p>SPAWNER IS PREPARING YOUR ARENA...</p>
                  )}

                  {game.phase === "playing" && isCatcher && (
                    <p>
                      MOVE WITH WASD OR ARROW KEYS · NEXT:{" "}
                      {game.nextLetter || "DONE"}
                    </p>
                  )}

                  {game.phase === "playing" && isSpawner && (
                    <p>WATCH YOUR OPPONENT RESTORE ORDER!</p>
                  )}

                  {game.phase === "roundOver" && (
                    <p>ROUND COMPLETE — NEXT ROUND LOADING...</p>
                  )}

                  {game.phase === "finished" && (
                    <p className="winner-message">{game.message}</p>
                  )}
                </div>

                <div className="game-stats">
                  <div>
                    <span className="small-label">NEXT LETTER</span>
                    <strong>{game.nextLetter || "✓"}</strong>
                  </div>

                  <div>
                    <span className="small-label">COMBO</span>
                    <strong>×{game.combo}</strong>
                  </div>

                  <div>
                    <span className="small-label">LAST EVENT</span>
                    <strong className="last-event">
                      {game.lastEvent || "—"}
                    </strong>
                  </div>
                </div>
              </>
            )}

            {error && <p className="error-message">{error}</p>}

            {game.phase === "finished" && (
              <button className="primary-button" onClick={leaveRoom}>
                BACK TO MENU
              </button>
            )}

            <button className="text-button" onClick={leaveRoom}>
              ← LEAVE ROOM
            </button>
          </section>
        )}

        <div className="feature-row">
          <div>
            <span className="feature-symbol">⌘</span> REAL-TIME MULTIPLAYER
          </div>
          <div>
            <span className="feature-symbol">◈</span> PIXEL-POWERED CHAOS
          </div>
          <div>
            <span className="feature-symbol">↗</span> SKILL OVER LUCK
          </div>
        </div>
      </section>

      <footer className="footer">
        <span>LETTER DASH © 2026</span>
        <span>ONE CREATES THE CHAOS. THE OTHER RESTORES ORDER.</span>
      </footer>
    </main>
  );
}

export default App;
