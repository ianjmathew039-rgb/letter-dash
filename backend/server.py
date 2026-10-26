
import asyncio
import os
import random
import secrets
import string
import time
from contextlib import suppress

import socketio
import uvicorn


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

PORT = int(os.getenv("PORT", "3000"))
COLS = 8
ROWS = 6
CELL_COUNT = COLS * ROWS
ROUND_SECONDS = 45

SPAWNER_TIMES = {
    4: 15,
    6: 18,
    8: 22,
    12: 25,
    16: 28,
    20: 32,
    24: 36,
    26: 40,
}

LETTER_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 26]
ALPHABET = string.ascii_uppercase
ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://10.69.90.181:5173",
]

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.1.8:5173",
    ],
)

app = socketio.ASGIApp(sio)
rooms = {}


# --------------------------------------------------
# HELPERS
# --------------------------------------------------

def get_letters(count):
    return list(ALPHABET[:count])


def new_code():
    while True:
        code = "".join(secrets.choice(ROOM_CHARS) for _ in range(5))
        if code not in rooms:
            return code


def get_room_for_player(sid):
    for room in rooms.values():
        if any(player["id"] == sid for player in room["players"]):
            return room
    return None


def get_player(room, sid):
    return next(
        (player for player in room["players"] if player["id"] == sid),
        None,
    )


def public_state(room, viewer_id=None):
    is_spawner = viewer_id == room["spawnerId"]
    hide_letters = room["phase"] == "placing" and not is_spawner

    letters = (
        []
        if hide_letters
        else [dict(letter) for letter in room["letters"].values()]
    )

    players = []
    for player in room["players"]:
        if room["status"] == "waiting":
            role = "HOST" if player["id"] == room["hostId"] else "GUEST"
        else:
            role = room["roles"].get(player["id"], "PLAYER")

        players.append({
            "id": player["id"],
            "name": player["name"],
            "role": role,
        })

    alphabet = get_letters(room["letterCount"])

    return {
        "code": room["code"],
        "status": room["status"],
        "players": players,
        "round": room["round"],
        "phase": room["phase"],
        "letterCount": room["letterCount"],
        "spawnerId": room["spawnerId"],
        "catcherId": room["catcherId"],
        "letters": letters,
        "nextLetter": (
            None
            if room["phase"] == "placing"
            else (
                alphabet[room["nextIndex"]]
                if room["nextIndex"] < len(alphabet)
                else None
            )
        ),
        "catcherPosition": dict(room["catcherPosition"]),
        "scores": dict(room["scores"]),
        "combo": room["combo"],
        "timeLeft": room["timeLeft"],
        "message": room["message"],
        "lastEvent": room["lastEvent"],
        "replayVotes": list(room.get("replayVotes", set())),
    }


async def broadcast(room):
    for player in list(room["players"]):
        await sio.emit(
            "gameState",
            public_state(room, player["id"]),
            to=player["id"],
        )




def stop_task(room, key):
    task = room.get(key)
    room[key] = None

    if task is None or task.done():
        return

    if task is asyncio.current_task():
        return

    task.cancel()


async def cancel_room_tasks(room):
    current_task = asyncio.current_task()
    tasks = []

    for key in ("timerTask", "roundTask"):
        task = room.get(key)
        room[key] = None

        if (
            task is not None
            and task is not current_task
            and not task.done()
        ):
            task.cancel()
            tasks.append(task)

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)



def make_room(sid, name):
    code = new_code()

    room = {
        "code": code,
        "hostId": sid,
        "players": [{"id": sid, "name": name}],
        "status": "waiting",
        "phase": "waiting",
        "round": 1,
        "letterCount": 8,
        "roles": {},
        "spawnerId": None,
        "catcherId": None,
        "letters": {},
        "nextIndex": 0,
        "catcherPosition": {"x": 0, "y": 0},
        "scores": {sid: 0},
        "combo": 0,
        "timeLeft": 0,
        "message": "WAITING FOR ANOTHER PLAYER",
        "lastEvent": None,
        "lastMoveAt": 0.0,
        "timerTask": None,
        "roundTask": None,
        "disconnectTasks": {},
        "disconnectedPlayers": {},
        "replayVotes": set(),
    }

    rooms[code] = room
    return room


# --------------------------------------------------
# ROUND MANAGEMENT
# --------------------------------------------------

