# LETTER DASH

**One Creates the Chaos. The Other Restores Order.**

LETTER DASH is a competitive real-time multiplayer alphabet-catching
game. One player places letters around the board in a mixed order; the
other catches them in alphabetical order. Players swap roles across two
rounds, and the highest score wins.

## Features

-   Real-time multiplayer rooms with room codes
-   Two-player gameplay with alternating roles across two rounds
-   Customizable alphabet length: 4, 6, 8, 12, 16, 20, 24, or 26 letters
-   Server-controlled game state and synchronized match settings
-   Spawner placement phase with a timer that scales by alphabet length
-   Catcher phase with a time limit that scales by alphabet length
-   WASD and arrow-key movement
-   Score and combo bonuses
-   Dark, retro-inspired neon interface

## Tech stack

-   **Frontend:** React, TypeScript, Vite, Socket.IO Client
-   **Backend:** Node.js, Express, Socket.IO
-   **Development tools:** npm, TypeScript, ESLint, Nodemon

## Project structure

``` text
letter-dash/
├── backend/
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.ts
└── .gitignore
```

## Prerequisites

-   Node.js (use a current supported LTS release)
-   npm (included with Node.js)
-   Git, if you are cloning the repository

Check your installed versions:

``` bash
node --version
npm --version
```

## Run locally

Clone the repository:

``` bash
git clone https://github.com/ianjmathew039-rgb/letter-dash.git
cd letter-dash
```

### 1. Start the backend

Open a terminal:

``` bash
cd backend
npm install
npm run dev
```

The backend starts on port `3000` unless the server configuration
specifies otherwise. Keep this terminal running.

### 2. Start the frontend

Open a second terminal from the project root:

``` bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, typically `http://localhost:5173`.

Keep both the backend and frontend running while you play.

## Local network multiplayer

To let another device on the same local network open the frontend, start
Vite with:

``` bash
npm run dev -- --host 0.0.0.0
```

The other device can visit `http://<HOST-PC-IP>:5173`.

The frontend must connect to the host machine's reachable backend
address, and the backend's Socket.IO CORS configuration must allow the
frontend origin. For a local network setup, configure the frontend's
`VITE_SERVER_URL` environment variable in `frontend/.env`, for example:

``` dotenv
VITE_SERVER_URL=http://<HOST-PC-IP>:3000
```

Replace `<HOST-PC-IP>` with the host computer's local IP address. Do not
commit `.env` files; the repository's `.gitignore` excludes them. Local
IP addresses can change when the network changes.

## Available scripts

### Backend (`backend/`)

-   `npm run dev` --- run the server with Nodemon
-   `npm start` --- run the server with Node.js

### Frontend (`frontend/`)

-   `npm run dev` --- start the Vite development server
-   `npm run build` --- type-check and build the production frontend
-   `npm run preview` --- preview the production build locally
-   `npm run lint` --- run ESLint

Build the frontend:

``` bash
cd frontend
npm install
npm run build
```

## Game overview

1.  Create a room and share its room code with another player.
2.  The Spawner places the selected number of letters around the board.
3.  The Catcher collects the letters in alphabetical order before time
    runs out.
4.  Players swap roles for the second round.
5.  Scores from both rounds determine the result.

## Deployment status

The repository contains the game's source code. It is **not
automatically deployed** by uploading it to GitHub. The frontend and
Socket.IO backend need to be hosted and configured separately for public
online play.

## Contributing

Issues and improvements are welcome. Before opening a pull request, run
the frontend build and lint checks.

## License

No license has been added yet. Unless a license is added, normal
copyright restrictions apply and others do not automatically have
permission to reuse, modify, or distribute this code.
