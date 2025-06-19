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

// --- Game Constants & Generation Functions ---
const POKEMON_PREFIXES = ['Aero', 'Aqua', 'Blaze', 'Geo', 'Cryo', 'Draco', 'Electro', 'Psy', 'Umbra', 'Lumi'];
const POKEMON_SUFFIXES = ['don', 'zor', 'wing', 'fang', 'dillo', 'moth', 'lyte', 'nix', 'gon', 'leon'];
const MOVE_PREFIXES = ['Hyper', 'Giga', 'Sonic', 'Psycho', 'Shadow', 'Aqua', 'Inferno', 'Terra', 'Glacial'];
const MOVE_SUFFIXES = ['Beam', 'Blast', 'Punch', 'Wave', 'Claw', 'Drain', 'Burst', 'Crush', 'Spike'];
const TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Rock', 'Ghost', 'Normal'];
const TYPE_CHART = { Fire: { weakTo: ['Water', 'Rock'], strongAgainst: ['Grass'] }, Water: { weakTo: ['Grass', 'Electric'], strongAgainst: ['Fire', 'Rock'] }, Grass: { weakTo: ['Fire'], strongAgainst: ['Water', 'Rock'] }, Electric: { weakTo: ['Rock'], strongAgainst: ['Water'] }, Rock: { weakTo: ['Water', 'Grass'], strongAgainst: ['Fire', 'Electric'] }, Ghost: { weakTo: ['Ghost'], strongAgainst: ['Ghost'], immuneTo: ['Normal'] }, Normal: { weakTo: ['Rock'], strongAgainst: [] } };
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function generateMove(type) { return { name: `${getRandom(MOVE_PREFIXES)} ${getRandom(MOVE_SUFFIXES)}`, type: Math.random() < 0.5 ? type : getRandom(TYPES), power: Math.floor(Math.random() * 30) + 20 }; }
function generatePokemon() {
    const name = `${getRandom(POKEMON_PREFIXES)}${getRandom(POKEMON_SUFFIXES)}`;
    const type = getRandom(TYPES);
    const baseHp = Math.floor(Math.random() * 40) + 80;
    return { name, type, maxHp: baseHp, currentHp: baseHp, attack: Math.floor(Math.random() * 20) + 30, defense: Math.floor(Math.random() * 20) + 30, moves: [generateMove(type), generateMove(type), generateMove(type), generateMove(type)], isFainted: false };
}

const worldMaps = new Map();
function generateMap(mapX, mapY) {
    const grid = Array(MAP_HEIGHT).fill(0).map(() => Array(MAP_WIDTH).fill(0));
    for (let i = 0; i < 40; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 1; } // Trees
    for (let i = 0; i < 30; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 2; } // Water
    for (let i = 0; i < 50; i++) { grid[Math.floor(Math.random() * MAP_HEIGHT)][Math.floor(Math.random() * MAP_WIDTH)] = 3; } // Grass
    if (mapX === 0 && mapY === 0) { grid[7][10] = 4; } // Challenge Shrine
    return grid;
}

const playerStates = {};
const gameRooms = {};

