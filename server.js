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
        state: 'hub',
        party: [],
        currency: 0,
        upgrades: { baseHp: 0, baseAtk: 0, betterMons: false, purchased: [] },
        location: { mapX: 0, mapY: 0, x: 9, y: 8 },
        encounterTimer: null
    };
    // Give player a fresh team when they first join
    playerStates[socketId].party = [generatePokemon(), generatePokemon(), generatePokemon()];
}

function enterHubMode(socketId) {
    const pState = playerStates[socketId];
    if (!pState) return;
    pState.state = 'hub';
    const { mapX, mapY } = pState.location;
    const mapKey = `${mapX},${mapY}`;
    if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(mapX, mapY)); }
    io.to(socketId).emit('enterHubMode', { location: pState.location, mapGrid: worldMaps.get(mapKey), playerState: pState });
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    createPlayerState(socket.id);
    enterHubMode(socket.id);

    socket.on('enterChallengeQueue', () => {
        const pState = playerStates[socket.id];
        if (pState.state !== 'hub') return;
        pState.state = 'waiting_for_run';
        io.to(socket.id).emit('logMessage', 'Waiting for another challenger...');
        
        const opponentId = Object.keys(playerStates).find(id => playerStates[id] && playerStates[id].state === 'waiting_for_run' && id !== socket.id);
        if (opponentId) {
            const roomId = `${socket.id}#${opponentId}`;
            const p1State = playerStates[opponentId];
            const p2State = playerStates[socket.id];
            
            p1State.state = 'in_pvp_battle'; p1State.roomId = roomId;
            p2State.state = 'in_pvp_battle'; p2State.roomId = roomId;
            
            p1State.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
            p2State.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
            
            const gameState = { roomId, phase: 'battle', turn: 'player1', players: { player1: { id: p1State.id, party: p1State.party, activePokemonIndex: 0 }, player2: { id: p2State.id, party: p2State.party, activePokemonIndex: 0 } } };
            gameRooms[roomId] = gameState;
            
            io.sockets.sockets.get(opponentId).join(roomId);
            socket.join(roomId);

            io.to(roomId).emit('gameStart', gameState);
        }
    });

    socket.on('chooseMove', ({ moveIndex }) => {
        const pState = playerStates[socket.id];
        if (!pState || !pState.roomId || !gameRooms[pState.roomId]) return;
        const room = gameRooms[pState.roomId];
        if (room.phase !== 'battle') return;

        const attackerKey = room.turn;
        if (room.players[attackerKey].id !== socket.id) return;
        const defenderKey = attackerKey === 'player1' ? 'player2' : 'player1';
        const attacker = room.players[attackerKey].party[room.players[attackerKey].activePokemonIndex];
        const defender = room.players[defenderKey].party[room.players[defenderKey].activePokemonIndex];
        const move = attacker.moves[moveIndex];

        let damage = (move.power * (attacker.attack / defender.defense)) * (Math.random() * 0.3 + 0.85);
        let effectivenessText = '';
        if (TYPE_CHART[move.type].strongAgainst.includes(defender.type)) { damage *= 2; effectivenessText = " It's super effective!"; }
        if (TYPE_CHART[move.type].weakTo.includes(defender.type)) { damage *= 0.5; effectivenessText = " It's not very effective..."; }
        defender.currentHp = Math.max(0, defender.currentHp - damage);

        io.to(room.roomId).emit('logMessage', `${attacker.name} used ${move.name}! It dealt ${Math.floor(damage)} damage.${effectivenessText}`);
        
        if (defender.currentHp <= 0) {
            defender.isFainted = true;
            room.phase = 'fainted';
            io.to(room.roomId).emit('updateGameState', room);
            io.to(room.roomId).emit('logMessage', `${defender.name} fainted!`);

            setTimeout(() => {
                const remainingPokemon = room.players[defenderKey].party.filter(p => !p.isFainted);
                if (remainingPokemon.length === 0) {
                    const winnerId = room.players[attackerKey].id;
                    const loserId = room.players[defenderKey].id;
                    playerStates[winnerId].currency += 100;
                    playerStates[loserId].currency += 25;
                    enterHubMode(winnerId);
                    enterHubMode(loserId);
                    delete gameRooms[room.roomId];
                } else {
                    io.to(room.players[defenderKey].id).emit('promptChoice', { title: 'Choose your next Pokémon!', choices: remainingPokemon, type: 'forceSwitch' });
                }
            }, 2000);
        } else {
            room.turn = defenderKey;
            io.to(room.roomId).emit('updateGameState', room);
        }
    });

    socket.on('switchPokemon', ({ pokemonIndex }) => {
        const pState = playerStates[socket.id];
        if (!pState || !pState.roomId || !gameRooms[pState.roomId]) return;
        const room = gameRooms[pState.roomId];
        const playerKey = room.players.player1.id === socket.id ? 'player1' : 'player2';
        room.players[playerKey].activePokemonIndex = pokemonIndex;
        if (room.phase === 'fainted') {
            room.phase = 'battle';
            room.turn = playerKey === 'player1' ? 'player2' : 'player1';
        }
        io.to(room.roomId).emit('updateGameState', room);
    });

    socket.on('buyUpgrade', (upgradeId) => {
        const pState = playerStates[socket.id];
        const upgrade = PERMANENT_UPGRADES[upgradeId];
        if (pState.currency >= upgrade.cost && !pState.upgrades.purchased.includes(upgradeId)) {
            pState.currency -= upgrade.cost;
            pState.upgrades.purchased.push(upgradeId);
            upgrade.apply(pState);
            pState.party = pState.party.map(p => generatePokemon(pState.upgrades)); // Regenerate team with upgrades
            io.to(socket.id).emit('updatePlayerState', pState);
            io.to(socket.id).emit('logMessage', `Purchased ${upgrade.name}! Your team has been updated.`);
        }
    });

    socket.on('healParty', () => {
        const pState = playerStates[socket.id];
        pState.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
        io.to(socket.id).emit('updatePlayerState', pState);
        io.to(socket.id).emit('logMessage', "Your Pokémon are fully healed!");
    });
    
    socket.on('move', ({ direction }) => {
        const pState = playerStates[socket.id];
        if (!pState || pState.state !== 'hub') return;

        let { mapX, mapY, x, y } = pState.location;
        const newLoc = { mapX, mapY, x, y };

        if (direction === 'w') newLoc.y--; if (direction === 's') newLoc.y++;
        if (direction === 'a') newLoc.x--; if (direction === 'd') newLoc.x++;

        if (newLoc.x < 0) { newLoc.mapX--; newLoc.x = MAP_WIDTH - 1; }
        if (newLoc.x >= MAP_WIDTH) { newLoc.mapX++; newLoc.x = 0; }
        if (newLoc.y < 0) { newLoc.mapY--; newLoc.y = MAP_HEIGHT - 1; }
        if (newLoc.y >= MAP_HEIGHT) { newLoc.mapY++; newLoc.y = 0; }
        
        const mapKey = `${newLoc.mapX},${newLoc.mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(newLoc.mapX, newLoc.mapY)); }
        const currentMap = worldMaps.get(mapKey);
        
        const tile = currentMap[newLoc.y][newLoc.x];
        if (tile === 1 || tile === 2) return; // Collision

        pState.location = newLoc;
        io.to(socket.id).emit('updateMap', { location: pState.location, mapGrid: currentMap });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const pState = playerStates[socket.id];
        if (pState && pState.roomId && gameRooms[pState.roomId]) {
            io.to(pState.roomId).emit('opponentDisconnected');
            delete gameRooms[pState.roomId];
        }
        delete playerStates[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
