const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { players: new Map(), bullets: [], nextBullet: 1 });
  return rooms.get(name);
}
function snapshot(room) {
  return {
    players: Object.fromEntries([...room.players].map(([id,p]) => [id, {
      id, name:p.name, x:p.x, y:p.y, hp:p.hp
    }])),
    bullets: room.bullets.map(b => ({id:b.id,x:b.x,y:b.y}))
  };
}
function sendState(roomName) {
  const room = rooms.get(roomName);
  if (room) io.to(roomName).emit("state", snapshot(room));
}

io.on("connection", socket => {
  socket.on("join", data => {
    const roomName = String(data.room || "arena").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,12) || "arena";
    const name = String(data.name || "Игрок").slice(0,12);
    if (socket.data.room) return;
    const room = getRoom(roomName);
    if (room.players.size >= 8) {
      socket.emit("notice", "Комната заполнена (максимум 8 игроков).");
      return;
    }
    socket.data.room = roomName;
    room.players.set(socket.id, {name,x:100+Math.random()*600,y:80+Math.random()*340,hp:100,score:0,aim:{x:400,y:250},lastShot:0});
    socket.join(roomName);
    socket.emit("joined", {id:socket.id,room:roomName,players:snapshot(room).players});
    socket.to(roomName).emit("notice", name + " присоединился!");
    sendState(roomName);
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (!p) return;
    let dx = Math.max(-1,Math.min(1,Number(data.dx)||0));
    let dy = Math.max(-1,Math.min(1,Number(data.dy)||0));
    const len = Math.hypot(dx,dy);
    if (len > 1) { dx/=len; dy/=len; }
    p.x = Math.max(20,Math.min(780,p.x+dx*5));
    p.y = Math.max(20,Math.min(480,p.y+dy*5));
    if (data.aim && Number.isFinite(data.aim.x) && Number.isFinite(data.aim.y))
      p.aim = {x:Math.max(0,Math.min(800,data.aim.x)),y:Math.max(0,Math.min(500,data.aim.y))};
  });

  socket.on("shoot", data => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (!p || Date.now()-p.lastShot<180) return;
    p.lastShot=Date.now();
    const a=Math.atan2(p.aim.y-p.y,p.aim.x-p.x);
    room.bullets.push({id:room.nextBullet++,owner:socket.id,x:p.x,y:p.y,vx:Math.cos(a)*10,vy:Math.sin(a)*10,life:65});
  });

  socket.on("disconnect", () => {
    const roomName=socket.data.room, room=rooms.get(roomName);
    if (!room) return;
    const p=room.players.get(socket.id);
    room.players.delete(socket.id);
    room.bullets=room.bullets.filter(b=>b.owner!==socket.id);
    if (p) io.to(roomName).emit("notice",p.name+" вышел из игры.");
    if (room.players.size===0) rooms.delete(roomName); else sendState(roomName);
  });
});

setInterval(() => {
  for (const [roomName,room] of rooms) {
    for (const b of room.bullets) {
      b.x+=b.vx;b.y+=b.vy;b.life--;
      for (const [id,p] of room.players) {
        if (id===b.owner || p.hp<=0) continue;
        if (Math.hypot(p.x-b.x,p.y-b.y)<22) {
          p.hp=Math.max(0,p.hp-25);
          const shooter=room.players.get(b.owner);
          if (p.hp===0 && shooter) { shooter.score+=1; io.to(b.owner).emit("score",{id:b.owner,score:shooter.score}); }
          io.to(id).emit("hit",{id,hp:p.hp});
          b.life=0;
        }
      }
    }
    room.bullets=room.bullets.filter(b=>b.life>0&&b.x>-20&&b.x<820&&b.y>-20&&b.y<520);
    sendState(roomName);
  }
},50);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Neon Arena server running on "+PORT));
