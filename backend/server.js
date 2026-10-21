
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://10.69.90.181:5173",
    ],
    methods: ["GET", "POST"],
  },
});

const SPAWNER_TIMES = {
  4: 15,
  6: 18,
  8: 22,
  12: 25,
  16: 28,
  20: 32,
  24: 36,
  26: 40,
};

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const LETTERS = "ABCDEFGH".split("");
const LETTER_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 26];

function getLetters(count) {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, count).split("");
}
const COLS = 8;
const ROWS = 6;
const ROUND_SECONDS = 45;
const SPAWN_SECONDS = 20;
const CELL_COUNT = COLS * ROWS;

app.get("/", (_req, res) => {
  res.json({
    name: "LETTER DASH",
    status: "online",
    gameEngine: "ready",
  });
});

function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from(
      { length: 5 },
      () => chars[randomInt(chars.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function playerInAnyRoom(socketId) {
  return [...rooms.values()].some((room) =>
    room.players.some((p) => p.id === socketId)
  );
}

function getPlayer(room, socketId) {
  return room.players.find((p) => p.id === socketId);
}


function publicState(room, viewerId = null) {
  const isSpawner = viewerId === room.spawnerId;
  const hideLetters =
    room.phase === "placing" && !isSpawner;

  const letters = hideLetters
    ? []
    : Object.values(room.letters);

  const alphabet = getLetters(room.letterCount);

  return {
    code: room.code,
    status: room.status,
    players: room.players.map(({ id, name }) => ({
      id,
      name,
      role:
        room.status === "waiting"
          ? room.players[0]?.id === id
            ? "HOST"
            : "GUEST"
          : room.roles[id] || "PLAYER",
    })),
    round: room.round,
    phase: room.phase,
    letterCount: room.letterCount,
    spawnerId: room.spawnerId,
    catcherId: room.catcherId,
    letters,
    nextLetter:
      room.phase === "placing"
        ? null
        : alphabet[room.nextIndex] || null,
    catcherPosition: room.catcherPosition,
    scores: room.scores,
    combo: room.combo,
    timeLeft: room.timeLeft,
    message: room.message,
    lastEvent: room.lastEvent,
  };
}


function broadcast(room) {
  for (const player of room.players) {
    io.to(player.id).emit(
      "gameState",
      publicState(room, player.id)
    );
  }
}

function stopTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}


function endRound(room, reason) {
  if (room.phase !== "playing") return;

  stopTimer(room);
  room.phase = "roundOver";
  room.message = reason;

  const letters = getLetters(room.letterCount);

  if (room.nextIndex === letters.length) {
    room.scores[room.catcherId] += 200;
    room.message = `ALPHABET COMPLETE! +200 BONUS`;
  }

  broadcast(room);

  setTimeout(() => {
    if (!rooms.has(room.code) || room.phase !== "roundOver") return;

    if (room.round === 1) {
      room.round = 2;
      beginRound(room);
    } else {
      room.phase = "finished";
      room.status = "finished";

      const [a, b] = room.players;
      const scoreA = room.scores[a.id] || 0;
      const scoreB = room.scores[b.id] || 0;

      room.message =
        scoreA === scoreB
          ? "IT'S A DRAW!"
          : scoreA > scoreB
            ? `${a.name} WINS!`
            : `${b.name} WINS!`;

      broadcast(room);
    }
  }, 2500);
}


function startPlaying(room) {
  room.phase = "playing";

  const letters = getLetters(room.letterCount);
  room.timeLeft = Math.round(
    ROUND_SECONDS * (letters.length / 8)
  );

  room.message = "COLLECT THE LETTERS IN ORDER!";
  room.lastEvent = null;
  broadcast(room);

  room.timer = setInterval(() => {
    if (room.phase !== "playing") return;

    room.timeLeft -= 1;

    if (room.timeLeft <= 0) {
      room.timeLeft = 0;
      endRound(room, "TIME'S UP!");
    } else {
      broadcast(room);
    }
  }, 1000);
}


function beginRound(room) {
  stopTimer(room);

  room.status = "playing";
  room.phase = "placing";
  room.letters = {};
  room.nextIndex = 0;
  room.combo = 0;

  const roundLetters = getLetters(room.letterCount);

  room.timeLeft = SPAWNER_TIMES[room.letterCount] ?? 22;

  room.message = `SPAWNER: PLACE A–${roundLetters[roundLetters.length - 1]} ON THE GRID`;
  room.catcherPosition = { x: 0, y: 0 };
  room.lastEvent = null;
  room.lastMoveAt = 0;

  const spawner = room.players[(room.round - 1) % 2];
  const catcher = room.players[room.round % 2];

  room.spawnerId = spawner.id;
  room.catcherId = catcher.id;
  room.roles = {
    [spawner.id]: "SPAWNER",
    [catcher.id]: "CATCHER",
  };

  broadcast(room);

  room.timer = setInterval(() => {
    if (room.phase !== "placing") return;

    room.timeLeft -= 1;

    if (room.timeLeft <= 0) {
      room.timeLeft = 0;

      // Fill any unplaced letters into free cells automatically.
      for (const letter of getLetters(room.letterCount)) {
        if (room.letters[letter]) continue;

        const occupied = new Set(
          Object.values(room.letters).map(
            (entry) => entry.y * COLS + entry.x
          )
        );

        const free = Array.from(
          { length: CELL_COUNT },
          (_, i) => i
        ).filter((i) => !occupied.has(i));

        if (!free.length) break;

        const cell = free[randomInt(free.length)];

        room.letters[letter] = {
          letter,
          x: cell % COLS,
          y: Math.floor(cell / COLS),
        };
      }

      stopTimer(room);
      room.catcherPosition = { x: 0, y: 0 };
      startPlaying(room);
    } else {
      broadcast(room);
    }
  }, 1000);
}


function makeRoom(socket, name) {
  const code = newCode();

  const room = {
    code,
    hostId: socket.id,
    players: [{ id: socket.id, name }],
    status: "waiting",
    phase: "waiting",
    round: 1,
    letterCount: 8,
    roles: {},
    spawnerId: null,
    catcherId: null,
    letters: {},
    nextIndex: 0,
    catcherPosition: { x: 0, y: 0 },
    scores: { [socket.id]: 0 },
    combo: 0,
    timeLeft: 0,
    message: "WAITING FOR ANOTHER PLAYER",
    lastEvent: null,
    lastMoveAt: 0,
    timer: null,
    disconnectTimers: {},
    disconnectedPlayers: {},
  };

  rooms.set(code, room);
  socket.join(code);

  return room;
}


io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", (payload = {}, callback = () => {}) => {
    const name =
      typeof payload.name === "string"
        ? payload.name.trim().slice(0, 16)
        : "";

    if (!name) return callback({ error: "Enter a player name." });
    if (playerInAnyRoom(socket.id)) {
      return callback({ error: "You are already in a room." });
    }

    const room = makeRoom(socket, name);
    callback({ ok: true, code: room.code });
    broadcast(room);
  });


  socket.on("joinRoom", (payload = {}, callback = () => {}) => {
    const code =
      typeof payload.code === "string"
        ? payload.code.trim().toUpperCase()
        : "";

    const name =
      typeof payload.name === "string"
        ? payload.name.trim().slice(0, 16)
        : "";

    const room = rooms.get(code);

    if (!name) return callback({ error: "Enter a player name." });
    if (!room) return callback({ error: "Room not found." });

    if (playerInAnyRoom(socket.id)) {
      return callback({ error: "You are already in a room." });
    }

    // Reclaim a disconnected player's existing slot.
    const disconnectedEntry = Object.entries(
      room.disconnectedPlayers || {}
    ).find(([, info]) => info.name === name);

    if (disconnectedEntry) {
      const [oldSocketId] = disconnectedEntry;

      const disconnectTimer = room.disconnectTimers?.[oldSocketId];

      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        delete room.disconnectTimers[oldSocketId];
      }

      delete room.disconnectedPlayers[oldSocketId];

      const player = room.players.find((p) => p.id === oldSocketId);

      if (player) {
        player.id = socket.id;
      }

      // Keep scores, roles, letters, timers, and round state intact.
      if (room.scores[oldSocketId] !== undefined) {
        room.scores[socket.id] = room.scores[oldSocketId];
        delete room.scores[oldSocketId];
      }

      if (room.roles?.[oldSocketId] !== undefined) {
        room.roles[socket.id] = room.roles[oldSocketId];
        delete room.roles[oldSocketId];
      }

      if (room.spawnerId === oldSocketId) {
        room.spawnerId = socket.id;
      }

      if (room.catcherId === oldSocketId) {
        room.catcherId = socket.id;
      }

      if (room.hostId === oldSocketId) {
        room.hostId = socket.id;
      }

      socket.join(code);

      callback({ ok: true, code, reconnected: true });
      broadcast(room);

      console.log(`Player ${name} reconnected to room ${code}`);
      return;
    }

    // New players can only join a waiting room.
    if (room.status !== "waiting" || room.players.length >= 2) {
      return callback({ error: "This room is already full." });
    }

    room.players.push({ id: socket.id, name });
    room.scores[socket.id] = 0;
    socket.join(code);

    callback({ ok: true, code });
    broadcast(room);
  });


  socket.on("setLetterCount", (payload = {}, callback = () => {}) => {
    const room = [...rooms.values()].find(
      (r) => r.players.some((p) => p.id === socket.id)
    );

    if (!room) {
      return callback({ error: "Join a room first." });
    }

    if (socket.id !== room.hostId) {
      return callback({ error: "Only the host can change letter count." });
    }

    if (room.status !== "waiting") {
      return callback({ error: "Letter count can only be changed before the game starts." });
    }

    const count = Number(payload.count);

    if (!LETTER_OPTIONS.includes(count)) {
      return callback({ error: "Choose 4, 6, 8, 12, 16, 20, 24, or 26 letters." });
    }

    room.letterCount = count;
    room.message = `GAME SET TO ${count} LETTERS`;

    broadcast(room);
    callback({ ok: true });
  });

  socket.on("startGame", (callback = () => {}) => {
    const room = [...rooms.values()].find(
      (r) => r.players.some((p) => p.id === socket.id)
    );

    if (!room) return callback({ error: "Join a room first." });
    if (socket.id !== room.hostId) {
      return callback({ error: "Only the host can start the game." });
    }
    if (room.players.length !== 2) {
      return callback({ error: "Two players are required." });
    }
    if (room.status !== "waiting") {
      return callback({ error: "Game already started." });
    }

    room.round = 1;
    room.scores = Object.fromEntries(
      room.players.map((p) => [p.id, 0])
    );
    beginRound(room);
    callback({ ok: true });
  });


  socket.on("placeLetter", (payload = {}, callback = () => {}) => {
    const room = [...rooms.values()].find(
      (r) => r.players.some((p) => p.id === socket.id)
    );

    if (!room || room.phase !== "placing") {
      return callback({ error: "Letter placement is not active." });
    }

    if (socket.id !== room.spawnerId) {
      return callback({ error: "You are not the Spawner." });
    }

    const { x, y } = payload;

    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 || x >= COLS ||
      y < 0 || y >= ROWS
    ) {
      return callback({ error: "Invalid grid cell." });
    }

    const letters = getLetters(room.letterCount);
    const letter = letters.find((l) => !room.letters[l]);

    if (!letter) {
      return callback({ error: "All letters are placed." });
    }

    const occupied = Object.values(room.letters).some(
      (entry) => entry.x === x && entry.y === y
    );

    if (occupied) {
      return callback({ error: "Cell already occupied." });
    }

    room.letters[letter] = { letter, x, y };
    room.lastEvent = `${letter} PLACED`;

    if (Object.keys(room.letters).length === letters.length) {
      room.message = "ALL LETTERS PLACED — WAIT FOR REVEAL!";
    } else {
      room.message = `PLACE ${letters[Object.keys(room.letters).length]} NEXT`;
    }

broadcast(room);
    callback({ ok: true, letter });
  });


  socket.on("move", (payload = {}, callback = () => {}) => {
    const room = [...rooms.values()].find(
      (r) => r.players.some((p) => p.id === socket.id)
    );

    // Allow movement during placement and catching phases.
    if (!room || !["placing", "playing"].includes(room.phase)) {
      return callback({ error: "The Catcher cannot move right now." });
    }

    if (socket.id !== room.catcherId) {
      return callback({ error: "Only the Catcher can move." });
    }

    const now = Date.now();

    if (now - room.lastMoveAt < 100) {
      return callback({ error: "Move too quickly." });
    }

    room.lastMoveAt = now;

    const { dx, dy } = payload;

    if (
      !Number.isInteger(dx) ||
      !Number.isInteger(dy) ||
      Math.abs(dx) + Math.abs(dy) !== 1
    ) {
      return callback({ error: "Invalid movement." });
    }

    const next = {
      x: room.catcherPosition.x + dx,
      y: room.catcherPosition.y + dy,
    };

    if (
      next.x < 0 || next.x >= COLS ||
      next.y < 0 || next.y >= ROWS
    ) {
      return callback({ error: "Out of bounds." });
    }

    room.catcherPosition = next;

    // Movement is allowed during placement, but catching is not.
    if (room.phase === "placing") {
      broadcast(room);
      return callback({ ok: true });
    }

    // Letter collection is enabled only during the playing phase.
    const hit = Object.values(room.letters).find(
      (entry) =>
        entry.x === next.x &&
        entry.y === next.y &&
        !entry.collected
    );

    if (hit) {
      const letters = getLetters(room.letterCount);
      const expected = letters[room.nextIndex];

      if (hit.letter === expected) {
        hit.collected = true;
        room.nextIndex += 1;
        room.combo += 1;

        const points = 100 + Math.max(0, room.combo - 1) * 10;
        room.scores[socket.id] += points;

        room.lastEvent = `+${points} · ${hit.letter} CAUGHT`;

        room.message =
          room.nextIndex === letters.length
            ? "ALL LETTERS CAUGHT!"
            : `NEXT LETTER: ${letters[room.nextIndex]}`;

        if (room.nextIndex === letters.length) {
          broadcast(room);
          endRound(room, "ALPHABET COMPLETE!");
          return callback({ ok: true });
        }
      } else {
        room.combo = 0;
        room.lastEvent = `WRONG LETTER: ${hit.letter} · NEED ${expected}`;
        room.message = `WRONG LETTER! FIND ${expected} NEXT`;
      }
    } else {
      room.lastEvent = null;
    }

    broadcast(room);
    callback({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const player = room.players.find((p) => p.id === socket.id);

      if (!player) continue;

      // Remember who disconnected and when.
      room.disconnectedPlayers[socket.id] = {
        name: player.name,
        disconnectedAt: Date.now(),
      };

      // Give the player 30 seconds to reconnect.
      room.disconnectTimers[socket.id] = setTimeout(() => {
        if (!rooms.has(code)) return;

        const stillDisconnected = room.disconnectedPlayers[socket.id];

        if (!stillDisconnected) return;

        stopTimer(room);
        rooms.delete(code);

        io.to(code).emit("roomClosed", {
          message: "A player disconnected. The room has closed.",
        });

        console.log(`Room ${code} closed after reconnect timeout`);
      }, 30000);

      console.log(
        `Player ${player.name} disconnected from room ${code}. Waiting 30 seconds for reconnect.`
      );

      break;
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`LETTER DASH server running on port ${PORT}`);
});
