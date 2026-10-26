# LETTER DASH

**One Creates the Chaos. The Other Restores Order.**

LETTER DASH is a real-time, two-player multiplayer game. One player places letters around the board, while the other catches them in alphabetical order. Players swap roles across two rounds, and the highest score wins.

## Features

- Real-time multiplayer with room codes
- Two rounds with alternating roles
- Customizable alphabet length (4–26 letters)
- Timed placement and catching phases
- WASD and arrow-key movement
- Score, combo, and completion bonuses
- Local-network multiplayer support

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Socket.IO Client
- **Backend:** Python, Socket.IO, Uvicorn

## Project Structure

```text
letter-dash/
├── backend/
│   ├── server.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── requirements.txt
├── .gitignore
└── README.md
```

## Run Locally

Clone the repository and switch to the development branch:

```bash
git clone https://github.com/ianjmathew039-rgb/letter-dash.git
cd letter-dash
git switch python-backend
```

Start the Python backend from the project root:

```bash
python -m venv .venv-python
.\.venv-python\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 0.0.0.0 --port 3000
```

In a second terminal, start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Local Network Multiplayer

To play on two computers connected to the same network:

1. Start the backend with `--host 0.0.0.0`.
2. Start Vite with `npm run dev -- --host 0.0.0.0`.
3. Set `VITE_SERVER_URL=http://<HOST-PC-IP>:3000` in `frontend/.env`.
4. Open `http://<HOST-PC-IP>:5173` on the second computer.

Replace `<HOST-PC-IP>` with the host computer's local IP address. Ensure the firewall permits the connections. Do not commit `.env` files.

## Build and Lint

Run from `frontend/`:

```bash
npm run build
npm run lint
```

## Deployment

LETTER DASH currently supports local and local-network play. Public multiplayer requires hosting the frontend and backend separately.

## License

No license has been added yet, so normal copyright restrictions apply.