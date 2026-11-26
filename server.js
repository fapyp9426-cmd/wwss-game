
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const WORLD = { width: 1800, height: 1200 };
const RADIUS = 25;
const SPEED = 260;
const TICK = 33;

io.on("connection", socket => {
  socket.on("join", rawCode => {
    const code = String(rawCode || "").trim().toUpperCase();

    if (!/^[A-Z0-9]{3,12}$/.test(code)) return;
    if (socket.data.room) return;

    rooms[code] ??= {};

    if (Object.keys(rooms[code]).length >= 2) {
      socket.emit("errorMessage", "Комната заполнена!");
      return;
    }

    const count = Object.keys(rooms[code]).length;

    const player = {
      id: socket.id,
      x: count === 0 ? 650 : 850,
      y: 600,
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      faceX: count === 0 ? 1 : -1,
      faceY: 0,
      lastPunch: 0
    };

    rooms[code][socket.id] = player;
    socket.data.room = code;
    socket.join(code);

    socket.emit("joined", socket.id);
    io.to(code).emit("players", Object.values(rooms[code]));
  });

  socket.on("input", data => {
    const code = socket.data.room;
    const player = rooms[code]?.[socket.id];

    if (!player || !data) return;

    let x = Number(data.x) || 0;
    let y = Number(data.y) || 0;

    const length = Math.hypot(x, y);

    if (length > 1) {
      x /= length;
      y /= length;
    }

    player.inputX = x;
    player.inputY = y;

    if (length > 0.05) {
      player.faceX = x / Math.max(length, 1);
      player.faceY = y / Math.max(length, 1);
    }
  });

  socket.on("punch", () => {
    const code = socket.data.room;
    const room = rooms[code];
    const player = room?.[socket.id];

    if (!player) return;

    const now = Date.now();

    if (now - player.lastPunch < 650) return;

    player.lastPunch = now;

    for (const other of Object.values(room)) {
      if (other.id === player.id) continue;

      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const distance = Math.hypot(dx, dy);

      if (distance < 120) {
        const nx = distance > 0.01 ? dx / distance : player.faceX;
        const ny = distance > 0.01 ? dy / distance : player.faceY;

        const facingDot = nx * player.faceX + ny * player.faceY;

        if (facingDot > -0.25) {
          other.vx += nx * 420;
          other.vy += ny * 420;
        }
      }
    }

    io.to(code).emit("punchEffect", {
      id: player.id,
      time: now
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;

    if (!code || !rooms[code]) return;

    delete rooms[code][socket.id];

    io.to(code).emit("players", Object.values(rooms[code]));

    if (!Object.keys(rooms[code]).length) {
      delete rooms[code];
    }
  });
});

setInterval(() => {
  for (const [code, room] of Object.entries(rooms)) {
    const players = Object.values(room);

    for (const p of players) {
      p.vx += p.inputX * SPEED * 0.16;
      p.vy += p.inputY * SPEED * 0.16;

      p.vx *= 0.84;
      p.vy *= 0.84;

      const speed = Math.hypot(p.vx, p.vy);

      if (speed > SPEED) {
        p.vx = p.vx / speed * SPEED;
        p.vy = p.vy / speed * SPEED;
      }

      p.x += p.vx * TICK / 1000;
      p.y += p.vy * TICK / 1000;

      p.x = Math.max(RADIUS, Math.min(WORLD.width - RADIUS, p.x));
      p.y = Math.max(RADIUS, Math.min(WORLD.height - RADIUS, p.y));
    }

    if (players.length === 2) {
      const [a, b] = players;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);

      if (distance < RADIUS * 2) {
        if (distance < 0.01) {
          dx = 1;
          dy = 0;
          distance = 1;
        }

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = RADIUS * 2 - distance;

        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        const relative =
          (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;

        if (relative < 0) {
          const impulse = -relative * 0.65;

          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }

        a.x = Math.max(RADIUS, Math.min(WORLD.width - RADIUS, a.x));
        a.y = Math.max(RADIUS, Math.min(WORLD.height - RADIUS, a.y));
        b.x = Math.max(RADIUS, Math.min(WORLD.width - RADIUS, b.x));
        b.y = Math.max(RADIUS, Math.min(WORLD.height - RADIUS, b.y));
      }
    }

    io.to(code).emit("players", players);
  }
}, TICK);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});
