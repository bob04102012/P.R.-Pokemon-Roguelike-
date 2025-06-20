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

// --- Game Constants & Data (Identical) ---
const POKEMON_PREFIXES = ['Aero', 'Aqua', 'Blaze', 'Geo', 'Cryo', 'Draco', 'Electro', 'Psy', 'Umbra', 'Lumi'];
const POKEMON_SUFFIXES = ['don', 'zor', 'wing', 'fang', 'dillo', 'moth', 'lyte', 'nix', 'gon', 'leon'];
const MOVE_PREFIXES = ['Hyper', 'Giga', 'Sonic', 'Psycho', 'Shadow', 'Aqua', 'Inferno', 'Terra', 'Glacial'];
const MOVE_SUFFIXES = ['Beam', 'Blast', 'Punch', 'Wave', 'Claw', 'Drain', 'Burst', 'Crush', 'Spike'];
const TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Rock', 'Ghost', 'Normal'];
const TYPE_CHART = { Fire: { weakTo: ['Water', 'Rock'], strongAgainst: ['Grass'] }, Water: { weakTo: ['Grass', 'Electric'], strongAgainst: ['Fire', 'Rock'] }, Grass: { weakTo: ['Fire'], strongAgainst: ['Water', 'Rock'] }, Electric: { weakTo: ['Rock'], strongAgainst: ['Water'] }, Rock: { weakTo: ['Water', 'Grass'], strongAgainst: ['Fire', 'Electric'] }, Ghost: { weakTo: ['Ghost'], strongAgainst: ['Ghost'], immuneTo: ['Normal'] }, Normal: { weakTo: ['Rock'], strongAgainst: [] } };
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;
const PERMANENT_UPGRADES = {
    'hp_plus': { name: "Vitality Training", baseCost: 100, description: "All your Pokémon start with +10 max HP per level.", apply: (pState) => { pState.upgrades.baseHp += 10; } },
    'atk_plus': { name: "Attack Training", baseCost: 150, description: "All your Pokémon start with +5 base Attack per level.", apply: (pState) => { pState.upgrades.baseAtk += 5; } },
    'scouting': { name: "Scouting Report", baseCost: 500, description: "Your starting Pokémon have permanently better base stats (one-time purchase).", apply: (pState) => { pState.upgrades.betterMons = true; } }
};

// --- Generation Functions (Identical) ---
function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function generateMove(type) { return { name: `${getRandom(MOVE_PREFIXES)} ${getRandom(MOVE_SUFFIXES)}`, type: Math.random() < 0.5 ? type : getRandom(TYPES), power: Math.floor(Math.random() * 30) + 20 }; }
function generatePokemon(upgrades = { baseHp: 0, baseAtk: 0, betterMons: false }) {
    const name = `${getRandom(POKEMON_PREFIXES)}${getRandom(POKEMON_SUFFIXES)}`;
    const type = getRandom(TYPES);
    const hpBonus = upgrades.betterMons ? 15 : 0;
    const atkBonus = upgrades.betterMons ? 5 : 0;
    const baseHp = Math.floor(Math.random() * 40) + 80 + upgrades.baseHp + hpBonus;
    const baseAtk = Math.floor(Math.random() * 20) + 30 + upgrades.baseAtk + atkBonus;
    return { name, type, maxHp: baseHp, currentHp: baseHp, attack: baseAtk, defense: Math.floor(Math.random() * 20) + 30, moves: [generateMove(type), generateMove(type), generateMove(type), generateMove(type)], isFainted: false };
}
const worldMaps = new Map();
function generateMap(mapX, mapY) {
    const grid = Array(MAP_HEIGHT).fill(0).map(() => Array(MAP_WIDTH).fill(0));
    for (let i = 0; i < 40; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 1; }
    for (let i = 0; i < 30; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 2; }
    for (let i = 0; i < 50; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 3; }
    if (mapX === 0 && mapY === 0) { grid[7][8] = 4; grid[7][10] = 5; grid[7][12] = 6; }
    return grid;
}

// --- Player State Management (Identical) ---
const playerStates = {};
const gameRooms = {};
function createPlayerState(socketId) {
    playerStates[socketId] = { id: socketId, state: 'hub', party: [], currency: 0, upgrades: { baseHp: 0, baseAtk: 0, betterMons: false, levels: { 'hp_plus': 0, 'atk_plus': 0, 'scouting': 0 } }, location: { mapX: 0, mapY: 0, x: 9, y: 8 }, roomId: null };
    playerStates[socketId].party = [generatePokemon(), generatePokemon(), generatePokemon()];
}
function enterHubMode(socketId) {
    const pState = playerStates[socketId];
    if (!pState) return;
    pState.state = 'hub'; pState.roomId = null;
    pState.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
    const { mapX, mapY } = pState.location;
    const mapKey = `${mapX},${mapY}`;
    if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(mapX, mapY)); }
    io.to(socketId).emit('enterHubMode', { location: pState.location, mapGrid: worldMaps.get(mapKey), playerState: pState });
}

// --- Socket Connection Handler ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    createPlayerState(socket.id);
    enterHubMode(socket.id);

    socket.on('enterChallengeQueue', () => { /* ... Identical ... */ });
    socket.on('chooseMove', ({ moveIndex }) => { /* ... Identical ... */ });
    socket.on('switchPokemon', ({ pokemonIndex }) => { /* ... Identical ... */ });
    socket.on('getShopData', () => { /* ... Identical ... */ });
    socket.on('buyUpgrade', (upgradeId) => { /* ... Identical ... */ });
    socket.on('healParty', () => { /* ... Identical ... */ });

    // *** THE MOVEMENT FIX IS HERE ***
    socket.on('move', ({ dx, dy }) => {
        const pState = playerStates[socket.id];
        if (!pState || pState.state !== 'hub' || (dx === 0 && dy === 0)) return;

        let { mapX, mapY, x, y } = pState.location;
        const newLoc = { mapX, mapY, x: x + dx, y: y + dy };

        if (newLoc.x < 0) { newLoc.mapX--; newLoc.x = MAP_WIDTH - 1; }
        if (newLoc.x >= MAP_WIDTH) { newLoc.mapX++; newLoc.x = 0; }
        if (newLoc.y < 0) { newLoc.mapY--; newLoc.y = MAP_HEIGHT - 1; }
        if (newLoc.y >= MAP_HEIGHT) { newLoc.mapY++; newLoc.y = 0; }
        
        const mapKey = `${newLoc.mapX},${newLoc.mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(newLoc.mapX, newLoc.mapY)); }
        const currentMap = worldMaps.get(mapKey);
        
        // Final boundary and collision check
        if (newLoc.y < 0 || newLoc.y >= MAP_HEIGHT || newLoc.x < 0 || newLoc.x >= MAP_WIDTH || currentMap[newLoc.y][newLoc.x] === 1 || currentMap[newLoc.y][newLoc.x] === 2) {
            return; // Invalid move
        }
        
        pState.location = newLoc;
        io.to(socket.id).emit('updateMap', { location: pState.location, mapGrid: currentMap });
    });

    socket.on('disconnect', () => { /* ... Identical ... */ });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
