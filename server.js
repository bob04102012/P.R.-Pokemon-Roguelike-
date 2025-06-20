// File: server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Game Constants & Data (Identical to before) ---
const POKEMON_PREFIXES = ['Aero', 'Aqua', 'Blaze', 'Geo', 'Cryo', 'Draco', 'Electro', 'Psy', 'Umbra', 'Lumi'];
const POKEMON_SUFFIXES = ['don', 'zor', 'wing', 'fang', 'dillo', 'moth', 'lyte', 'nix', 'gon', 'leon'];
const MOVE_PREFIXES = ['Hyper', 'Giga', 'Sonic', 'Psycho', 'Shadow', 'Aqua', 'Inferno', 'Terra', 'Glacial'];
const MOVE_SUFFIXES = ['Beam', 'Blast', 'Punch', 'Wave', 'Claw', 'Drain', 'Burst', 'Crush', 'Spike'];
const TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Rock', 'Ghost', 'Normal'];
const TYPE_CHART = { Fire: { weakTo: ['Water', 'Rock'], strongAgainst: ['Grass'] }, Water: { weakTo: ['Grass', 'Electric'], strongAgainst: ['Fire', 'Rock'] }, Grass: { weakTo: ['Fire'], strongAgainst: ['Water', 'Rock'] }, Electric: { weakTo: ['Rock'], strongAgainst: ['Water'] }, Rock: { weakTo: ['Water', 'Grass'], strongAgainst: ['Fire', 'Electric'] }, Ghost: { weakTo: ['Ghost'], strongAgainst: ['Ghost'], immuneTo: ['Normal'] }, Normal: { weakTo: ['Rock'], strongAgainst: [] } };
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;
const PERMANENT_UPGRADES = { /* ... Identical to previous version ... */ };

// --- Generation Functions ---
function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function generateMove(type) { /* ... */ return {}; }
function generatePokemon(upgrades = { baseHp: 0, baseAtk: 0, betterMons: false }) { /* ... */ return {}; }

const worldMaps = new Map();
function generateMap(mapX, mapY) {
    const grid = Array(MAP_HEIGHT).fill(0).map(() => Array(MAP_WIDTH).fill(0));
    for (let i = 0; i < 40; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 1; }
    for (let i = 0; i < 30; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 2; }
    for (let i = 0; i < 50; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 3; }
    if (mapX === 0 && mapY === 0) { grid[7][8] = 4; grid[7][10] = 5; grid[7][12] = 6; }
    
    // Add NPCs to the map
    const npcs = [];
    if (Math.random() > 0.5) { // 50% chance for an NPC to spawn on a map
        npcs.push({
            id: `npc_${mapX}_${mapY}_1`,
            x: Math.floor(Math.random() * MAP_WIDTH),
            y: Math.floor(Math.random() * MAP_HEIGHT),
            team: [generatePokemon(), generatePokemon()]
        });
    }
    
    return { grid, npcs };
}

const playerStates = {};
const gameRooms = {};

function createPlayerState(socketId) { /* ... Identical to previous version ... */ }
function enterHubMode(socketId) {
    const pState = playerStates[socketId];
    if (!pState) return;
    pState.state = 'hub';
    pState.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
    const { mapX, mapY } = pState.location;
    const mapKey = `${mapX},${mapY}`;
    if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(mapX, mapY)); }
    const mapData = worldMaps.get(mapKey);
    io.to(socketId).emit('enterHubMode', { location: pState.location, mapData: mapData, playerState: pState });
}

io.on('connection', (socket) => {
    // ... all connection, createPlayerState, and enterHubMode logic ...
    
    socket.on('move', ({ dx, dy }) => { // Reworked for directional input
        const pState = playerStates[socket.id];
        if (!pState || pState.state !== 'hub') return;
        let { mapX, mapY, x, y } = pState.location;
        const newLoc = { mapX, mapY, x: x + dx, y: y + dy };
        
        // ... screen transition logic ...
        
        const mapKey = `${newLoc.mapX},${newLoc.mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(newLoc.mapX, newLoc.mapY)); }
        const currentMap = worldMaps.get(mapKey);

        if (newLoc.y < 0 || newLoc.y >= MAP_HEIGHT || newLoc.x < 0 || newLoc.x >= MAP_WIDTH) return; // boundary check
        const tile = currentMap.grid[newLoc.y][newLoc.x];
        if (tile === 1 || tile === 2) return; // Collision

        pState.location = newLoc;

        // ... encounter timer logic ...
        
        io.to(socket.id).emit('updateMap', { location: pState.location, mapData: currentMap });
    });

    socket.on('interact', () => {
        const pState = playerStates[socket.id];
        const { mapX, mapY, x, y } = pState.location;
        const mapKey = `${mapX},${mapY}`;
        const mapData = worldMaps.get(mapKey);
        
        // Check for NPC interaction
        const targetNpc = mapData.npcs.find(npc => npc.x === x && npc.y === y);
        if (targetNpc) {
            pState.state = 'npc_battle';
            // Start an NPC battle (similar to PvP but with AI)
        }
        
        // Check for tile interaction (shrine, mart, etc.)
        const tile = mapData.grid[y][x];
        if (tile === 4) socket.emit('enterChallengeQueue');
        if (tile === 5) socket.emit('getShopData');
        if (tile === 6) socket.emit('healParty');
    });
    
    // ... rest of the server logic ...
});
