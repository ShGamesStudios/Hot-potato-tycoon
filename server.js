const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const GAME_FILE = path.join(__dirname, 'hot_potato_tycoon_online.html');
const CONFIG = { width: 2400, height: 1800, radius: 24, speed: 280, dashSpeed: 750, dashDuration: 0.16, dashCooldown: 2, throwSpeed: 950, fuse: 12, trapCooldown: 6, trapLife: 12, trapRadius: 38, trapSlowTime: 1.5 };
const obstacles = [
  {x:450,y:320,w:220,h:100},{x:1730,y:320,w:220,h:100},{x:450,y:1380,w:220,h:100},{x:1730,y:1380,w:220,h:100},
  {x:1050,y:320,w:300,h:120},{x:1050,y:1360,w:300,h:120},{x:280,y:800,w:120,h:280},{x:2000,y:800,w:120,h:280},{x:1080,y:820,w:240,h:160}
];
const colors = ['#f44336','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#8bc34a','#ffeb3b','#ff9800','#ff5722','#795548','#607d8b','#ff4081'];
const hats = ['tophat','cowboy','crown','cap'];
const rooms = new Map();
let nextId = 1;
const MATCH_SIZE = 8, QUICK_WAIT = 10000;
const BOT_NAMES = ['Bot Barry','Bot Bella','Bot Biscuit','Bot Bruno','Bot Betty','Bot Boomer','Bot Bubbles','Bot Buzz'];
function humans(room){ return [...room.players.values()].filter(p=>!p.isBot).length; }
function addBots(room){
  let k=0;
  while(room.players.size<MATCH_SIZE){
    const id=String(nextId++),pos=validSpawn(room);
    room.players.set(id,{id,name:BOT_NAMES[k++%BOT_NAMES.length],isBot:true,ws:null,x:pos.x,y:pos.y,vx:0,vy:0,alive:true,color:colors[(Number(id)-1)%colors.length],hat:hats[(Number(id)-1)%hats.length],facingAngle:0,dashCdTimer:0,dashTimer:0,trapCooldown:0,trappedTimer:0,input:{}});
  }
}
function botThink(room,p,dt){
  const others=[...room.players.values()].filter(q=>q.alive&&q.id!==p.id);
  if(!others.length){p.input={};return;}
  p.think=(p.think||0)-dt;
  if(p.think<=0){p.think=rand(0.25,0.7);p.side=Math.random()<0.5?-1:1;}
  const holding=room.holderId===p.id, holder=room.players.get(room.holderId);
  let tx,ty,flee=false;
  if(holding){const t=others.reduce((a,b)=>dist(p.x,p.y,a.x,a.y)<dist(p.x,p.y,b.x,b.y)?a:b);tx=t.x;ty=t.y;p.hold=(p.hold||0)+dt;}
  else if(holder&&holder.alive&&dist(p.x,p.y,holder.x,holder.y)<550){tx=holder.x;ty=holder.y;flee=true;p.hold=0;}
  else {tx=CONFIG.width/2;ty=CONFIG.height/2;p.hold=0;}
  let dx=tx-p.x,dy=ty-p.y;const d=Math.hypot(dx,dy)||1;
  if(flee){dx=-dx;dy=-dy;}
  const nx=dx/d,ny=dy/d,side=p.side||1,mx=nx-ny*side*0.6,my=ny+nx*side*0.6,th=0.35;
  p.input={up:my<-th,down:my>th,left:mx<-th,right:mx>th,aimX:p.x+dx,aimY:p.y+dy,
    dash:(flee&&d<260&&Math.random()<0.03)||(holding&&d<350&&Math.random()<0.02),
    throw:holding&&((p.hold>0.6&&d<500&&d>60)||p.hold>1.6)};
}
function rand(min,max){ return Math.random()*(max-min)+min; }
function dist(a,b,c,d){ return Math.hypot(c-a,d-b); }
function send(ws, obj){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room,obj){ for(const p of room.players.values()) send(p.ws,obj); }
function event(room,message){ broadcast(room,{type:'event',message}); }
function createRoomCode(){ let code; do { code=crypto.randomBytes(3).toString('hex').toUpperCase(); } while(rooms.has(code)); return code; }
function clearRoomIfEmpty(room){ if(room && room.players.size===0) rooms.delete(room.code); }
function makeRoom(code){ return {isPublic:false,startAt:0,lastStatus:0,code,players:new Map(),traps:[],active:false,round:1,fuseTime:CONFIG.fuse,maxFuse:CONFIG.fuse,holderId:null,projectile:null,lastTick:Date.now(),ended:false}; }
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
  room.active=true; room.startAt=0; room.ended=false; room.round=1; room.maxFuse=CONFIG.fuse; room.fuseTime=CONFIG.fuse; room.projectile=null; room.traps=[];
  for(const p of room.players.values()){ const pos=validSpawn(room); p.x=pos.x;p.y=pos.y;p.vx=0;p.vy=0;p.alive=true;p.dashCdTimer=0;p.dashTimer=0;p.trapCooldown=0;p.trappedTimer=0;p.input={}; }
  const living=[...room.players.values()].filter(p=>p.alive); room.holderId=living[Math.floor(Math.random()*living.length)].id;
  event(room,'ONLINE MATCH STARTED!');
}
function snapshot(room){
  return {type:'snapshot',state:{active:room.active,round:room.round,fuseTime:room.fuseTime,maxFuse:room.maxFuse,holderId:room.holderId,projectile:room.projectile?{x:room.projectile.x,y:room.projectile.y}:null,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,vx:p.vx,vy:p.vy,alive:p.alive,color:p.color,hat:p.hat,facingAngle:p.facingAngle,dashCdTimer:p.dashCdTimer,trapCooldown:p.trapCooldown||0,trappedTimer:p.trappedTimer||0,isDashing:p.dashTimer>0})),traps:room.traps.map(t=>({x:t.x,y:t.y,radius:t.radius,life:t.life,ownerId:t.ownerId}))}};
}
function collidesObstacle(x,y,r){ return obstacles.some(o=>{const cx=Math.max(o.x,Math.min(x,o.x+o.w));const cy=Math.max(o.y,Math.min(y,o.y+o.h));return dist(x,y,cx,cy)<r;}); }
function chooseHolder(room,id){ const p=room.players.get(id); room.holderId=p&&p.alive?id:null; }
function finishIfOne(room){ const living=[...room.players.values()].filter(p=>p.alive); if(living.length<=1 && room.active){ room.active=false;room.ended=true;room.projectile=null;room.holderId=null;broadcast(room,{type:'gameover',winnerId:living[0]?.id||null}); } }
function tickRoom(room,dt){
  if(!room.active) return;
  for(const p of room.players.values()){
    if(!p.alive) continue;
    if(p.isBot) botThink(room,p,dt);
    const i=p.input||{};
    if(p.dashCdTimer>0) p.dashCdTimer=Math.max(0,p.dashCdTimer-dt);
    if(p.trapCooldown>0) p.trapCooldown=Math.max(0,p.trapCooldown-dt);
    if(p.trappedTimer>0) p.trappedTimer=Math.max(0,p.trappedTimer-dt);
    if(i.dash && p.dashCdTimer<=0 && p.dashTimer<=0){p.dashTimer=CONFIG.dashDuration;p.dashCdTimer=CONFIG.dashCooldown;p.facingAngle=Math.atan2((i.aimY||p.y)-p.y,(i.aimX||p.x)-p.x);}
    let mx=(i.right?1:0)-(i.left?1:0), my=(i.down?1:0)-(i.up?1:0);
    if(mx&&my){mx*=Math.SQRT1_2;my*=Math.SQRT1_2;}
    if(p.dashTimer>0){p.dashTimer=Math.max(0,p.dashTimer-dt);p.vx=Math.cos(p.facingAngle)*CONFIG.dashSpeed;p.vy=Math.sin(p.facingAngle)*CONFIG.dashSpeed;}
    else {const slow=p.trappedTimer>0?0.35:1;p.vx=mx*CONFIG.speed*slow;p.vy=my*CONFIG.speed*slow;}
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
  for(const trap of room.traps) trap.life-=dt;
  room.traps=room.traps.filter(trap=>trap.life>0);
  for(const trap of [...room.traps]) {
    const victim=living.find(p=>p.id!==trap.ownerId && dist(p.x,p.y,trap.x,trap.y)<p.radius+trap.radius*0.55);
    if(victim) {
      victim.trappedTimer=Math.max(victim.trappedTimer||0,CONFIG.trapSlowTime);
      room.traps=room.traps.filter(t=>t!==trap);
      event(room,victim.name+' HIT A TRAP!');
    }
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
    if(i.throw){i.throw=false;if(room.active && !room.projectile && room.holderId===p.id && p.alive){const aimX=Number.isFinite(i.aimX)?i.aimX:p.x+Math.cos(p.facingAngle)*350;const aimY=Number.isFinite(i.aimY)?i.aimY:p.y+Math.sin(p.facingAngle)*350;const angle=Math.atan2(aimY-p.y,aimX-p.x);const maxDistance=Math.min(900,Math.max(120,dist(p.x,p.y,aimX,aimY)));room.projectile={x:p.x,y:p.y,vx:Math.cos(angle)*CONFIG.throwSpeed,vy:Math.sin(angle)*CONFIG.throwSpeed,throwerId:p.id,travelled:0,maxDistance};room.holderId=null;event(room,p.name+' THREW THE SPUD!');}}
    if(i.trap){
      i.trap=false;
      if(room.active && p.alive && room.holderId===p.id && (p.trapCooldown||0)<=0 && room.traps.length<24){
        room.traps.push({x:p.x,y:p.y,radius:CONFIG.trapRadius,life:CONFIG.trapLife,ownerId:p.id});
        p.trapCooldown=CONFIG.trapCooldown;
        event(room,p.name+' SET A TRAP!');
      }
    }
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
    if(msg.type==='create'||msg.type==='join'||msg.type==='quick'){
      if(ws.playerId){send(ws,{type:'error',message:'Already joined a room.'});return;}
      let room;
      if(msg.type==='quick'){room=[...rooms.values()].find(r=>r.isPublic&&!r.active&&!r.ended&&humans(r)<MATCH_SIZE);if(!room){room=makeRoom(createRoomCode());room.isPublic=true;rooms.set(room.code,room);}}
      else if(msg.type==='create'){room=makeRoom(createRoomCode());rooms.set(room.code,room);}
      else {const code=String(msg.room||'').toUpperCase();room=rooms.get(code);if(!room){send(ws,{type:'error',message:'Room not found. Check the code or create a room.'});return;}if(room.active){send(ws,{type:'error',message:'That match has already started.'});return;}if(room.players.size>=16){send(ws,{type:'error',message:'Room is full.'});return;}}
      const id=String(nextId++),pos=validSpawn(room);const player={id,name:String(msg.name||'Player').replace(/[<>]/g,'').slice(0,14)||'Player',ws,x:pos.x,y:pos.y,vx:0,vy:0,alive:true,color:colors[(Number(id)-1)%colors.length],hat:hats[(Number(id)-1)%hats.length],facingAngle:0,dashCdTimer:0,dashTimer:0,trapCooldown:0,trappedTimer:0,input:{}};
      room.players.set(id,player);ws.roomCode=room.code;ws.playerId=id;
      send(ws,{type:'joined',playerId:id,room:room.code});
      broadcast(room,{type:'status',message:`Room ${room.code}: ${room.players.size}/16 players connected. Share the room code.`});
      if(room.isPublic){if(!room.startAt)room.startAt=Date.now()+QUICK_WAIT;if(humans(room)>=MATCH_SIZE)room.startAt=Date.now();}
      else if(room.players.size>=2 && !room.active){
        if(!room.startAt) { room.startAt=Date.now()+60000; room.lastStatus=0; }
      }
      broadcast(room,snapshot(room));
    } else if(msg.type==='input' && ws.roomCode && ws.playerId){
      const room=rooms.get(ws.roomCode),p=room&&room.players.get(ws.playerId);if(!p)return;
      const i=msg.input||{};p.input={up:!!i.up,down:!!i.down,left:!!i.left,right:!!i.right,aimX:Number(i.aimX),aimY:Number(i.aimY),dash:!!i.dash || !!(p.input&&p.input.dash),throw:!!i.throw || !!(p.input&&p.input.throw),trap:!!i.trap || !!(p.input&&p.input.trap)};
    }
  });
  ws.on('close',()=>{
    const room=rooms.get(ws.roomCode);if(!room)return;
    const p=room.players.get(ws.playerId);if(p){room.players.delete(ws.playerId);if(room.holderId===ws.playerId)room.holderId=null;}
    if(humans(room)===0){rooms.delete(room.code);return;}
    if(room.active){const alive=[...room.players.values()].filter(x=>x.alive);if(alive.length<=1){room.active=false;broadcast(room,{type:'gameover',winnerId:alive[0]?.id||null});}else if(!room.projectile&&room.holderId===null){room.holderId=alive[0].id;}}
    if(!room.isPublic && !room.active && room.players.size<2) room.startAt=0;
    broadcast(room,{type:'status',message:(!room.active && !room.isPublic && room.players.size<2) ? `Waiting for player 2. The 60-second countdown starts when they join.` : `A player disconnected. ${room.players.size} player(s) remain.`});
  });
});
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){const dt=Math.min(.05,Math.max(.001,(now-room.lastTick)/1000));room.lastTick=now;try{
      if(!room.active&&!room.ended&&room.startAt){
        const left=room.startAt-now;
        if(room.isPublic){
          if(left<=0){addBots(room);startRoom(room);}
          else if(now-room.lastStatus>=1000){room.lastStatus=now;broadcast(room,{type:'status',message:`MATCHMAKING: ${humans(room)} player(s) found. Starting in ${Math.ceil(left/1000)}s - empty spots are filled with bots!`});}
        } else if(room.players.size<2) {
          room.startAt=0;
          broadcast(room,{type:'status',message:'Waiting for player 2. The countdown will restart when they join.'});
        } else if(left<=0) startRoom(room);
        else if(now-room.lastStatus>=1000){room.lastStatus=now;broadcast(room,{type:'status',message:`LOBBY COUNTDOWN: Game starts in ${Math.ceil(left/1000)} seconds. Share room code ${room.code} so more players can join!`});}
      }
      tickRoom(room,dt);broadcast(room,snapshot(room));}catch(err){console.error('Room error:',err);}}},50);
server.listen(PORT,'0.0.0.0',()=>console.log(`Hot Potato Tycoon online server listening on port ${PORT}`));
