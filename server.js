const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", socket => {
  socket.on("join", code => {
    code = String(code).trim().toUpperCase();

    if (!/^[A-Z0-9]{3,12}$/.test(code)) return;

    rooms[code] ??= {};

    if (Object.keys(rooms[code]).length >= 2) {
      socket.emit("errorMessage", "Комната заполнена!");
      return;
    }

    socket.data.room = code;

    rooms[code][socket.id] = {
      id: socket.id,
      x: Object.keys(rooms[code]).length ? 500 : 150,
      y: 200
    };

    socket.join(code);
    socket.emit("joined", socket.id);

    io.to(code).emit("players", Object.values(rooms[code]));
  });

  socket.on("move", ({x, y}) => {
    const code = socket.data.room;
    if (!code || !rooms[code]?.[socket.id]) return;

    const player = rooms[code][socket.id];

    player.x = Math.max(20, Math.min(680, x));
    player.y = Math.max(40, Math.min(360, y));

    io.to(code).emit("players", Object.values(rooms[code]));
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (!code || !rooms[code]) return;

    delete rooms[code][socket.id];

    io.to(code).emit("players", Object.values(rooms[code]));

    if (!Object.keys(rooms[code]).length) delete rooms[code];
  });
});

server.listen(3000, () =>
  console.log("Игра: http://localhost:3000")
);