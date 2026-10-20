const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const GAME_FILE = path.join(__dirname, 'hot_potato_tycoon_online.html');
const CONFIG = { width: 2400, height: 1800, radius: 24, speed: 280, dashSpeed: 750, dashDuration: 0.16, dashCooldown: 2, throwSpeed: 950, fuse: 12 };
const obstacles = [
  {x:450,y:320,w:220,h:100},{x:1730,y:320,w:220,h:100},{x:450,y:1380,w:220,h:100},{x:1730,y:1380,w:220,h:100},
  {x:1050,y:320,w:300,h:120},{x:1050,y:1360,w:300,h:120},{x:280,y:800,w:120,h:280},{x:2000,y:800,w:120,h:280},{x:1080,y:820,w:240,h:160}
];
const colors = ['#f44336','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#8bc34a','#ffeb3b','#ff9800','#ff5722','#795548','#607d8b','#ff4081'];
const hats = ['tophat','cowboy','crown','cap'];
const rooms = new Map();
let nextId = 1;
function rand(min,max){ return Math.random()*(max-min)+min; }
function dist(a,b,c,d){ return Math.hypot(c-a,d-b); }
function send(ws, obj){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room,obj){ for(const p of room.players.values()) send(p.ws,obj); }
function event(room,message){ broadcast(room,{type:'event',message}); }
function createRoomCode(){ let code; do { code=crypto.randomBytes(3).toString('hex').toUpperCase(); } while(rooms.has(code)); return code; }
function clearRoomIfEmpty(room){ if(room && room.players.size===0) rooms.delete(room.code); }
function makeRoom(code){ return {code,players:new Map(),active:false,round:1,fuseTime:CONFIG.fuse,maxFuse:CONFIG.fuse,holderId:null,projectile:null,lastTick:Date.now(),ended:false}; }
function validSpawn(room){
  for(let i=0;i<150;i++){
    const x=rand(100,CONFIG.width-100), y=rand(100,CONFIG.height-100);
    const blocked=obstacles.some(o=>x>o.x-CONFIG.radius-12 && x<o.x+o.w+CONFIG.radius+12 && y>o.y-CONFIG.radius-12 && y<o.y+o.h+CONFIG.radius+12);
    const crowded=[...room.players.values()].some(p=>p.alive && dist(x,y,p.x,p.y)<CONFIG.radius*2+20);
    if(!blocked&&!crowded) return {x,y};
  }
  return {x:CONFIG.width/2+rand(-100,100),y:CONFIG.height/2+rand(-100,100)};
}
function startRoom(room){
  if(room.active || room.players.size<2) return;
  room.active=true; room.ended=false; room.round=1; room.maxFuse=CONFIG.fuse; room.fuseTime=CONFIG.fuse; room.projectile=null;
  for(const p of room.players.values()){ const pos=validSpawn(room); p.x=pos.x;p.y=pos.y;p.vx=0;p.vy=0;p.alive=true;p.dashCdTimer=0;p.dashTimer=0;p.input={}; }
  const living=[...room.players.values()].filter(p=>p.alive); room.holderId=living[Math.floor(Math.random()*living.length)].id;
  event(room,'ONLINE MATCH STARTED!');
}
function snapshot(room){
  return {type:'snapshot',state:{active:room.active,round:room.round,fuseTime:room.fuseTime,maxFuse:room.maxFuse,holderId:room.holderId,projectile:room.projectile?{x:room.projectile.x,y:room.projectile.y}:null,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,vx:p.vx,vy:p.vy,alive:p.alive,color:p.color,hat:p.hat,facingAngle:p.facingAngle,dashCdTimer:p.dashCdTimer,isDashing:p.dashTimer>0}))}};
}
function collidesObstacle(x,y,r){ return obstacles.some(o=>{const cx=Math.max(o.x,Math.min(x,o.x+o.w));const cy=Math.max(o.y,Math.min(y,o.y+o.h));return dist(x,y,cx,cy)<r;}); }
function chooseHolder(room,id){ const p=room.players.get(id); room.holderId=p&&p.alive?id:null; }
function finishIfOne(room){ const living=[...room.players.values()].filter(p=>p.alive); if(living.length<=1 && room.active){ room.active=false;room.ended=true;room.projectile=null;room.holderId=null;broadcast(room,{type:'gameover',winnerId:living[0]?.id||null}); } }
function tickRoom(room,dt){
  if(!room.active) return;
  for(const p of room.players.values()){
    if(!p.alive) continue;
    const i=p.input||{};
    if(p.dashCdTimer>0) p.dashCdTimer=Math.max(0,p.dashCdTimer-dt);
    if(i.dash && p.dashCdTimer<=0 && p.dashTimer<=0){p.dashTimer=CONFIG.dashDuration;p.dashCdTimer=CONFIG.dashCooldown;p.facingAngle=Math.atan2((i.aimY||p.y)-p.y,(i.aimX||p.x)-p.x);}
    let mx=(i.right?1:0)-(i.left?1:0), my=(i.down?1:0)-(i.up?1:0);
    if(mx&&my){mx*=Math.SQRT1_2;my*=Math.SQRT1_2;}
    if(p.dashTimer>0){p.dashTimer=Math.max(0,p.dashTimer-dt);p.vx=Math.cos(p.facingAngle)*CONFIG.dashSpeed;p.vy=Math.sin(p.facingAngle)*CONFIG.dashSpeed;}
    else {p.vx=mx*CONFIG.speed;p.vy=my*CONFIG.speed;}
    if(Number.isFinite(i.aimX)&&Number.isFinite(i.aimY) && dist(p.x,p.y,i.aimX,i.aimY)>1) p.facingAngle=Math.atan2(i.aimY-p.y,i.aimX-p.x);
    const nx=Math.max(CONFIG.radius+10,Math.min(CONFIG.width-CONFIG.radius-10,p.x+p.vx*dt));
    const ny=Math.max(CONFIG.radius+10,Math.min(CONFIG.height-CONFIG.radius-10,p.y+p.vy*dt));
    if(!collidesObstacle(nx,p.y,CONFIG.radius)) p.x=nx; else p.vx=0;
    if(!collidesObstacle(p.x,ny,CONFIG.radius)) p.y=ny; else p.vy=0;
  }
  // Separate players gently so they do not overlap.
  const living=[...room.players.values()].filter(p=>p.alive);
  for(let i=0;i<living.length;i++) for(let j=i+1;j<living.length;j++){
    const a=living[i],b=living[j],d=dist(a.x,a.y,b.x,b.y),min=CONFIG.radius*2;
    if(d>0&&d<min){const push=(min-d)/2,dx=(b.x-a.x)/d,dy=(b.y-a.y)/d;a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push;}
  }
  const holder=room.players.get(room.holderId);
  if(room.projectile){
    const q=room.projectile, step=Math.min(dt,0.05); q.x+=q.vx*step;q.y+=q.vy*step;q.travelled+=Math.hypot(q.vx*step,q.vy*step);
    let caught=null;
    for(const p of living){if(p.id!==q.throwerId && dist(q.x,q.y,p.x,p.y)<CONFIG.radius+14){caught=p;break;}}
    if(caught){room.projectile=null;room.holderId=caught.id;event(room,caught.name+' CAUGHT THE SPUD!');}
    else if(collidesObstacle(q.x,q.y,14)||q.travelled>=q.maxDistance||q.x<0||q.x>CONFIG.width||q.y<0||q.y>CONFIG.height){room.projectile=null;chooseHolder(room,q.throwerId);event(room,'MISSED! POTATO RETURNED TO THROWER.');}
  } else {
    if(holder && holder.alive){room.fuseTime-=dt;if(room.fuseTime<=0){holder.alive=false;event(room,holder.name+' GOT BOOMED!');room.round++;room.maxFuse=Math.max(5,CONFIG.fuse-(room.round-1)*0.8);room.fuseTime=room.maxFuse;finishIfOne(room);if(room.active){const survivors=[...room.players.values()].filter(p=>p.alive);room.holderId=survivors[Math.floor(Math.random()*survivors.length)]?.id||null;}}}
  }
  // Consume edge-triggered actions only once, even if snapshots are frequent.
  for(const p of room.players.values()){
    const i=p.input||{};
    if(i.throw){i.throw=false;if(room.active && !room.projectile && room.holderId===p.id && p.alive){const aimX=Number.isFinite(i.aimX)?i.aimX:p.x+Math.cos(p.facingAngle)*350;const aimY=Number.isFinite(i.aimY)?i.aimY:p.y+Math.sin(p.facingAngle)*350;const angle=Math.atan2(aimY-p.y,aimX-p.x);const maxDistance=Math.min(900,Math.max(120,dist(p.x,p.y,aimX,aimY)));room.projectile={x:p.x,y:p.y,vx:Math.cos(angle)*CONFIG.throwSpeed,vy:Math.sin(angle)*CONFIG.throwSpeed,throwerId:p.id,travelled:0,maxDistance};room.holderId=null;event(p.name+' THREW THE SPUD!');}}
    if(i.trap){i.trap=false;}
    if(i.dash) i.dash=false;
  }
  finishIfOne(room);
}