async def start_playing(room):
    room["phase"] = "playing"
    room["timeLeft"] = round(
        ROUND_SECONDS * (len(get_letters(room["letterCount"])) / 8)
    )
    room["message"] = "COLLECT THE LETTERS IN ORDER!"
    room["lastEvent"] = None

    await broadcast(room)

    async def timer():
        try:
            while room["phase"] == "playing":
                await asyncio.sleep(1)

                if room["phase"] != "playing":
                    return

                room["timeLeft"] -= 1

                if room["timeLeft"] <= 0:
                    room["timeLeft"] = 0
                    await end_round(room, "TIME'S UP!")
                    return

                await broadcast(room)
        except asyncio.CancelledError:
            pass

    room["timerTask"] = asyncio.create_task(timer())


async def begin_round(room):
    await cancel_room_tasks(room)

    room["status"] = "playing"
    room["phase"] = "placing"
    room["letters"] = {}
    room["nextIndex"] = 0
    room["combo"] = 0
    room["timeLeft"] = SPAWNER_TIMES.get(room["letterCount"], 22)
    room["message"] = (
        f"SPAWNER: PLACE A–{get_letters(room['letterCount'])[-1]} ON THE GRID"
    )
    room["catcherPosition"] = {"x": 0, "y": 0}
    room["lastEvent"] = None
    room["lastMoveAt"] = 0.0

    spawner = room["players"][(room["round"] - 1) % 2]
    catcher = room["players"][room["round"] % 2]

    room["spawnerId"] = spawner["id"]
    room["catcherId"] = catcher["id"]
    room["roles"] = {
        spawner["id"]: "SPAWNER",
        catcher["id"]: "CATCHER",
    }

    await broadcast(room)

    async def placement_timer():
        try:
            while room["phase"] == "placing":
                await asyncio.sleep(1)

                if room["phase"] != "placing":
                    return

                room["timeLeft"] -= 1

                if room["timeLeft"] <= 0:
                    room["timeLeft"] = 0

                    # Fill remaining letters into random free cells.
                    for letter in get_letters(room["letterCount"]):
                        if letter in room["letters"]:
                            continue

                        occupied = {
                            entry["y"] * COLS + entry["x"]
                            for entry in room["letters"].values()
                        }
                        free = [
                            i for i in range(CELL_COUNT)
                            if i not in occupied
                        ]

                        if not free:
                            break

                        cell = random.choice(free)
                        room["letters"][letter] = {
                            "letter": letter,
                            "x": cell % COLS,
                            "y": cell // COLS,
                        }

                    room["timerTask"] = None
                    room["catcherPosition"] = {"x": 0, "y": 0}
                    await start_playing(room)
                    return

                await broadcast(room)
        except asyncio.CancelledError:
            pass

    room["timerTask"] = asyncio.create_task(placement_timer())


async def end_round(room, reason):
    if room["phase"] != "playing":
        return

    room["timerTask"] = None
    room["phase"] = "roundOver"
    room["message"] = reason

    if room["nextIndex"] == len(get_letters(room["letterCount"])):
        room["scores"][room["catcherId"]] += 200
        room["message"] = "ALPHABET COMPLETE! +200 BONUS"

    await broadcast(room)

    async def advance_round():
        try:
            await asyncio.sleep(2.5)

            if rooms.get(room["code"]) is not room:
                return
            if room["phase"] != "roundOver":
                return

            if room["round"] == 1:
                room["round"] = 2
                await begin_round(room)
                return

            room["phase"] = "finished"
            room["status"] = "finished"

            player_a, player_b = room["players"]
            score_a = room["scores"].get(player_a["id"], 0)
            score_b = room["scores"].get(player_b["id"], 0)

            if score_a == score_b:
                room["message"] = "IT'S A DRAW!"
            elif score_a > score_b:
                room["message"] = f"{player_a['name']} WINS!"
            else:
                room["message"] = f"{player_b['name']} WINS!"

            await broadcast(room)
        except asyncio.CancelledError:
            pass

    room["roundTask"] = asyncio.create_task(advance_round())


# --------------------------------------------------
# SOCKET EVENTS
# --------------------------------------------------

@sio.event
async def connect(sid, environ, auth=None):
    print(f"Connected: {sid}")


@sio.on("createRoom")
async def create_room(sid, payload=None):
    payload = payload or {}
    name = payload.get("name", "")
    name = name.strip()[:16] if isinstance(name, str) else ""

    if not name:
        return {"error": "Enter a player name."}

    if get_room_for_player(sid):
        return {"error": "You are already in a room."}

    room = make_room(sid, name)
    await sio.enter_room(sid, room["code"])

    await broadcast(room)
    print(f"Room created: {room['code']}")
    return {"ok": True, "code": room["code"]}


