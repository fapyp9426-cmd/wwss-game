
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
const SPEED = 270;
const TICK = 20;

const COLORS = [
  "#5267e8",
  "#ef795f",
  "#29b58a",
  "#e0a33b",
  "#ad72dc",
  "#39a9c8",
  "#e56b9b",
  "#687586"
];

function cleanName(value) {
  return String(value || "Игрок")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Игрок";
}

function snapshot(room) {
  return Object.values(room).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    faceX: p.faceX,
    faceY: p.faceY,
    downUntil: p.downUntil
  }));
}

io.on("connection", socket => {
  socket.on("join", data => {
    if (socket.data.room) return;

    const code = String(data?.code || "")
      .trim().toUpperCase();

    if (!/^[A-Z0-9]{3,12}$/.test(code)) {
      socket.emit("errorMessage", "Код комнаты: 3–12 букв или цифр");
      return;
    }

    rooms[code] ??= {};

    if (Object.keys(rooms[code]).length >= 2) {
      socket.emit("errorMessage", "Комната уже заполнена!");
      return;
    }

    const count = Object.keys(rooms[code]).length;
    const color = COLORS.includes(data?.color)
      ? data.color
      : COLORS[count];

    const player = {
      id: socket.id,
      name: cleanName(data?.name),
      color,
      x: count === 0 ? 650 : 850,
      y: 600,
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      faceX: count === 0 ? 1 : -1,
      faceY: 0,
      downUntil: 0,
      lastPunch: 0
    };

    rooms[code][socket.id] = player;
    socket.data.room = code;
    socket.join(code);

    socket.emit("joined", socket.id);
    io.to(code).emit("players", snapshot(rooms[code]));
  });

  socket.on("input", data => {
    const player = rooms[socket.data.room]?.[socket.id];
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

    if (length > 0.05 && Date.now() >= player.downUntil) {
      player.faceX = x / length;
      player.faceY = y / length;
    }
  });

  socket.on("punch", () => {
    const code = socket.data.room;
    const room = rooms[code];
    const player = room?.[socket.id];

    if (!player) return;

    const now = Date.now();

    if (now < player.downUntil || now - player.lastPunch < 700) {
      return;
    }

    player.lastPunch = now;

    let hitId = null;

    for (const other of Object.values(room)) {
      if (other.id === player.id) continue;
      if (now < other.downUntil) continue;

      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const distance = Math.hypot(dx, dy);

      if (distance > 125) continue;

      const nx = distance > 0.01 ? dx / distance : player.faceX;
      const ny = distance > 0.01 ? dy / distance : player.faceY;
      const facing = nx * player.faceX + ny * player.faceY;

      if (facing < -0.15) continue;

      other.downUntil = now + 1250;
      other.vx += nx * 470;
      other.vy += ny * 470;

      player.vx -= nx * 35;
      player.vy -= ny * 35;

      hitId = other.id;
      break;
    }

    io.to(code).emit("punchEffect", {
      attacker: player.id,
      target: hitId,
      x: player.x + player.faceX * 38,
      y: player.y + player.faceY * 38,
      time: now
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (!code || !rooms[code]) return;

    delete rooms[code][socket.id];
    io.to(code).emit("players", snapshot(rooms[code]));

    if (!Object.keys(rooms[code]).length) {
      delete rooms[code];
    }
  });
});

// Серверная физика
setInterval(() => {
  const dt = TICK / 1000;
  const now = Date.now();

  for (const [code, room] of Object.entries(rooms)) {
    const players = Object.values(room);

    for (const p of players) {
      if (now >= p.downUntil) {
        const targetVX = p.inputX * SPEED;
        const targetVY = p.inputY * SPEED;

        p.vx += (targetVX - p.vx) * Math.min(1, dt * 12);
        p.vy += (targetVY - p.vy) * Math.min(1, dt * 12);
      } else {
        p.vx *= 0.985;
        p.vy *= 0.985;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

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
          const impulse = -relative * 0.55;

          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
    }

    io.to(code).emit("players", snapshot(room));
  }
}, TICK);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});