const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url.startsWith('/index.html')){
    fs.readFile(GAME_FILE,(err,data)=>{if(err){res.writeHead(500,{'content-type':'text/plain'});res.end('Game HTML file missing. Keep the HTML beside server.js.');return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(data);});
  } else {res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
    if(msg.type==='create'||msg.type==='join'){
      if(ws.playerId){send(ws,{type:'error',message:'Already joined a room.'});return;}
      let room;
      if(msg.type==='create'){room=makeRoom(createRoomCode());rooms.set(room.code,room);}
      else {const code=String(msg.room||'').toUpperCase();room=rooms.get(code);if(!room){send(ws,{type:'error',message:'Room not found. Check the code or create a room.'});return;}if(room.active){send(ws,{type:'error',message:'That match has already started.'});return;}if(room.players.size>=16){send(ws,{type:'error',message:'Room is full.'});return;}}
      const id=String(nextId++),pos=validSpawn(room);const player={id,name:String(msg.name||'Player').replace(/[<>]/g,'').slice(0,14)||'Player',ws,x:pos.x,y:pos.y,vx:0,vy:0,alive:true,color:colors[(Number(id)-1)%colors.length],hat:hats[(Number(id)-1)%hats.length],facingAngle:0,dashCdTimer:0,dashTimer:0,input:{}};
      room.players.set(id,player);ws.roomCode=room.code;ws.playerId=id;
      send(ws,{type:'joined',playerId:id,room:room.code});
      broadcast(room,{type:'status',message:`Room ${room.code}: ${room.players.size}/16 players connected. Share the room code.`});
      if(room.players.size>=2) startRoom(room);
      broadcast(room,snapshot(room));
    } else if(msg.type==='input' && ws.roomCode && ws.playerId){
      const room=rooms.get(ws.roomCode),p=room&&room.players.get(ws.playerId);if(!p)return;
      const i=msg.input||{};p.input={up:!!i.up,down:!!i.down,left:!!i.left,right:!!i.right,aimX:Number(i.aimX),aimY:Number(i.aimY),dash:!!i.dash || !!(p.input&&p.input.dash),throw:!!i.throw || !!(p.input&&p.input.throw),trap:!!i.trap || !!(p.input&&p.input.trap)};
    }
  });
  ws.on('close',()=>{
    const room=rooms.get(ws.roomCode);if(!room)return;
    const p=room.players.get(ws.playerId);if(p){room.players.delete(ws.playerId);if(room.holderId===ws.playerId)room.holderId=null;}
    if(room.players.size===0){rooms.delete(room.code);return;}
    if(room.active){const alive=[...room.players.values()].filter(x=>x.alive);if(alive.length<=1){room.active=false;broadcast(room,{type:'gameover',winnerId:alive[0]?.id||null});}else if(!room.projectile&&room.holderId===null){room.holderId=alive[0].id;}}
    broadcast(room,{type:'status',message:`A player disconnected. ${room.players.size} player(s) remain.`});
  });
});
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){const dt=Math.min(.05,Math.max(.001,(now-room.lastTick)/1000));room.lastTick=now;tickRoom(room,dt);broadcast(room,snapshot(room));}},50);
server.listen(PORT,'0.0.0.0',()=>console.log(`Hot Potato Tycoon online server listening on port ${PORT}`));