@sio.on("joinRoom")
async def join_room(sid, payload=None):
    payload = payload or {}
    raw_code = payload.get("code", "")
    raw_name = payload.get("name", "")

    code = raw_code.strip().upper() if isinstance(raw_code, str) else ""
    name = raw_name.strip()[:16] if isinstance(raw_name, str) else ""

    room = rooms.get(code)

    if not name:
        return {"error": "Enter a player name."}
    if not room:
        return {"error": "Room not found."}
    if get_room_for_player(sid):
        return {"error": "You are already in a room."}

    # Reclaim a disconnected player's slot by name.
    disconnected = next(
        (
            (old_sid, info)
            for old_sid, info in room["disconnectedPlayers"].items()
            if info["name"] == name
        ),
        None,
    )

    if disconnected:
        old_sid, _ = disconnected

        task = room["disconnectTasks"].pop(old_sid, None)
        if task and not task.done():
            task.cancel()

        room["disconnectedPlayers"].pop(old_sid, None)

        player = get_player(room, old_sid)
        if player:
            player["id"] = sid

        if old_sid in room["scores"]:
            room["scores"][sid] = room["scores"].pop(old_sid)

        if old_sid in room["roles"]:
            room["roles"][sid] = room["roles"].pop(old_sid)

        if room["spawnerId"] == old_sid:
            room["spawnerId"] = sid
        if room["catcherId"] == old_sid:
            room["catcherId"] = sid
        if room["hostId"] == old_sid:
            room["hostId"] = sid

        await sio.enter_room(sid, code)
        await broadcast(room)

        print(f"Player {name} reconnected to room {code}")
        return {"ok": True, "code": code, "reconnected": True}

    if room["status"] != "waiting" or len(room["players"]) >= 2:
        return {"error": "This room is already full."}

    room["players"].append({"id": sid, "name": name})
    room["scores"][sid] = 0

    await sio.enter_room(sid, code)
    await broadcast(room)

    return {"ok": True, "code": code}


@sio.on("setLetterCount")
async def set_letter_count(sid, payload=None):
    payload = payload or {}
    room = get_room_for_player(sid)

    if not room:
        return {"error": "Join a room first."}
    if sid != room["hostId"]:
        return {"error": "Only the host can change letter count."}
    if room["status"] != "waiting":
        return {
            "error": "Letter count can only be changed before the game starts."
        }

    try:
        count = int(payload.get("count"))
    except (TypeError, ValueError):
        return {
            "error": "Choose 4, 6, 8, 12, 16, 20, 24, or 26 letters."
        }

    if count not in LETTER_OPTIONS:
        return {
            "error": "Choose 4, 6, 8, 12, 16, 20, 24, or 26 letters."
        }

    room["letterCount"] = count
    room["message"] = f"GAME SET TO {count} LETTERS"

    await broadcast(room)
    return {"ok": True}


@sio.on("startGame")
async def start_game(sid):
    room = get_room_for_player(sid)

    if not room:
        return {"error": "Join a room first."}
    if sid != room["hostId"]:
        return {"error": "Only the host can start the game."}
    if len(room["players"]) != 2:
        return {"error": "Two players are required."}
    if room["status"] != "waiting":
        return {"error": "Game already started."}

    room["round"] = 1
    room["scores"] = {player["id"]: 0 for player in room["players"]}

    await begin_round(room)
    return {"ok": True}
@sio.on("replay")
async def replay(sid):
    room = get_room_for_player(sid)

    if not room:
        return {"error": "Join a room first."}
    if room["phase"] != "finished":
        return {"error": "Replay is available after the match finishes."}
    if len(room["players"]) != 2:
        return {"error": "Both players must be in the room to replay."}

    room.setdefault("replayVotes", set()).add(sid)

    if all(player["id"] in room["replayVotes"] for player in room["players"]):
        room["replayVotes"].clear()
        room["round"] = 1
        room["scores"] = {player["id"]: 0 for player in room["players"]}
        room["combo"] = 0
        room["nextIndex"] = 0
        room["lastEvent"] = None
        await begin_round(room)
        return {"ok": True, "started": True}

    await broadcast(room)
    return {"ok": True, "waitingForOpponent": True}