function createPlayerState(socketId) {
    playerStates[socketId] = { id: socketId, state: 'lobby', roomId: null, party: [], location: null, encounterTimer: null };
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    createPlayerState(socket.id);

    socket.on('findGame', () => {
        const waitingPlayerSocketId = Object.keys(playerStates).find(id => playerStates[id] && playerStates[id].state === 'waiting' && id !== socket.id);
        if (waitingPlayerSocketId) {
            const opponentSocket = io.sockets.sockets.get(waitingPlayerSocketId);
            if (!opponentSocket) {
                delete playerStates[waitingPlayerSocketId];
                playerStates[socket.id].state = 'waiting';
                socket.emit('waiting');
                return;
            }
            const roomId = `${socket.id}#${opponentSocket.id}`;
            const p1Party = playerStates[opponentSocket.id].party.length > 0 ? playerStates[opponentSocket.id].party : [generatePokemon(), generatePokemon(), generatePokemon()];
            const p2Party = playerStates[socket.id].party.length > 0 ? playerStates[socket.id].party : [generatePokemon(), generatePokemon(), generatePokemon()];
            const gameState = { roomId, phase: 'battle', turn: 'player1', players: { player1: { id: opponentSocket.id, party: p1Party, activePokemonIndex: 0 }, player2: { id: socket.id, party: p2Party, activePokemonIndex: 0 } } };
            gameRooms[roomId] = gameState;
            playerStates[opponentSocket.id] = { ...playerStates[opponentSocket.id], state: 'pvpBattle', roomId };
            playerStates[socket.id] = { ...playerStates[socket.id], state: 'pvpBattle', roomId };
            socket.join(roomId);
            opponentSocket.join(roomId);
            io.to(roomId).emit('gameStart', {});
            io.to(roomId).emit('updateGameState', gameState);
            io.to(roomId).emit('logMessage', `Battle Start! Player 1's turn!`);
        } else {
            playerStates[socket.id].state = 'waiting';
            socket.emit('waiting');
        }
    });
    
    socket.on('chooseMove', ({ moveIndex, battleType }) => {
        const pState = playerStates[socket.id];
        let attackerKey, defenderKey, attacker, defender, room;

        if (battleType === 'wild') {
            attacker = pState.party[pState.activePokemonIndex];
            defender = pState.wildPokemon;
        } else {
            if (!pState || !pState.roomId || !gameRooms[pState.roomId]) return;
            room = gameRooms[pState.roomId];
            if (room.phase !== 'battle') return;
            attackerKey = room.turn;
            if (room.players[attackerKey].id !== socket.id) return;
            defenderKey = attackerKey === 'player1' ? 'player2' : 'player1';
            attacker = room.players[attackerKey].party[room.players[attackerKey].activePokemonIndex];
            defender = room.players[defenderKey].party[room.players[defenderKey].activePokemonIndex];
        }

        const move = attacker.moves[moveIndex];
        let damage = (move.power * (attacker.attack / defender.defense)) * (Math.random() * 0.3 + 0.85);
        let effectivenessText = '';
        if (TYPE_CHART[move.type].strongAgainst.includes(defender.type)) { damage *= 2; effectivenessText = " It's super effective!"; }
        if (TYPE_CHART[move.type].weakTo.includes(defender.type)) { damage *= 0.5; effectivenessText = " It's not very effective..."; }
        defender.currentHp = Math.max(0, defender.currentHp - damage);

        const logTarget = battleType === 'wild' ? socket.id : room.roomId;
        io.to(logTarget).emit('logMessage', `${attacker.name} used ${move.name}! It dealt ${Math.floor(damage)} damage.${effectivenessText}`);

        if (defender.currentHp <= 0) {
            defender.isFainted = true;
            io.to(logTarget).emit('logMessage', `${defender.name} fainted!`);
            
            if (battleType === 'wild') {
                io.to(socket.id).emit('logMessage', 'You defeated the wild Pokémon!');
                setTimeout(() => { enterMapMode(socket.id); }, 2000);
                return;
            }

            room.phase = 'fainted';
            io.to(room.roomId).emit('updateGameState', room);

            setTimeout(() => {
                const remainingPokemon = room.players[defenderKey].party.filter(p => !p.isFainted);
                if (remainingPokemon.length === 0) {
                    const winnerId = room.players[attackerKey].id;
                    const loserId = room.players[defenderKey].id;
                    playerStates[winnerId].party = room.players[attackerKey].party;
                    playerStates[loserId].party = room.players[defenderKey].party;
                    io.to(winnerId).emit('endGame', 'win');
                    enterMapMode(loserId);
                    delete gameRooms[room.roomId];
                } else {
                    io.to(room.players[defenderKey].id).emit('promptChoice', { title: 'Choose your next Pokémon!', choices: remainingPokemon, type: 'forceSwitch' });
                }
            }, 2000);
        } else {
            if (battleType !== 'wild') {
                room.turn = defenderKey;
                io.to(room.roomId).emit('updateGameState', room);
            } else {
                io.to(socket.id).emit('wildBattleUpdate', { playerPokemon: attacker, wildPokemon: defender });
            }
        }
    });

    socket.on('switchPokemon', ({ pokemonIndex }) => {
        const pState = playerStates[socket.id];
        if (!pState || !pState.roomId || !gameRooms[pState.roomId]) return;
        const room = gameRooms[pState.roomId];
        const playerKey = room.players.player1.id === socket.id ? 'player1' : 'player2';
        room.players[playerKey].activePokemonIndex = pokemonIndex;
        const isForced = room.phase === 'fainted';
        const opponentKey = playerKey === 'player1' ? 'player2' : 'player1';
        if (isForced) {
            room.phase = 'battle';
            room.turn = opponentKey;
            io.to(room.roomId).emit('logMessage', `${playerKey} sent out ${room.players[playerKey].party[pokemonIndex].name}! It's now ${opponentKey}'s turn.`);
        }
        io.to(room.roomId).emit('updateGameState', room);
    });

    function enterMapMode(socketId) {
        const pState = playerStates[socketId];
        if (!pState) return;
        pState.state = 'map';
        pState.party.forEach(p => { p.currentHp = p.maxHp; p.isFainted = false; });
        if (!pState.location) pState.location = { mapX: 0, mapY: 0, x: 10, y: 8 };
        const { mapX, mapY } = pState.location;
        const mapKey = `${mapX},${mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(mapX, mapY)); }
        io.to(socketId).emit('enterMapMode', { location: pState.location, mapGrid: worldMaps.get(mapKey), party: pState.party });
    }

    socket.on('move', ({ direction }) => {
        const pState = playerStates[socket.id];
        if (!pState || pState.state !== 'map') return;
        let { mapX, mapY, x, y } = pState.location;
        const newLoc = { mapX, mapY, x, y };
        if (direction === 'w') newLoc.y--; if (direction === 's') newLoc.y++; if (direction === 'a') newLoc.x--; if (direction === 'd') newLoc.x++;
        if (newLoc.x < 0) { newLoc.mapX--; newLoc.x = MAP_WIDTH - 1; } if (newLoc.x >= MAP_WIDTH) { newLoc.mapX++; newLoc.x = 0; }
        if (newLoc.y < 0) { newLoc.mapY--; newLoc.y = MAP_HEIGHT - 1; } if (newLoc.y >= MAP_HEIGHT) { newLoc.mapY++; newLoc.y = 0; }
        const mapKey = `${newLoc.mapX},${newLoc.mapY}`;
        if (!worldMaps.has(mapKey)) { worldMaps.set(mapKey, generateMap(newLoc.mapX, newLoc.mapY)); }
        const currentMap = worldMaps.get(mapKey);
        const tile = currentMap[newLoc.y][newLoc.x];
        if (tile === 1 || tile === 2) return;
        pState.location = newLoc;
        if (pState.encounterTimer) { clearInterval(pState.encounterTimer); pState.encounterTimer = null; }
        if (tile === 3) {
            pState.encounterTimer = setTimeout(() => {
                if (Math.random() < 0.15) {
                    if (pState.state !== 'map') return;
                    pState.state = 'wildBattle';
                    pState.wildPokemon = generatePokemon();
                    pState.activePokemonIndex = 0;
                    io.to(socket.id).emit('startWildBattle', { wildPokemon: pState.wildPokemon, playerParty: pState.party });
                }
            }, 5000);
        } else if (tile === 4) {
            pState.state = 'waiting';
            io.to(socket.id).emit('returnToLobby');
            return;
        }
        io.to(socket.id).emit('updateMap', { location: pState.location, mapGrid: currentMap });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const pState = playerStates[socket.id];
        if (pState) {
            if (pState.encounterTimer) clearInterval(pState.encounterTimer);
            if (pState.roomId && gameRooms[pState.roomId]) {
                io.to(pState.roomId).emit('opponentDisconnected');
                delete gameRooms[pState.roomId];
            }
        }
        delete playerStates[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));