// File: server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Game Constants & Data ---
const POKEMON_PREFIXES = ['Aero', 'Aqua', 'Blaze', 'Geo', 'Cryo', 'Draco', 'Electro', 'Psy', 'Umbra', 'Lumi'];
const POKEMON_SUFFIXES = ['don', 'zor', 'wing', 'fang', 'dillo', 'moth', 'lyte', 'nix', 'gon', 'leon'];
const MOVE_PREFIXES = ['Hyper', 'Giga', 'Sonic', 'Psycho', 'Shadow', 'Aqua', 'Inferno', 'Terra', 'Glacial'];
const MOVE_SUFFIXES = ['Beam', 'Blast', 'Punch', 'Wave', 'Claw', 'Drain', 'Burst', 'Crush', 'Spike'];
const TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Rock', 'Ghost', 'Normal'];
const TYPE_CHART = { Fire: { weakTo: ['Water', 'Rock'], strongAgainst: ['Grass'] }, Water: { weakTo: ['Grass', 'Electric'], strongAgainst: ['Fire', 'Rock'] }, Grass: { weakTo: ['Fire'], strongAgainst: ['Water', 'Rock'] }, Electric: { weakTo: ['Rock'], strongAgainst: ['Water'] }, Rock: { weakTo: ['Water', 'Grass'], strongAgainst: ['Fire', 'Electric'] }, Ghost: { weakTo: ['Ghost'], strongAgainst: ['Ghost'], immuneTo: ['Normal'] }, Normal: { weakTo: ['Rock'], strongAgainst: [] } };
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;

const PERMANENT_UPGRADES = {
    'hp_plus_1': { name: "Vitality Training", cost: 100, description: "All your Pokémon start with +10 max HP permanently.", apply: (pState) => { pState.upgrades.baseHp += 10; } },
    'atk_plus_1': { name: "Attack Training", cost: 150, description: "All your Pokémon start with +5 base Attack permanently.", apply: (pState) => { pState.upgrades.baseAtk += 5; } },
    'better_mons': { name: "Scouting Report", cost: 300, description: "Your starting Pokémon will have slightly better base stats.", apply: (pState) => { pState.upgrades.betterMons = true; } }
};

// --- Generation Functions ---
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
    for (let i = 0; i < 40; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 1; } // Trees
    for (let i = 0; i < 30; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 2; } // Water
    for (let i = 0; i < 50; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 3; } // Grass
    if (mapX === 0 && mapY === 0) {
        grid[7][8] = 4;  // Challenge Shrine
        grid[7][10] = 5; // Poké Mart
        grid[7][12] = 6; // Poké Center
    }
    return grid;
}

const playerStates = {};
const gameRooms = {};

function createPlayerState(socketId) {
    playerStates[socketId] = {
        id: socketId,
        state: 'hub', // hub, waiting_for_run, in_pvp_battle, wild_battle
        party: [],
        currency: 0,
        upgrades: { baseHp: 0, baseAtk: 0, betterMons: false, purchased: [] },
        location: { mapX: 0, mapY: 0, x: 9, y: 8 },
        encounterTimer: null
    };
    playerStates[socketId].party = [generatePokemon(), generatePokemon(), generatePokemon()];
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    createPlayerState(socket.id);
    enterHubMode(socket.id);

    socket.on('enterChallengeQueue', () => {
        const pState = playerStates[socket.id];
        pState.state = 'waiting_for_run';
        io.to(socket.id).emit('logMessage', 'Waiting for another challenger...');
        
        const opponentId = Object.keys(playerStates).find(id => playerStates[id] && playerStates[id].state === 'waiting_for_run' && id !== socket.id);
        if (opponentId) {
            const roomId = `${socket.id}#${opponentId}`;
            const p1State = playerStates[opponentId];
            const p2State = playerStates[socket.id];
            
            p1State.state = 'in_pvp_battle';
            p2State.state = 'in_pvp_battle';
            p1State.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
            p2State.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
            
            const gameState = { roomId, phase: 'battle', turn: 'player1', players: { player1: { id: p1State.id, party: p1State.party, activePokemonIndex: 0 }, player2: { id: p2State.id, party: p2State.party, activePokemonIndex: 0 } } };
            gameRooms[roomId] = gameState;
            
            io.sockets.sockets.get(opponentId).join(roomId);
            socket.join(roomId);

            io.to(roomId).emit('gameStart', gameState);
            io.to(roomId).emit('logMessage', `A challenger appears! Battle Start!`);
        }
    });

    socket.on('chooseMove', ({ moveIndex }) => {
        // ... Battle logic remains largely the same, but outcome is different ...
        // On battle loss:
        // winnerState.currency += 100;
        // loserState.currency += 25;
        // io.to(winnerId).emit('updateCurrency', winnerState.currency);
        // io.to(winnerId).emit('logMessage', 'You won! You earned $P100. Find the shrine to battle again.');
        // enterHubMode(winnerId);
        // enterHubMode(loserId);
        // delete gameRooms[roomId];
    });

    socket.on('buyUpgrade', (upgradeId) => {
        const pState = playerStates[socket.id];
        const upgrade = PERMANENT_UPGRADES[upgradeId];
        if (pState.currency >= upgrade.cost && !pState.upgrades.purchased.includes(upgradeId)) {
            pState.currency -= upgrade.cost;
            pState.upgrades.purchased.push(upgradeId);
            upgrade.apply(pState);
            io.to(socket.id).emit('updatePlayerState', pState);
            io.to(socket.id).emit('logMessage', `Purchased ${upgrade.name}!`);
        }
    });

    socket.on('healParty', () => {
        const pState = playerStates[socket.id];
        pState.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
        io.to(socket.id).emit('updatePlayerState', pState);
        io.to(socket.id).emit('logMessage', "Your Pokémon are fully healed!");
    });

    function enterHubMode(socketId) {
        const pState = playerStates[socketId];
        if (!pState) return;
        pState.state = 'hub';
        const { mapX, mapY } = pState.location;
        const mapKey = `${mapX},${mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(mapX, mapY)); }
        io.to(socketId).emit('enterHubMode', { location: pState.location, mapGrid: worldMaps.get(mapKey), playerState: pState });
    }
    
    // ... other socket listeners like move, switchPokemon, disconnect ...
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