@sio.on("placeLetter")
async def place_letter(sid, payload=None):
    payload = payload or {}
    room = get_room_for_player(sid)

    if not room or room["phase"] != "placing":
        return {"error": "Letter placement is not active."}
    if sid != room["spawnerId"]:
        return {"error": "You are not the Spawner."}

    x, y = payload.get("x"), payload.get("y")

    # bool is a subclass of int in Python, so reject it explicitly.
    if (
        isinstance(x, bool) or not isinstance(x, int)
        or isinstance(y, bool) or not isinstance(y, int)
        or not 0 <= x < COLS
        or not 0 <= y < ROWS
    ):
        return {"error": "Invalid grid cell."}

    letters = get_letters(room["letterCount"])
    letter = next(
        (item for item in letters if item not in room["letters"]),
        None,
    )

    if letter is None:
        return {"error": "All letters are placed."}

    if any(
        entry["x"] == x and entry["y"] == y
        for entry in room["letters"].values()
    ):
        return {"error": "Cell already occupied."}

    room["letters"][letter] = {"letter": letter, "x": x, "y": y}
    room["lastEvent"] = f"{letter} PLACED"

    if len(room["letters"]) == len(letters):
        room["message"] = "ALL LETTERS PLACED — WAIT FOR REVEAL!"
    else:
        room["message"] = f"PLACE {letters[len(room['letters'])]} NEXT"

    await broadcast(room)
    return {"ok": True, "letter": letter}


@sio.on("move")
async def move(sid, payload=None):
    payload = payload or {}
    room = get_room_for_player(sid)

    if not room or room["phase"] not in ("placing", "playing"):
        return {"error": "The Catcher cannot move right now."}
    if sid != room["catcherId"]:
        return {"error": "Only the Catcher can move."}

    now = time.monotonic()
    if now - room["lastMoveAt"] < 0.1:
        return {"error": "Move too quickly."}

    dx, dy = payload.get("dx"), payload.get("dy")

    if (
        isinstance(dx, bool) or not isinstance(dx, int)
        or isinstance(dy, bool) or not isinstance(dy, int)
        or abs(dx) + abs(dy) != 1
    ):
        return {"error": "Invalid movement."}

    next_position = {
        "x": room["catcherPosition"]["x"] + dx,
        "y": room["catcherPosition"]["y"] + dy,
    }

    if (
        not 0 <= next_position["x"] < COLS
        or not 0 <= next_position["y"] < ROWS
    ):
        return {"error": "Out of bounds."}

    room["lastMoveAt"] = now
    room["catcherPosition"] = next_position

    if room["phase"] == "placing":
        await broadcast(room)
        return {"ok": True}

    hit = next(
        (
            entry for entry in room["letters"].values()
            if entry["x"] == next_position["x"]
            and entry["y"] == next_position["y"]
            and not entry.get("collected", False)
        ),
        None,
    )

    if hit:
        letters = get_letters(room["letterCount"])
        expected = letters[room["nextIndex"]]

        if hit["letter"] == expected:
            hit["collected"] = True
            room["nextIndex"] += 1
            room["combo"] += 1

            points = 100 + max(0, room["combo"] - 1) * 10
            room["scores"][sid] += points
            room["lastEvent"] = f"+{points} · {hit['letter']} CAUGHT"

            room["message"] = (
                "ALL LETTERS CAUGHT!"
                if room["nextIndex"] == len(letters)
                else f"NEXT LETTER: {letters[room['nextIndex']]}"
            )

            if room["nextIndex"] == len(letters):
                await broadcast(room)
                await end_round(room, "ALPHABET COMPLETE!")
                return {"ok": True}
        else:
            room["combo"] = 0
            room["lastEvent"] = (
                f"WRONG LETTER: {hit['letter']} · NEED {expected}"
            )
            room["message"] = f"WRONG LETTER! FIND {expected} NEXT"
    else:
        room["lastEvent"] = None

    await broadcast(room)
    return {"ok": True}


@sio.event
async def disconnect(sid, reason=None):
    for code, room in list(rooms.items()):
        player = get_player(room, sid)
        if not player:
            continue

        room["disconnectedPlayers"][sid] = {
            "name": player["name"],
            "disconnectedAt": time.time(),
        }

        async def expire_room(
            room_code=code,
            target_room=room,
            disconnected_sid=sid,
        ):
            try:
                await asyncio.sleep(30)

                if rooms.get(room_code) is not target_room:
                    return
                if disconnected_sid not in target_room["disconnectedPlayers"]:
                    return

                await cancel_room_tasks(target_room)
                rooms.pop(room_code, None)

                await sio.emit(
                    "roomClosed",
                    {"message": "A player disconnected. The room has closed."},
                    room=room_code,
                )

                print(f"Room {room_code} closed after reconnect timeout")
            except asyncio.CancelledError:
                pass

        old_task = room["disconnectTasks"].get(sid)
        if old_task and not old_task.done():
            old_task.cancel()

        room["disconnectTasks"][sid] = asyncio.create_task(expire_room())

        print(
            f"Player {player['name']} disconnected from room {code}. "
            "Waiting 30 seconds for reconnect."
        )
        break


# --------------------------------------------------
# START SERVER
# --------------------------------------------------

if __name__ == "__main__":
    print(f"LETTER DASH Python server starting on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
