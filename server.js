/**
 * BASE WARS — Серверно-авторитетный игровой сервер (Node.js + Express + Socket.IO)
 * Частота симуляции: 30 Гц | Частота рассылки состояния: 20 Гц
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// БАЛАНС И КОНФИГУРАЦИЯ МИРА
// ============================================================================
const CONFIG = {
  TICK_RATE: 30,
  BROADCAST_RATE: 20,
  WORLD_WIDTH: 7200,
  WORLD_HEIGHT: 1600,
  GROUND_BASE_Y: 1280,
  MATCH_DURATION: 600, // 10 минут (600 секунд)
  RESPAWN_TIME: 3.0,   // 3 секунды до возрождения

  // Экономика
  START_CREDITS: 350,
  PASSIVE_INCOME_PER_SEC: 8,
  FLAG_HOLD_CREDITS_PER_SEC: 12,
  FLAG_HOLD_POINTS_PER_SEC: 2.5,
  FLAG_CAPTURE_POINTS: 50,
  FLAG_CAPTURE_CREDITS: 150,
  ELIMINATION_CREDITS: 120,
  ELIMINATION_POINTS: 25,
  VEHICLE_DESTROY_POINTS: 40,

  // Солдат
  SOLDIER: {
    WIDTH: 34,
    HEIGHT: 64,
    MAX_HP: 100,
    WALK_SPEED: 260,
    RUN_SPEED: 410,
    JUMP_FORCE: -660,
    GRAVITY: 1650,
    FIRE_COOLDOWN: 0.22,
    BULLET_SPEED: 1350,
    BULLET_DAMAGE: 22
  },

  // Флаг
  FLAG: {
    X: 3600,
    RADIUS: 240,
    CAPTURE_SPEED: 0.22
  },

  // Магазин и техника
  SHOP: {
    buggy: {
      id: 'buggy',
      name: 'Лёгкий багги',
      category: 'ground',
      cost: 250,
      maxHp: 260,
      speed: 620,
      accel: 1200,
      width: 116,
      height: 54,
      fireCooldown: 0.25,
      damage: 20,
      projectileSpeed: 1400,
      limitPerTeam: 2,
      rewardCredits: 150
    },
    apc: {
      id: 'apc',
      name: 'Бронемашина',
      category: 'ground',
      cost: 500,
      maxHp: 560,
      speed: 410,
      accel: 750,
      width: 156,
      height: 72,
      fireCooldown: 0.45,
      damage: 42,
      projectileSpeed: 1250,
      limitPerTeam: 2,
      rewardCredits: 280
    },
    tank: {
      id: 'tank',
      name: 'Тяжёлый танк',
      category: 'ground',
      cost: 850,
      maxHp: 1100,
      speed: 255,
      accel: 450,
      width: 184,
      height: 82,
      fireCooldown: 1.35,
      damage: 145,
      splashRadius: 110,
      projectileSpeed: 1150,
      limitPerTeam: 1,
      rewardCredits: 480
    },
    helicopter: {
      id: 'helicopter',
      name: 'Ударный вертолёт',
      category: 'air',
      cost: 750,
      maxHp: 460,
      speed: 520,
      liftSpeed: 420,
      width: 170,
      height: 68,
      fireCooldown: 0.35,
      damage: 36,
      projectileSpeed: 1300,
      limitPerTeam: 1,
      rewardCredits: 420
    },
    plane: {
      id: 'plane',
      name: 'Беспилотный самолёт',
      category: 'air',
      cost: 650,
      maxHp: 340,
      minSpeed: 360,
      maxSpeed: 780,
      width: 164,
      height: 48,
      fireCooldown: 0.42,
      damage: 48,
      projectileSpeed: 1450,
      limitPerTeam: 1,
      rewardCredits: 380
    },
    aa_turret: {
      id: 'aa_turret',
      name: 'Автоматическая ПВО',
      category: 'defense',
      cost: 450,
      maxHp: 500,
      range: 1350,
      fireCooldown: 0.95,
      damage: 55,
      missileSpeed: 1250,
      limitPerTeam: 2,
      rewardCredits: 250
    },
    base_shield: {
      id: 'base_shield',
      name: 'Укрепление и медблок базы',
      category: 'upgrade',
      cost: 400,
      maxLevel: 3
    }
  }
};

// ============================================================================
// ГЕНЕРАЦИЯ РЕЛЬЕФА И ПРЕПЯТСТВИЙ КАРТЫ
// ============================================================================
function getTerrainHeightAt(x) {
  const clampedX = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, x));
  if (clampedX < 950 || clampedX > CONFIG.WORLD_WIDTH - 950) {
    return CONFIG.GROUND_BASE_Y;
  }
  if (clampedX > 3250 && clampedX < 3950) {
    return CONFIG.GROUND_BASE_Y - 35;
  }

  const norm = (clampedX - 950) / (6250 - 950);
  const envelope = Math.sin(norm * Math.PI);
  const hill1 = Math.sin((clampedX - 950) * 0.0024) * 95;
  const hill2 = Math.cos((clampedX - 950) * 0.0055) * 32;
  return Math.round(CONFIG.GROUND_BASE_Y - (hill1 + hill2) * envelope);
}

const MAP_PLATFORMS = [
  { id: 'b_tower_1', x: 520, y: 1120, w: 180, h: 22, type: 'bridge' },
  { id: 'b_bunker', x: 1080, y: 1170, w: 150, h: 24, type: 'bunker' },
  { id: 'mid_left_plat', x: 2450, y: 1110, w: 220, h: 22, type: 'platform' },
  { id: 'mid_center_arch', x: 3470, y: 1080, w: 260, h: 22, type: 'bridge' },
  { id: 'mid_right_plat', x: 4530, y: 1110, w: 220, h: 22, type: 'platform' },
  { id: 'r_bunker', x: 5970, y: 1170, w: 150, h: 24, type: 'bunker' },
  { id: 'r_tower_1', x: 6500, y: 1120, w: 180, h: 22, type: 'bridge' }
];

// ============================================================================
// ХРАНИЛИЩЕ КОМНАТ И СЕССИЙ
// ============================================================================
const rooms = new Map();
const socketToSession = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[<>&"'/\\]/g, '').trim().slice(0, 18);
}

function createInitialMatchState() {
  return {
    timeLeft: CONFIG.MATCH_DURATION,
    scores: { blue: 0, red: 0 },
    flag: {
      x: CONFIG.FLAG.X,
      y: getTerrainHeightAt(CONFIG.FLAG.X),
      progress: 0,
      owner: null,
      contested: false,
      capturingTeam: null
    },
    baseUpgrades: {
      blue: 0,
      red: 0
    },
    vehicles: [],
    projectiles: [],
    events: [],
    nextEntityId: 1
  };
}

function createPlayerObject(socketId, token, nickname, team, isHost) {
  const spawnX = team === 'blue' ? 340 : CONFIG.WORLD_WIDTH - 340;
  const spawnY = getTerrainHeightAt(spawnX) - CONFIG.SOLDIER.HEIGHT;
  return {
    id: socketId,
    token,
    nickname,
    team,
    isHost,
    ready: false,
    connected: true,
    disconnectTimer: null,

    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    facing: team === 'blue' ? 1 : -1,
    aimAngle: team === 'blue' ? 0 : Math.PI,
    hp: CONFIG.SOLDIER.MAX_HP,
    maxHp: CONFIG.SOLDIER.MAX_HP,
    alive: true,
    respawnTimer: 0,
    onGround: true,
    animState: 'idle',
    vehicleId: null,
    fireCooldown: 0,
    hitFlash: 0,

    credits: CONFIG.START_CREDITS,
    totalCreditsEarned: CONFIG.START_CREDITS,
    kills: 0,
    deaths: 0,
    captures: 0,
    vehiclesDestroyed: 0,

    input: {
      left: false,
      right: false,
      up: false,
      down: false,
      sprint: false,
      fire: false,
      aimX: spawnX + (team === 'blue' ? 200 : -200),
      aimY: spawnY
    },
    lastRateReset: Date.now(),
    msgCount: 0
  };
}

function getRoomLobbyPayload(room) {
  return {
    code: room.code,
    status: room.status,
    hostToken: room.hostToken,
    countdownValue: room.countdownValue,
    players: room.players.map(p => ({
      nickname: p.nickname,
      team: p.team,
      ready: p.ready,
      connected: p.connected,
      isHost: p.token === room.hostToken
    }))
  };
}

// ============================================================================
// АВТОЗАПУСК ЧЕРЕЗ 3 СЕКУНДЫ ПОСЛЕ ГОТОВНОСТИ ОБОИХ ИГРОКОВ
// ============================================================================
function clearRoomCountdown(room) {
  if (!room) return;
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  if (room.countdownValue !== null && room.countdownValue !== undefined) {
    room.countdownValue = null;
    io.to(room.code).emit('countdown_cancelled');
  }
}

function checkAutoStartCountdown(room) {
  if (!room || room.status !== 'lobby') return;

  const bothReady =
    room.players.length === 2 &&
    room.players.every(p => p.connected && p.nickname.length > 0 && p.ready);

  if (!bothReady) {
    clearRoomCountdown(room);
    return;
  }

  if (room.countdownTimer) return;

  room.countdownValue = 3;
  io.to(room.code).emit('match_countdown', { seconds: room.countdownValue });

  room.countdownTimer = setInterval(() => {
    if (!rooms.has(room.code) || room.status !== 'lobby') {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      return;
    }

    const stillReady =
      room.players.length === 2 &&
      room.players.every(p => p.connected && p.nickname.length > 0 && p.ready);

    if (!stillReady) {
      clearRoomCountdown(room);
      return;
    }

    room.countdownValue -= 1;

    if (room.countdownValue > 0) {
      io.to(room.code).emit('match_countdown', { seconds: room.countdownValue });
    } else {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      room.countdownValue = null;
      startMatch(room);
    }
  }, 1000);
}

// ============================================================================
// ЛОГИКА МАТЧА И СИМУЛЯЦИЯ
// ============================================================================
function startMatch(room) {
  clearRoomCountdown(room);
  room.status = 'playing';
  room.match = createInitialMatchState();
  room.winner = null;

  room.players.forEach(p => {
    const spawnX = p.team === 'blue' ? 340 : CONFIG.WORLD_WIDTH - 340;
    p.x = spawnX;
    p.y = getTerrainHeightAt(spawnX) - CONFIG.SOLDIER.HEIGHT;
    p.vx = 0;
    p.vy = 0;
    p.facing = p.team === 'blue' ? 1 : -1;
    p.hp = CONFIG.SOLDIER.MAX_HP;
    p.maxHp = CONFIG.SOLDIER.MAX_HP;
    p.alive = true;
    p.respawnTimer = 0;
    p.vehicleId = null;
    p.credits = CONFIG.START_CREDITS;
    p.totalCreditsEarned = CONFIG.START_CREDITS;
    p.kills = 0;
    p.deaths = 0;
    p.captures = 0;
    p.vehiclesDestroyed = 0;
  });

  spawnVehicle(room, 'blue', 'buggy', 620);
  spawnVehicle(room, 'red', 'buggy', CONFIG.WORLD_WIDTH - 620);

  io.to(room.code).emit('match_started', {
    config: {
      WORLD_WIDTH: CONFIG.WORLD_WIDTH,
      WORLD_HEIGHT: CONFIG.WORLD_HEIGHT,
      GROUND_BASE_Y: CONFIG.GROUND_BASE_Y,
      FLAG_X: CONFIG.FLAG.X,
      FLAG_RADIUS: CONFIG.FLAG.RADIUS,
      SHOP: CONFIG.SHOP,
      PLATFORMS: MAP_PLATFORMS
    }
  });
}

function spawnVehicle(room, team, type, customX = null) {
  const spec = CONFIG.SHOP[type];
  if (!spec) return null;

  const baseX = customX !== null
    ? customX
    : (team === 'blue' ? 560 + Math.random() * 240 : CONFIG.WORLD_WIDTH - 560 - Math.random() * 240);

  const groundY = getTerrainHeightAt(baseX);
  const isAir = spec.category === 'air';
  const y = isAir ? groundY - spec.height - 6 : groundY - spec.height;

  const vehicle = {
    id: `veh_${room.match.nextEntityId++}`,
    type,
    team,
    x: baseX,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    facing: team === 'blue' ? 1 : -1,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    driverToken: null,
    fireCooldown: 0,
    targetId: null,
    rotorAngle: 0
  };

  room.match.vehicles.push(vehicle);
  return vehicle;
}

function addMatchEvent(room, type, data) {
  room.match.events.push({
    id: room.match.nextEntityId++,
    type,
    ...data
  });
}

function damageSoldier(room, target, amount, attackerPlayer) {
  if (!target.alive) return;

  const nearOwnBase = (target.team === 'blue' && target.x < 1100) ||
                      (target.team === 'red' && target.x > CONFIG.WORLD_WIDTH - 1100);
  const upgradeLvl = room.match.baseUpgrades[target.team] || 0;
  const mitigation = nearOwnBase ? (1 - upgradeLvl * 0.12) : 1;

  target.hp -= Math.round(amount * mitigation);
  target.hitFlash = 0.2;

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.respawnTimer = CONFIG.RESPAWN_TIME;
    target.deaths += 1;
    target.vx = 0;
    target.vy = 0;

    if (target.vehicleId) {
      const veh = room.match.vehicles.find(v => v.id === target.vehicleId);
      if (veh && veh.driverToken === target.token) {
        veh.driverToken = null;
      }
      target.vehicleId = null;
    }

    addMatchEvent(room, 'soldier_down', {
      x: target.x + CONFIG.SOLDIER.WIDTH / 2,
      y: target.y + CONFIG.SOLDIER.HEIGHT / 2,
      team: target.team,
      victim: target.nickname,
      attacker: attackerPlayer ? attackerPlayer.nickname : 'Система'
    });

    if (attackerPlayer && attackerPlayer.team !== target.team) {
      attackerPlayer.kills += 1;
      attackerPlayer.credits += CONFIG.ELIMINATION_CREDITS;
      attackerPlayer.totalCreditsEarned += CONFIG.ELIMINATION_CREDITS;
      room.match.scores[attackerPlayer.team] += CONFIG.ELIMINATION_POINTS;
    }
  }
}

function damageVehicle(room, vehicle, amount, attackerPlayer) {
  vehicle.hp -= amount;
  if (vehicle.hp <= 0) {
    vehicle.hp = 0;
    const spec = CONFIG.SHOP[vehicle.type];

    if (vehicle.driverToken) {
      const driver = room.players.find(p => p.token === vehicle.driverToken);
      if (driver) {
        driver.vehicleId = null;
        driver.y = Math.min(driver.y, getTerrainHeightAt(driver.x) - CONFIG.SOLDIER.HEIGHT - 10);
        driver.vy = -320;
        damageSoldier(room, driver, 30, attackerPlayer);
      }
    }

    addMatchEvent(room, 'explosion', {
      x: vehicle.x,
      y: vehicle.y + (spec ? spec.height / 2 : 30),
      size: vehicle.type === 'tank' ? 'large' : 'medium',
      team: vehicle.team
    });

    if (attackerPlayer && attackerPlayer.team !== vehicle.team && spec) {
      attackerPlayer.vehiclesDestroyed += 1;
      attackerPlayer.credits += spec.rewardCredits;
      attackerPlayer.totalCreditsEarned += spec.rewardCredits;
      room.match.scores[attackerPlayer.team] += CONFIG.VEHICLE_DESTROY_POINTS;
    }

    room.match.vehicles = room.match.vehicles.filter(v => v.id !== vehicle.id);
  }
}

function updateRoomSimulation(room, dt) {
  if (room.status !== 'playing' || !room.match) return;
  const m = room.match;

  m.timeLeft -= dt;
  if (m.timeLeft <= 0) {
    m.timeLeft = 0;
    finishMatch(room);
    return;
  }

  room.players.forEach(p => {
    const income = CONFIG.PASSIVE_INCOME_PER_SEC * dt;
    p.credits += income;
    p.totalCreditsEarned += income;

    const upgradeLvl = m.baseUpgrades[p.team] || 0;
    if (upgradeLvl > 0 && p.alive && !p.vehicleId) {
      const onBase = (p.team === 'blue' && p.x < 950) || (p.team === 'red' && p.x > CONFIG.WORLD_WIDTH - 950);
      if (onBase && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + upgradeLvl * 14 * dt);
      }
    }
  });

  room.players.forEach(p => {
    if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);

    if (!p.alive) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        const spawnX = p.team === 'blue' ? 340 : CONFIG.WORLD_WIDTH - 340;
        p.x = spawnX;
        p.y = getTerrainHeightAt(spawnX) - CONFIG.SOLDIER.HEIGHT;
        p.vx = 0;
        p.vy = 0;
        p.hp = p.maxHp;
        p.alive = true;
        p.respawnTimer = 0;
        p.animState = 'idle';
        addMatchEvent(room, 'respawn', { x: p.x + 17, y: p.y + 32, team: p.team });
      }
      return;
    }

    if (p.vehicleId) {
      const veh = m.vehicles.find(v => v.id === p.vehicleId);
      if (!veh) {
        p.vehicleId = null;
      } else {
        updateControlledVehicle(room, p, veh, dt);
        return;
      }
    }

    const inp = p.input;
    const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const maxSpeed = inp.sprint ? CONFIG.SOLDIER.RUN_SPEED : CONFIG.SOLDIER.WALK_SPEED;

    if (moveDir !== 0) {
      p.vx += moveDir * 2400 * dt;
      if (Math.abs(p.vx) > maxSpeed) {
        p.vx = Math.sign(p.vx) * maxSpeed;
      }
    } else {
      p.vx *= Math.pow(0.0008, dt);
      if (Math.abs(p.vx) < 8) p.vx = 0;
    }

    if (inp.up && p.onGround) {
      p.vy = CONFIG.SOLDIER.JUMP_FORCE;
      p.onGround = false;
      addMatchEvent(room, 'jump', { x: p.x + 17, y: p.y + CONFIG.SOLDIER.HEIGHT });
    }

    p.vy += CONFIG.SOLDIER.GRAVITY * dt;

    const prevBottom = p.y + CONFIG.SOLDIER.HEIGHT;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    p.x = Math.max(40, Math.min(CONFIG.WORLD_WIDTH - 40 - CONFIG.SOLDIER.WIDTH, p.x));

    let landed = false;
    if (p.vy >= 0 && !inp.down) {
      const centerX = p.x + CONFIG.SOLDIER.WIDTH / 2;
      const newBottom = p.y + CONFIG.SOLDIER.HEIGHT;
      for (const plat of MAP_PLATFORMS) {
        if (centerX >= plat.x && centerX <= plat.x + plat.w) {
          if (prevBottom <= plat.y + 8 && newBottom >= plat.y) {
            p.y = plat.y - CONFIG.SOLDIER.HEIGHT;
            p.vy = 0;
            landed = true;
            break;
          }
        }
      }
    }

    const groundY = getTerrainHeightAt(p.x + CONFIG.SOLDIER.WIDTH / 2);
    if (p.y + CONFIG.SOLDIER.HEIGHT >= groundY) {
      p.y = groundY - CONFIG.SOLDIER.HEIGHT;
      p.vy = 0;
      landed = true;
    }
    p.onGround = landed;

    const headX = p.x + CONFIG.SOLDIER.WIDTH / 2;
    const headY = p.y + 22;
    p.aimAngle = Math.atan2(inp.aimY - headY, inp.aimX - headX);
    p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1;

    if (!p.onGround) {
      p.animState = p.vy < 0 ? 'jump' : 'fall';
    } else if (Math.abs(p.vx) > 290) {
      p.animState = 'run';
    } else if (Math.abs(p.vx) > 20) {
      p.animState = 'walk';
    } else {
      p.animState = 'idle';
    }

    if (inp.fire && p.fireCooldown <= 0) {
      p.fireCooldown = CONFIG.SOLDIER.FIRE_COOLDOWN;
      const muzzleX = headX + Math.cos(p.aimAngle) * 32;
      const muzzleY = headY + Math.sin(p.aimAngle) * 32;
      spawnProjectile(room, {
        ownerToken: p.token,
        team: p.team,
        kind: 'blaster',
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(p.aimAngle) * CONFIG.SOLDIER.BULLET_SPEED,
        vy: Math.sin(p.aimAngle) * CONFIG.SOLDIER.BULLET_SPEED,
        damage: CONFIG.SOLDIER.BULLET_DAMAGE,
        splashRadius: 0,
        life: 1.1
      });
    }
  });

  m.vehicles.forEach(veh => {
    const spec = CONFIG.SHOP[veh.type];
    if (!spec) return;
    if (veh.fireCooldown > 0) veh.fireCooldown = Math.max(0, veh.fireCooldown - dt);

    if (veh.type === 'aa_turret') {
      const groundY = getTerrainHeightAt(veh.x);
      veh.y = groundY - spec.height;

      let bestTarget = null;
      let bestDist = spec.range;

      for (const candidate of m.vehicles) {
        const candSpec = CONFIG.SHOP[candidate.type];
        if (candidate.team !== veh.team && candSpec && candSpec.category === 'air') {
          const dist = Math.hypot(candidate.x - veh.x, candidate.y - veh.y);
          if (dist <= bestDist) {
            bestDist = dist;
            bestTarget = candidate;
          }
        }
      }

      if (bestTarget) {
        veh.targetId = bestTarget.id;
        const aimAngle = Math.atan2(bestTarget.y - (veh.y + 10), bestTarget.x - veh.x);
        veh.angle = aimAngle;
        veh.facing = Math.cos(aimAngle) >= 0 ? 1 : -1;

        if (veh.fireCooldown <= 0) {
          veh.fireCooldown = spec.fireCooldown;
          const ownerPlayer = room.players.find(pl => pl.team === veh.team);
          spawnProjectile(room, {
            ownerToken: ownerPlayer ? ownerPlayer.token : null,
            team: veh.team,
            kind: 'aa_missile',
            targetVehicleId: bestTarget.id,
            x: veh.x + Math.cos(aimAngle) * 35,
            y: veh.y + 10 + Math.sin(aimAngle) * 35,
            vx: Math.cos(aimAngle) * spec.missileSpeed,
            vy: Math.sin(aimAngle) * spec.missileSpeed,
            damage: spec.damage,
            splashRadius: 55,
            life: 2.2
          });
        }
      } else {
        veh.targetId = null;
      }
      return;
    }

    if (!veh.driverToken) {
      if (spec.category === 'ground') {
        veh.vx *= Math.pow(0.01, dt);
        veh.x += veh.vx * dt;
        const gY = getTerrainHeightAt(veh.x);
        veh.y = gY - spec.height;
        const slope = getTerrainHeightAt(veh.x + 25) - getTerrainHeightAt(veh.x - 25);
        veh.angle = Math.atan2(slope, 50) * 0.6;
      } else if (spec.category === 'air') {
        veh.vx *= Math.pow(0.2, dt);
        veh.vy = Math.min(220, veh.vy + 350 * dt);
        veh.x += veh.vx * dt;
        veh.y += veh.vy * dt;
        const gY = getTerrainHeightAt(veh.x);
        if (veh.y + spec.height >= gY) {
          veh.y = gY - spec.height;
          veh.vy = 0;
          veh.angle = 0;
        }
      }
    }
  });

  updateProjectiles(room, dt);
  updateFlagAndScore(room, dt);
}

function updateControlledVehicle(room, player, veh, dt) {
  const spec = CONFIG.SHOP[veh.type];
  const inp = player.input;
  const moveX = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const moveY = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);

  if (spec.category === 'ground') {
    if (moveX !== 0) {
      veh.vx += moveX * spec.accel * dt;
      veh.vx = Math.max(-spec.speed, Math.min(spec.speed, veh.vx));
      veh.facing = moveX;
    } else {
      veh.vx *= Math.pow(0.005, dt);
      if (Math.abs(veh.vx) < 10) veh.vx = 0;
    }

    veh.x += veh.vx * dt;
    veh.x = Math.max(120, Math.min(CONFIG.WORLD_WIDTH - 120, veh.x));
    const groundY = getTerrainHeightAt(veh.x);
    veh.y = groundY - spec.height;

    const slope = getTerrainHeightAt(veh.x + 30) - getTerrainHeightAt(veh.x - 30);
    veh.angle = Math.atan2(slope, 60) * 0.65;
  } else if (veh.type === 'helicopter') {
    veh.rotorAngle += 28 * dt;
    if (moveX !== 0) {
      veh.vx += moveX * 680 * dt;
      veh.vx = Math.max(-spec.speed, Math.min(spec.speed, veh.vx));
      veh.facing = moveX;
    } else {
      veh.vx *= Math.pow(0.08, dt);
    }

    if (moveY !== 0) {
      veh.vy += moveY * 680 * dt;
      veh.vy = Math.max(-spec.liftSpeed, Math.min(spec.liftSpeed, veh.vy));
    } else {
      veh.vy *= Math.pow(0.08, dt);
    }

    veh.x += veh.vx * dt;
    veh.y += veh.vy * dt;
    veh.angle = (veh.vx / spec.speed) * 0.24;

    const minY = 120;
    const maxY = getTerrainHeightAt(veh.x) - spec.height;
    veh.x = Math.max(140, Math.min(CONFIG.WORLD_WIDTH - 140, veh.x));
    if (veh.y < minY) { veh.y = minY; veh.vy = 0; }
    if (veh.y > maxY) { veh.y = maxY; veh.vy = 0; }
  } else if (veh.type === 'plane') {
    if (moveX !== 0 && moveX !== veh.facing) {
      veh.facing = moveX;
    }
    const targetSpeed = inp.sprint ? spec.maxSpeed : 560;
    veh.vx += (veh.facing * targetSpeed - veh.vx) * 2.5 * dt;

    if (moveY !== 0) {
      veh.vy += moveY * 650 * dt;
      veh.vy = Math.max(-360, Math.min(360, veh.vy));
    } else {
      veh.vy *= Math.pow(0.05, dt);
    }

    veh.x += veh.vx * dt;
    veh.y += veh.vy * dt;

    if (veh.x < 180) { veh.x = 180; veh.facing = 1; veh.vx = Math.abs(veh.vx); }
    if (veh.x > CONFIG.WORLD_WIDTH - 180) { veh.x = CONFIG.WORLD_WIDTH - 180; veh.facing = -1; veh.vx = -Math.abs(veh.vx); }

    const minY = 100;
    const maxY = getTerrainHeightAt(veh.x) - spec.height - 8;
    if (veh.y < minY) { veh.y = minY; veh.vy = 0; }
    if (veh.y > maxY) { veh.y = maxY; veh.vy = 0; }

    veh.angle = Math.atan2(veh.vy, Math.abs(veh.vx)) * veh.facing * 0.7;
  }

  player.x = veh.x - CONFIG.SOLDIER.WIDTH / 2;
  player.y = veh.y + spec.height / 2 - CONFIG.SOLDIER.HEIGHT / 2;
  player.vx = veh.vx;
  player.vy = veh.vy;
  player.facing = veh.facing;

  const aimAngle = Math.atan2(inp.aimY - (veh.y + spec.height * 0.4), inp.aimX - veh.x);
  player.aimAngle = aimAngle;

  if (inp.fire && veh.fireCooldown <= 0) {
    veh.fireCooldown = spec.fireCooldown;
    let shootAngle = aimAngle;

    if (veh.type === 'plane') {
      const baseDir = veh.facing === 1 ? 0.15 : Math.PI - 0.15;
      shootAngle = baseDir + Math.sin(aimAngle) * 0.45;
    }

    const muzzleX = veh.x + Math.cos(shootAngle) * (spec.width * 0.48);
    const muzzleY = veh.y + spec.height * 0.35 + Math.sin(shootAngle) * 24;

    spawnProjectile(room, {
      ownerToken: player.token,
      team: veh.team,
      kind: veh.type === 'tank' ? 'shell' : (spec.category === 'air' ? 'air_cannon' : 'heavy_bolt'),
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(shootAngle) * spec.projectileSpeed + veh.vx * 0.25,
      vy: Math.sin(shootAngle) * spec.projectileSpeed,
      damage: spec.damage,
      splashRadius: spec.splashRadius || 0,
      life: 1.6
    });
  }
}

function spawnProjectile(room, proj) {
  if (room.match.projectiles.length > 140) {
    room.match.projectiles.shift();
  }
  room.match.projectiles.push({
    id: room.match.nextEntityId++,
    ...proj
  });
}

function updateProjectiles(room, dt) {
  const m = room.match;
  const remaining = [];

  for (const p of m.projectiles) {
    p.life -= dt;
    if (p.life <= 0) continue;

    if (p.kind === 'aa_missile' && p.targetVehicleId) {
      const target = m.vehicles.find(v => v.id === p.targetVehicleId);
      if (target && target.team !== p.team) {
        const desiredAngle = Math.atan2(target.y - p.y, target.x - p.x);
        const speed = Math.hypot(p.vx, p.vy);
        p.vx += (Math.cos(desiredAngle) * speed - p.vx) * 5.5 * dt;
        p.vy += (Math.sin(desiredAngle) * speed - p.vy) * 5.5 * dt;
      }
    } else if (p.kind === 'shell') {
      p.vy += 320 * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < 0 || p.x > CONFIG.WORLD_WIDTH || p.y < 0) continue;

    const attacker = room.players.find(pl => pl.token === p.ownerToken) || null;
    let hit = false;

    const groundY = getTerrainHeightAt(p.x);
    if (p.y >= groundY) {
      p.y = groundY;
      hit = true;
    }

    if (!hit) {
      for (const veh of m.vehicles) {
        if (veh.team === p.team) continue;
        const spec = CONFIG.SHOP[veh.type];
        if (!spec) continue;
        const halfW = spec.width / 2;
        if (p.x >= veh.x - halfW && p.x <= veh.x + halfW && p.y >= veh.y && p.y <= veh.y + spec.height) {
          damageVehicle(room, veh, p.damage, attacker);
          hit = true;
          break;
        }
      }
    }

    if (!hit) {
      for (const pl of room.players) {
        if (!pl.alive || pl.team === p.team || pl.vehicleId) continue;
        if (p.x >= pl.x && p.x <= pl.x + CONFIG.SOLDIER.WIDTH &&
            p.y >= pl.y && p.y <= pl.y + CONFIG.SOLDIER.HEIGHT) {
          damageSoldier(room, pl, p.damage, attacker);
          hit = true;
          break;
        }
      }
    }

    if (hit) {
      if (p.splashRadius > 0) {
        for (const pl of room.players) {
          if (!pl.alive || pl.team === p.team || pl.vehicleId) continue;
          const dist = Math.hypot((pl.x + 17) - p.x, (pl.y + 32) - p.y);
          if (dist <= p.splashRadius) {
            damageSoldier(room, pl, p.damage * (1 - dist / (p.splashRadius * 1.3)), attacker);
          }
        }
        for (const veh of [...m.vehicles]) {
          if (veh.team === p.team) continue;
          const dist = Math.hypot(veh.x - p.x, veh.y - p.y);
          if (dist <= p.splashRadius) {
            damageVehicle(room, veh, p.damage * 0.65, attacker);
          }
        }
      }

      addMatchEvent(room, 'hit', {
        x: p.x,
        y: p.y,
        kind: p.kind,
        team: p.team
      });
    } else {
      remaining.push(p);
    }
  }

  m.projectiles = remaining;
}

function updateFlagAndScore(room, dt) {
  const flag = room.match.flag;
  let bluePresent = false;
  let redPresent = false;
  let bluePlayer = null;
  let redPlayer = null;

  for (const p of room.players) {
    if (!p.alive) continue;
    const centerX = p.x + CONFIG.SOLDIER.WIDTH / 2;
    if (Math.abs(centerX - flag.x) <= CONFIG.FLAG.RADIUS) {
      if (p.team === 'blue') { bluePresent = true; bluePlayer = p; }
      if (p.team === 'red') { redPresent = true; redPlayer = p; }
    }
  }

  flag.contested = bluePresent && redPresent;
  flag.capturingTeam = null;

  if (!flag.contested) {
    if (bluePresent && !redPresent) {
      flag.capturingTeam = 'blue';
      const prevOwner = flag.owner;
      flag.progress = Math.max(-1, flag.progress - CONFIG.FLAG.CAPTURE_SPEED * dt);
      if (flag.progress <= -1 && prevOwner !== 'blue') {
        flag.owner = 'blue';
        room.match.scores.blue += CONFIG.FLAG_CAPTURE_POINTS;
        if (bluePlayer) {
          bluePlayer.captures += 1;
          bluePlayer.credits += CONFIG.FLAG_CAPTURE_CREDITS;
          bluePlayer.totalCreditsEarned += CONFIG.FLAG_CAPTURE_CREDITS;
        }
        addMatchEvent(room, 'flag_captured', { team: 'blue' });
      } else if (flag.progress > -0.2 && flag.owner === 'red') {
        flag.owner = null;
      }
    } else if (redPresent && !bluePresent) {
      flag.capturingTeam = 'red';
      const prevOwner = flag.owner;
      flag.progress = Math.min(1, flag.progress + CONFIG.FLAG.CAPTURE_SPEED * dt);
      if (flag.progress >= 1 && prevOwner !== 'red') {
        flag.owner = 'red';
        room.match.scores.red += CONFIG.FLAG_CAPTURE_POINTS;
        if (redPlayer) {
          redPlayer.captures += 1;
          redPlayer.credits += CONFIG.FLAG_CAPTURE_CREDITS;
          redPlayer.totalCreditsEarned += CONFIG.FLAG_CAPTURE_CREDITS;
        }
        addMatchEvent(room, 'flag_captured', { team: 'red' });
      } else if (flag.progress < 0.2 && flag.owner === 'blue') {
        flag.owner = null;
      }
    }
  }

  if (flag.owner) {
    room.match.scores[flag.owner] += CONFIG.FLAG_HOLD_POINTS_PER_SEC * dt;
    const holder = room.players.find(p => p.team === flag.owner);
    if (holder) {
      holder.credits += CONFIG.FLAG_HOLD_CREDITS_PER_SEC * dt;
      holder.totalCreditsEarned += CONFIG.FLAG_HOLD_CREDITS_PER_SEC * dt;
    }
  }
}

function finishMatch(room) {
  room.status = 'finished';
  const blueScore = Math.floor(room.match.scores.blue);
  const redScore = Math.floor(room.match.scores.red);

  let winner = 'draw';
  if (blueScore > redScore) winner = 'blue';
  else if (redScore > blueScore) winner = 'red';

  room.winner = winner;
  room.players.forEach(p => { p.ready = false; });

  io.to(room.code).emit('match_finished', {
    winner,
    scores: { blue: blueScore, red: redScore },
    players: room.players.map(p => ({
      nickname: p.nickname,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      captures: p.captures,
      vehiclesDestroyed: p.vehiclesDestroyed,
      totalCreditsEarned: Math.floor(p.totalCreditsEarned)
    }))
  });
}

// ============================================================================
// ОБРАБОТКА SOCKET.IO СОБЫТИЙ
// ============================================================================
io.on('connection', (socket) => {
  socket.on('create_room', ({ nickname }) => {
    const cleanName = sanitizeNickname(nickname);
    if (!cleanName) {
      return socket.emit('error_msg', 'Введите корректный никнейм перед созданием комнаты.');
    }

    const code = generateRoomCode();
    const token = generateToken();
    const player = createPlayerObject(socket.id, token, cleanName, 'blue', true);

    const room = {
      code,
      status: 'lobby',
      hostToken: token,
      countdownTimer: null,
      countdownValue: null,
      players: [player],
      match: null,
      winner: null
    };

    rooms.set(code, room);
    socketToSession.set(socket.id, { code, token });
    socket.join(code);

    socket.emit('room_joined', {
      token,
      lobby: getRoomLobbyPayload(room)
    });
  });

  socket.on('join_room', ({ code, nickname }) => {
    const cleanName = sanitizeNickname(nickname);
    if (!cleanName) {
      return socket.emit('error_msg', 'Введите никнейм перед входом в комнату.');
    }

    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const room = rooms.get(normalizedCode);

    if (!room) {
      return socket.emit('error_msg', 'Комната с таким кодом не найдена.');
    }
    if (room.players.length >= 2) {
      return socket.emit('error_msg', 'Комната уже заполнена (максимум 2 игрока).');
    }
    if (room.status === 'playing') {
      return socket.emit('error_msg', 'Матч в этой комнате уже идёт.');
    }

    const token = generateToken();
    const takenTeam = room.players[0]?.team;
    const assignedTeam = takenTeam === 'blue' ? 'red' : 'blue';
    const player = createPlayerObject(socket.id, token, cleanName, assignedTeam, false);

    room.players.push(player);
    socketToSession.set(socket.id, { code: room.code, token });
    socket.join(room.code);

    socket.emit('room_joined', {
      token,
      lobby: getRoomLobbyPayload(room)
    });
    io.to(room.code).emit('lobby_update', getRoomLobbyPayload(room));
  });

  socket.on('quick_match', ({ nickname }) => {
    const cleanName = sanitizeNickname(nickname);
    if (!cleanName) {
      return socket.emit('error_msg', 'Введите никнейм перед началом поиска.');
    }

    let openRoom = null;
    for (const r of rooms.values()) {
      if (r.status === 'lobby' && r.players.length === 1 && r.players[0].connected) {
        openRoom = r;
        break;
      }
    }

    if (openRoom) {
      const token = generateToken();
      const assignedTeam = openRoom.players[0].team === 'blue' ? 'red' : 'blue';
      const player = createPlayerObject(socket.id, token, cleanName, assignedTeam, false);
      openRoom.players.push(player);
      socketToSession.set(socket.id, { code: openRoom.code, token });
      socket.join(openRoom.code);

      socket.emit('room_joined', {
        token,
        lobby: getRoomLobbyPayload(openRoom)
      });
      io.to(openRoom.code).emit('lobby_update', getRoomLobbyPayload(openRoom));
    } else {
      const code = generateRoomCode();
      const token = generateToken();
      const player = createPlayerObject(socket.id, token, cleanName, 'blue', true);
      const room = {
        code,
        status: 'lobby',
        hostToken: token,
        countdownTimer: null,
        countdownValue: null,
        players: [player],
        match: null,
        winner: null
      };
      rooms.set(code, room);
      socketToSession.set(socket.id, { code, token });
      socket.join(code);

      socket.emit('room_joined', {
        token,
        lobby: getRoomLobbyPayload(room)
      });
    }
  });

  socket.on('reconnect_session', ({ code, token }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('session_expired');

    const player = room.players.find(p => p.token === token);
    if (!player) return socket.emit('session_expired');

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    player.id = socket.id;
    player.connected = true;
    socketToSession.set(socket.id, { code, token });
    socket.join(code);

    socket.emit('reconnected', {
      token,
      lobby: getRoomLobbyPayload(room),
      config: room.status === 'playing' ? {
        WORLD_WIDTH: CONFIG.WORLD_WIDTH,
        WORLD_HEIGHT: CONFIG.WORLD_HEIGHT,
        GROUND_BASE_Y: CONFIG.GROUND_BASE_Y,
        FLAG_X: CONFIG.FLAG.X,
        FLAG_RADIUS: CONFIG.FLAG.RADIUS,
        SHOP: CONFIG.SHOP,
        PLATFORMS: MAP_PLATFORMS
      } : null
    });

    io.to(code).emit('player_connection_status', {
      nickname: player.nickname,
      connected: true
    });
    io.to(code).emit('lobby_update', getRoomLobbyPayload(room));
    checkAutoStartCountdown(room);
  });

  socket.on('switch_team', () => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.token === session.token);
    if (!player) return;

    const targetTeam = player.team === 'blue' ? 'red' : 'blue';
    const occupied = room.players.some(p => p.token !== player.token && p.team === targetTeam);
    if (!occupied) {
      player.team = targetTeam;
      player.ready = false;
      clearRoomCountdown(room);
      io.to(room.code).emit('lobby_update', getRoomLobbyPayload(room));
    } else {
      socket.emit('error_msg', 'Эта команда уже занята вторым игроком.');
    }
  });

  socket.on('toggle_ready', () => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.token === session.token);
    if (!player || !player.nickname) return;

    player.ready = !player.ready;
    io.to(room.code).emit('lobby_update', getRoomLobbyPayload(room));
    checkAutoStartCountdown(room);
  });

  socket.on('request_start_match', () => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'lobby') return;

    if (room.hostToken !== session.token) {
      return socket.emit('error_msg', 'Только создатель комнаты может начать матч.');
    }
    if (room.players.length < 2) {
      return socket.emit('error_msg', 'Для начала матча нужны оба игрока.');
    }
    const allValid = room.players.every(p => p.connected && p.nickname.length > 0 && p.ready);
    if (!allValid) {
      return socket.emit('error_msg', 'Оба игрока должны ввести ники и нажать «Готов».');
    }

    checkAutoStartCountdown(room);
  });

  socket.on('play_again', () => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'finished') return;

    room.status = 'lobby';
    room.match = null;
    room.players.forEach(p => { p.ready = false; });
    io.to(room.code).emit('returned_to_lobby', getRoomLobbyPayload(room));
  });

  socket.on('player_input', (data) => {
    const session = socketToSession.get(socket.id);
    if (!session || !data || typeof data !== 'object') return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.token === session.token);
    if (!player) return;

    const now = Date.now();
    if (now - player.lastRateReset > 1000) {
      player.lastRateReset = now;
      player.msgCount = 0;
    }
    player.msgCount += 1;
    if (player.msgCount > 75) return;

    player.input.left = Boolean(data.left);
    player.input.right = Boolean(data.right);
    player.input.up = Boolean(data.up);
    player.input.down = Boolean(data.down);
    player.input.sprint = Boolean(data.sprint);
    player.input.fire = Boolean(data.fire);

    if (Number.isFinite(data.aimX) && Number.isFinite(data.aimY)) {
      player.input.aimX = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, data.aimX));
      player.input.aimY = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, data.aimY));
    }
  });

  socket.on('interact_vehicle', () => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'playing' || !room.match) return;

    const player = room.players.find(p => p.token === session.token);
    if (!player || !player.alive) return;

    if (player.vehicleId) {
      const veh = room.match.vehicles.find(v => v.id === player.vehicleId);
      if (veh) {
        veh.driverToken = null;
        const spec = CONFIG.SHOP[veh.type];
        player.x = veh.x - CONFIG.SOLDIER.WIDTH / 2;
        player.y = veh.y - 12;
        player.vy = -180;
        if (spec && spec.category === 'air') {
          player.vy = 0;
        }
      }
      player.vehicleId = null;
      return;
    }

    let nearest = null;
    let bestDist = 135;
    for (const veh of room.match.vehicles) {
      if (veh.team !== player.team || veh.driverToken || veh.type === 'aa_turret') continue;
      const dist = Math.hypot(veh.x - (player.x + 17), veh.y - (player.y + 32));
      if (dist <= bestDist) {
        bestDist = dist;
        nearest = veh;
      }
    }

    if (nearest) {
      nearest.driverToken = player.token;
      player.vehicleId = nearest.id;
      player.vx = 0;
      player.vy = 0;
    }
  });

  socket.on('buy_item', ({ itemId }) => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.code);
    if (!room || room.status !== 'playing' || !room.match) return;

    const player = room.players.find(p => p.token === session.token);
    if (!player) return;

    const spec = CONFIG.SHOP[itemId];
    if (!spec) return;

    if (player.credits < spec.cost) {
      return socket.emit('shop_feedback', { ok: false, msg: 'Недостаточно кредитов!' });
    }

    if (itemId === 'base_shield') {
      const currentLvl = room.match.baseUpgrades[player.team] || 0;
      if (currentLvl >= spec.maxLevel) {
        return socket.emit('shop_feedback', { ok: false, msg: 'Достигнут максимальный уровень!' });
      }
      player.credits -= spec.cost;
      room.match.baseUpgrades[player.team] = currentLvl + 1;
      player.maxHp = CONFIG.SOLDIER.MAX_HP + (currentLvl + 1) * 15;
      if (player.alive) player.hp = Math.min(player.maxHp, player.hp + 30);

      addMatchEvent(room, 'upgrade_bought', { team: player.team, level: currentLvl + 1 });
      return socket.emit('shop_feedback', { ok: true, msg: `Укрепления базы: уровень ${currentLvl + 1}` });
    }

    const existingCount = room.match.vehicles.filter(
      v => v.team === player.team && v.type === itemId
    ).length;

    if (existingCount >= spec.limitPerTeam) {
      return socket.emit('shop_feedback', {
        ok: false,
        msg: `Лимит техники «${spec.name}» (${spec.limitPerTeam} шт.) исчерпан!`
      });
    }

    player.credits -= spec.cost;

    let spawnX = null;
    if (itemId === 'aa_turret') {
      const offset = existingCount * 160;
      spawnX = player.team === 'blue' ? 880 + offset : CONFIG.WORLD_WIDTH - 880 - offset;
    }

    const created = spawnVehicle(room, player.team, itemId, spawnX);
    if (created) {
      addMatchEvent(room, 'vehicle_spawned', { team: player.team, type: itemId, x: created.x, y: created.y });
      socket.emit('shop_feedback', { ok: true, msg: `Доставлено на базу: ${spec.name}` });
    }
  });

  socket.on('leave_room', () => {
    handlePlayerExit(socket.id, true);
  });

  socket.on('disconnect', () => {
    handlePlayerExit(socket.id, false);
  });
});

function handlePlayerExit(socketId, immediate) {
  const session = socketToSession.get(socketId);
  if (!session) return;
  socketToSession.delete(socketId);

  const room = rooms.get(session.code);
  if (!room) return;

  clearRoomCountdown(room);

  const player = room.players.find(p => p.token === session.token);
  if (!player) return;

  if (immediate || room.status === 'lobby') {
    room.players = room.players.filter(p => p.token !== session.token);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      if (room.hostToken === session.token) {
        room.hostToken = room.players[0].token;
        room.players[0].isHost = true;
      }
      io.to(room.code).emit('lobby_update', getRoomLobbyPayload(room));
    }
    return;
  }

  player.connected = false;
  io.to(room.code).emit('player_connection_status', {
    nickname: player.nickname,
    connected: false
  });

  player.disconnectTimer = setTimeout(() => {
    const currentRoom = rooms.get(session.code);
    if (!currentRoom) return;
    currentRoom.players = currentRoom.players.filter(p => p.token !== session.token);
    if (currentRoom.players.length === 0) {
      rooms.delete(currentRoom.code);
    } else if (currentRoom.status === 'playing') {
      io.to(currentRoom.code).emit('opponent_left', { nickname: player.nickname });
      finishMatch(currentRoom);
    }
  }, 25000);
}

// ============================================================================
// ИГРОВОЙ ЦИКЛ (30 ГЦ СИМУЛЯЦИЯ / 20 ГЦ СИНХРОНИЗАЦИЯ)
// ============================================================================
let lastTickTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTickTime) / 1000);
  lastTickTime = now;

  for (const room of rooms.values()) {
    if (room.status === 'playing') {
      updateRoomSimulation(room, dt);
    }
  }
}, 1000 / CONFIG.TICK_RATE);

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== 'playing' || !room.match) continue;

    const payload = {
      t: Date.now(),
      timeLeft: room.match.timeLeft,
      scores: {
        blue: Math.floor(room.match.scores.blue),
        red: Math.floor(room.match.scores.red)
      },
      flag: room.match.flag,
      baseUpgrades: room.match.baseUpgrades,
      players: room.players.map(p => ({
        token: p.token,
        nickname: p.nickname,
        team: p.team,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        facing: p.facing,
        aimAngle: Math.round(p.aimAngle * 100) / 100,
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        alive: p.alive,
        respawnTimer: Math.max(0, Math.round(p.respawnTimer * 10) / 10),
        animState: p.animState,
        vehicleId: p.vehicleId,
        hitFlash: p.hitFlash > 0,
        credits: Math.floor(p.credits),
        kills: p.kills,
        deaths: p.deaths,
        captures: p.captures,
        vehiclesDestroyed: p.vehiclesDestroyed
      })),
      vehicles: room.match.vehicles.map(v => ({
        id: v.id,
        type: v.type,
        team: v.team,
        x: Math.round(v.x * 10) / 10,
        y: Math.round(v.y * 10) / 10,
        vx: Math.round(v.vx),
        vy: Math.round(v.vy),
        angle: Math.round(v.angle * 100) / 100,
        facing: v.facing,
        hp: Math.ceil(v.hp),
        maxHp: v.maxHp,
        driverToken: v.driverToken,
        targetId: v.targetId,
        rotorAngle: Math.round(v.rotorAngle * 10) / 10
      })),
      projectiles: room.match.projectiles.map(pr => ({
        id: pr.id,
        team: pr.team,
        kind: pr.kind,
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        vx: Math.round(pr.vx),
        vy: Math.round(pr.vy)
      })),
      events: room.match.events
    };

    room.match.events = [];
    io.to(room.code).emit('game_state', payload);
  }
}, 1000 / CONFIG.BROADCAST_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`  BASE WARS SERVER запущен на порту ${PORT}`);
  console.log(`  Локальный доступ: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
