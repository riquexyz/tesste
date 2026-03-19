// Configuração do canvas
const canvas = document.getElementById('trafficCanvas');
const ctx = canvas.getContext('2d');

// Variáveis de controle
let simulationRunning = true;
let collisionOccurred = false;
let ambulanceActive = false;
let victimStatus = '';

// Variáveis para controle de áudio
let crashAudio = null;
let sireneAudio = null;

// Sistema de Fumaça
let smokeParticles = [];

class SmokeParticle {
    constructor(x, y) {
        this.x = x + (Math.random() - 0.5) * 30;
        this.y = y + (Math.random() - 0.5) * 20;
        this.size = Math.random() * 8 + 3;
        this.speedY = Math.random() * 0.8 + 0.3;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.opacity = 0.7 + Math.random() * 0.3;
        this.life = 1.0;
        this.decay = 0.002 + Math.random() * 0.003;
    }
    
    update() {
        this.y -= this.speedY;
        this.x += this.speedX;
        this.life -= this.decay;
        this.opacity = this.life * 0.7;
        this.size += 0.1;
        this.speedX *= 0.99;
    }
    
    draw() {
        if (this.life <= 0) return;
        
        ctx.save();
        ctx.globalAlpha = this.opacity;
        
        const gradient = ctx.createRadialGradient(
            this.x, this.y, 0,
            this.x, this.y, this.size
        );
        gradient.addColorStop(0, 'rgba(180, 180, 180, 0.8)');
        gradient.addColorStop(0.5, 'rgba(120, 120, 120, 0.5)');
        gradient.addColorStop(1, 'rgba(80, 80, 80, 0.2)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Elementos da interface
const reportLog = document.getElementById('reportLog');
const victimStatusText = document.getElementById('victimStatusText');
const currentTimeDisplay = document.getElementById('currentTime');
const restartBtn = document.getElementById('restartBtn');

// ===== CARROS RANDOMIZADOS =====
const carColors = ['#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'];
const carTypes = ['Sedan', 'Hatch', 'SUV', 'Esportivo', 'Picape'];

function randomCar() {
    return {
        color: carColors[Math.floor(Math.random() * carColors.length)],
        type: carTypes[Math.floor(Math.random() * carTypes.length)]
    };
}

// car1 = car going RIGHT on horizontal road (bottom lane y~276)
// car2 = motorcycle going DOWN on vertical road (right lane x~375)
// Velocidades sincronizadas: os dois chegam ao cruzamento no mesmo frame
const CAR1_SPEED = 1.8;
const CAR2_SPEED = 1.3821; // 1.8 * (215/280) — mesma quantidade de frames

let car1 = { 
    x: 100, y: 276, speed: CAR1_SPEED, active: true, 
    color: carColors[Math.floor(Math.random() * carColors.length)],
    type: carTypes[Math.floor(Math.random() * carTypes.length)]
};

let car2 = { 
    x: 375, y: 60, speed: CAR2_SPEED, active: true, 
    color: carColors[Math.floor(Math.random() * carColors.length)],
    type: 'Moto'
};

// Ambulância
let ambulance = { 
    x: 0, 
    y: 0, 
    active: false, 
    state: 'coming',
    direction: 'left',
    stage: 'exitParking'
};

// Histórico de eventos
let eventLog = [];

// ===== FUNÇÕES DE ÁUDIO =====
function initAudios() {
    try {
        crashAudio = document.getElementById('crashSound');
        sireneAudio = document.getElementById('sireneSound');
        
        if (crashAudio) {
            crashAudio.volume = 0.7;
            crashAudio.load(); // Forçar carregamento
            console.log('🎵 Áudio de crash carregado:', crashAudio);
        }
        
        if (sireneAudio) {
            sireneAudio.volume = 0.6;
            sireneAudio.load();
            console.log('🎵 Áudio de sirene carregado:', sireneAudio);
        }
        
        console.log('✅ Sistema de áudio inicializado');
    } catch (error) {
        console.error('❌ Erro ao inicializar áudios:', error);
    }
}

function playCrashSound() {
    if (crashAudio) {
        // Parar se estiver tocando e reiniciar
        crashAudio.pause();
        crashAudio.currentTime = 0;
        
        // Tocar
        let playPromise = crashAudio.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('✅ Som de crash tocando');
            }).catch(error => {
                console.error('❌ Erro ao tocar crash:', error);
                // Tentar tocar novamente após interação do usuário
                document.addEventListener('click', function playOnClick() {
                    crashAudio.play();
                    document.removeEventListener('click', playOnClick);
                }, { once: true });
            });
        }
    } else {
        console.error('❌ crashAudio não está inicializado');
    }
}

function playSirene() {
    if (sireneAudio) {
        sireneAudio.loop = true;
        sireneAudio.currentTime = 0;
        let playPromise = sireneAudio.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error('❌ Erro ao tocar sirene:', error);
                // Fallback: toca na próxima interação do usuário
                document.addEventListener('click', function playOnClick() {
                    sireneAudio.play();
                    document.removeEventListener('click', playOnClick);
                }, { once: true });
            });
        }
    }
}

function stopSirene() {
    if (sireneAudio) {
        sireneAudio.pause();
        sireneAudio.currentTime = 0;
    }
}

function stopAllSounds() {
    stopSirene();
    if (crashAudio) {
        crashAudio.pause();
        crashAudio.currentTime = 0;
    }
}

// Função para testar áudio manualmente
window.testarCrash = function() {
    console.log('🔊 Testando áudio de crash...');
    playCrashSound();
};

window.testarSirene = function() {
    console.log('🔊 Testando áudio de sirene...');
    playSirene();
    setTimeout(stopSirene, 3000);
};

// ===== RELÓGIO DA SIMULAÇÃO =====
// Cada evento chave tem um horário pré-definido e plausível.
// O relógio avança em tempo real, mas começa em SIM_START e
// "pula" para o horário correto quando um evento importante ocorre.

const SIM_START_H = 14, SIM_START_M = 28, SIM_START_S = 12;

// Horários planejados para cada evento (em segundos desde meia-noite)
const EVENT_TIMES = {
    collision:          toSec(14, 30,  0),
    ambulanceCalled:    toSec(14, 30, 45),
    ambulanceArrived:   toSec(14, 32,  0),
    ambulanceLeaving:   toSec(14, 35,  0),
    ambulanceParked:    toSec(14, 37, 30),
};

function toSec(h, m, s) { return h * 3600 + m * 60 + s; }

// Estado do relógio
let simClockSec = toSec(SIM_START_H, SIM_START_M, SIM_START_S);
let lastWallMs  = Date.now();

function tickSimClock() {
    const now = Date.now();
    const elapsed = Math.floor((now - lastWallMs) / 1000);
    if (elapsed > 0) {
        simClockSec += elapsed;
        lastWallMs  += elapsed * 1000;
    }
}

function jumpSimTimeTo(eventKey) {
    // Avança o relógio para o horário do evento (nunca volta no tempo)
    const target = EVENT_TIMES[eventKey];
    if (target && target > simClockSec) {
        simClockSec = target;
        lastWallMs  = Date.now();
    }
}

function simTimeStr(offsetSec = 0) {
    tickSimClock();
    const total = simClockSec + offsetSec;
    const h = Math.floor(total / 3600) % 24;
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function resetSimClock() {
    simClockSec = toSec(SIM_START_H, SIM_START_M, SIM_START_S);
    lastWallMs  = Date.now();
}

function updateTime() {
    currentTimeDisplay.textContent = simTimeStr();
}

function addEvent(message, type = 'system', eventKey = null) {
    if (eventKey) jumpSimTimeTo(eventKey);
    const time = simTimeStr();
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-message">${message}</span>`;
    
    reportLog.appendChild(logEntry);
    reportLog.scrollTop = reportLog.scrollHeight;
}

const severityLevels = {
    leve: {
        label: 'LEVE',
        color: '#00ff00',
        bg: 'rgba(0,255,0,0.1)',
        border: '#00ff00',
        icon: '🟢',
        statuses: [
            'Vítima consciente - Escoriações leves',
            'Ferimentos superficiais - Orientado',
            'Dor leve - Sem perda de consciência',
        ]
    },
    moderado: {
        label: 'MODERADO',
        color: '#FFB800',
        bg: 'rgba(255,184,0,0.12)',
        border: '#FFB800',
        icon: '🟡',
        statuses: [
            'Suspeita de fratura - Imobilizado',
            'Dor intensa - Consciente mas confuso',
            'Possível traumatismo craniano leve',
        ]
    },
    grave: {
        label: 'GRAVE',
        color: '#FF2222',
        bg: 'rgba(255,34,34,0.12)',
        border: '#FF2222',
        icon: '🔴',
        statuses: [
            'Inconsciente - Prioridade máxima',
            'Hemorragia - Atendimento urgente',
            'Traumatismo severo - Suporte vital',
        ]
    }
};

let currentSeverity = null;

function generateVictimStatus() {
    const keys = Object.keys(severityLevels);
    // Weighted: 40% leve, 35% moderado, 25% grave
    const roll = Math.random();
    const key = roll < 0.4 ? 'leve' : roll < 0.75 ? 'moderado' : 'grave';
    const sev = severityLevels[key];
    currentSeverity = key;
    const desc = sev.statuses[Math.floor(Math.random() * sev.statuses.length)];
    updateSeverityUI(key, desc);
    return `${sev.icon} ${desc}`;
}

function updateSeverityUI(key, desc) {
    const sev = severityLevels[key];
    const box = document.getElementById('victimStatusText');
    box.textContent = desc;
    box.style.color = sev.color;
    box.style.borderColor = sev.border;
    box.style.background = sev.bg;
    box.style.textShadow = `0 0 8px ${sev.color}44`;

    const badge = document.getElementById('severityBadge');
    badge.textContent = sev.label;
    badge.style.color = sev.color;
    badge.style.borderColor = sev.border;
    badge.style.background = sev.bg;
    badge.style.boxShadow = `0 0 10px ${sev.color}55`;
    badge.style.display = 'inline-block';

    // Animate badge pulse
    badge.style.animation = 'none';
    badge.offsetHeight; // reflow
    badge.style.animation = 'severityPulse 1s ease-in-out 3';
}

// Criar fumaça na colisão
function createCollisionSmoke() {
    for (let i = 0; i < 20; i++) {
        smokeParticles.push(new SmokeParticle(390, 275));
    }
}

// Verificar colisão
function checkCollision() {
    if (!collisionOccurred && car1.active && car2.active) {
        // car1 at intersection x~350-400, car2 at intersection y~250-300
        if (car1.x > 350 && car1.x < 410 && car2.y > 240 && car2.y < 300) {
            collisionOccurred = true;
            car1.speed = 0;
            car2.speed = 0;
            
            playCrashSound();
            createCollisionSmoke();
            panicNPCs();
            
            victimStatus = generateVictimStatus();
            // UI already updated by generateVictimStatus -> updateSeverityUI
            
            addEvent('🚨 COLISÃO DETECTADA no cruzamento!', 'collision', 'collision');
            addEvent(`🚗 ${car1.type} x 🏍️ Moto`, 'collision');
            addEvent(`👤 Status da vítima: ${victimStatus}`, 'collision');
            
            setTimeout(() => {
                callAmbulance();
            }, 2000);
        }
    }
}

function callAmbulance() {
    if (!ambulanceActive) {
        ambulanceActive = true;
        ambulance.active = true;
        ambulance.state = 'coming';
        ambulance.stage = 'exitParking';
        ambulance.x = 710;
        ambulance.y = 510;
        ambulance.direction = 'left'; // left | right | up | down
        
        playSirene();
        addEvent('🚑 AMBULÂNCIA acionada - Saindo do estacionamento', 'ambulance', 'ambulanceCalled');
    }
}

function moveAmbulance() {
    if (!ambulance.active) return;
    
    const speed = 2.5;
    // Lanes:
    // Horizontal road going ← : y = 325
    // Horizontal road going → : y = 270
    // Vertical road going ↑   : x = 428
    const laneLeft  = 325;   // y para ir ←
    const laneRight = 270;   // y para ir →  (volta)
    const laneUp    = 428;   // x para ir ↑
    const accidentY = 258;   // parar acima do cruzamento
    const startX    = 710;   // posição X do estacionamento

    // IDA: estacionamento → esquerda → cima (sem mais curvas)
    // exitParking : x=710 → x=320 (well past the vertical road), y=510, dir ←
    // toHorizLane : y=510 → y=325, x=320, dir ↑ (just going up to enter lane)
    //   actually simpler: go left all the way to x=320 on parking row,
    //   then go straight up from x=320 to accidentY (no extra turns)
    // VOLTA: accidentY → y=350 (saindo da estrada) → vira direita → x=startX → desce → estacionamento

    switch(ambulance.state) {
        case 'coming':
            if (ambulance.stage === 'exitParking') {
                // Ir para esquerda no nível do estacionamento (y=510) até x=320
                if (ambulance.x > 420) {
                    ambulance.x -= speed;
                    ambulance.direction = 'left';
                } else {
                    ambulance.x = 420;
                    ambulance.stage = 'goingUp';
                }
            }
            else if (ambulance.stage === 'goingUp') {
                // Subir direto de y=510 até accidentY — sem mais curvas
                if (ambulance.y > accidentY) {
                    ambulance.y -= speed;
                    ambulance.direction = 'up';
                } else {
                    ambulance.y = accidentY;
                    ambulance.state = 'stopped';
                    ambulance.stage = 'stopped';
                    addEvent('🚑 AMBULÂNCIA chegou ao local do acidente', 'ambulance', 'ambulanceArrived');
                    setTimeout(() => {
                        ambulance.state = 'leaving';
                        ambulance.stage = 'goingDown';
                        addEvent('✅ Atendimento realizado, ambulância voltando', 'ambulance', 'ambulanceLeaving');
                    }, 3000);
                }
            }
            break;

        case 'leaving':
            if (ambulance.stage === 'goingDown') {
                // Descer de accidentY de volta a y=510 (mesmo x=320)
                if (ambulance.y < 510) {
                    ambulance.y += speed;
                    ambulance.direction = 'down';
                } else {
                    ambulance.y = 510;
                    ambulance.stage = 'goingRight';
                }
            }
            else if (ambulance.stage === 'goingRight') {
                // Ir para direita de x=320 até x=startX
                if (ambulance.x < startX) {
                    ambulance.x += speed;
                    ambulance.direction = 'right';
                } else {
                    ambulance.x = startX;
                    ambulance.active = false;
                    ambulanceActive = false;
                    stopSirene();
                    addEvent('🏥 Ambulância estacionada no hospital', 'system', 'ambulanceParked');
                }
            }
            break;
    }
}

function moveCars() {
    if (!collisionOccurred) {
        if (car1.active) {
            car1.x += car1.speed;
            if (car1.x > 800) {
                car1.x = 100;
                car1.speed = CAR1_SPEED;
                let newCar = randomCar();
                car1.color = newCar.color;
                car1.type = newCar.type;
            }
        }
        if (car2.active) {
            car2.y += car2.speed;
            if (car2.y > 620) {
                car2.y = 60;
                car2.speed = CAR2_SPEED;
                let newCar = randomCar();
                car2.color = newCar.color;
                car2.type = 'Moto';
            }
        }
        checkCollision();
    }
}

function drawEstablishments() {
    // Posto de gasolina
    ctx.fillStyle = '#CCCCCC';
    ctx.fillRect(20, 120, 100, 60);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(25, 115, 90, 10);
    ctx.fillStyle = '#333333';
    ctx.fillRect(40, 140, 15, 30);
    ctx.fillRect(70, 140, 15, 30);
    ctx.fillStyle = '#666666';
    ctx.fillRect(20, 110, 100, 10);
    ctx.font = 'bold 10px "Courier New"';
    ctx.fillStyle = '#FFFF00';
    ctx.fillText('GAS', 45, 118);
    
    // Restaurante
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(650, 120, 120, 70);
    ctx.fillStyle = '#FF4500';
    ctx.beginPath();
    ctx.moveTo(650, 120);
    ctx.lineTo(770, 120);
    ctx.lineTo(760, 100);
    ctx.lineTo(640, 100);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(670, 140, 25, 25);
    ctx.fillRect(720, 140, 25, 25);
    ctx.font = 'bold 12px "Courier New"';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('REST', 685, 135);
    ctx.fillText('🍔', 715, 134);
    
    // Loja de conveniência
    ctx.fillStyle = '#4169E1';
    ctx.fillRect(20, 400, 100, 70);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(20, 400, 100, 15);
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(35, 430, 30, 25);
    ctx.fillRect(75, 430, 30, 25);
    ctx.font = 'bold 10px "Courier New"';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('24H', 45, 410);
    
    // HOSPITAL
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(650, 400, 120, 80);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(690, 425, 40, 10);
    ctx.fillRect(705, 410, 10, 40);
    ctx.fillStyle = '#CCCCCC';
    ctx.fillRect(650, 390, 120, 15);
    ctx.font = 'bold 12px "Courier New"';
    ctx.fillStyle = '#FF0000';
    ctx.fillText('HOSP', 680, 403);
    
    // Estacionamento
    ctx.fillStyle = '#444444';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(640, 500, 140, 40);
    ctx.globalAlpha = 1.0;
    
    ctx.strokeStyle = '#FFFF00';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(655 + i * 40, 510);
        ctx.lineTo(655 + i * 40, 530);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    
    ctx.font = '10px "Courier New"';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('A', 715, 525);
    
    ctx.fillStyle = '#333333';
    ctx.fillRect(660, 515, 25, 12);
    ctx.fillStyle = '#666666';
    ctx.fillRect(700, 515, 25, 12);
}

function drawTrees() {
    // Árvores canto superior esquerdo
    for (let i = 0; i < 3; i++) {
        const x = 150 + i * 30;
        const y = 190;
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(x - 2, y, 5, 15);
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.arc(x, y - 8, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#32CD32';
        ctx.beginPath();
        ctx.arc(x - 5, y - 12, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 5, y - 12, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Árvores canto superior direito
    for (let i = 0; i < 3; i++) {
        const x = 550 + i * 30;
        const y = 190;
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(x - 2, y, 5, 15);
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.arc(x, y - 8, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#32CD32';
        ctx.beginPath();
        ctx.arc(x - 5, y - 12, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 5, y - 12, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Árvores perto do hospital
    for (let i = 0; i < 3; i++) {
        const x = 570 + i * 25;
        const y = 540;
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(x - 2, y, 5, 12);
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.arc(x, y - 6, 10, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawDroneView() {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 800, 600);
    
    drawEstablishments();
    drawTrees();
    
    // Grade
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 0.3;
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 600; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(800, i);
        ctx.stroke();
    }
    for (let i = 0; i < 800; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 600);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    
    // Estrada horizontal
    ctx.fillStyle = '#222222';
    ctx.globalAlpha = 0.95;
    ctx.fillRect(0, 250, 800, 100);
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 250, 800, 100);
    
    ctx.strokeStyle = '#FFFF00';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 30]);
    ctx.beginPath();
    ctx.moveTo(0, 300);
    ctx.lineTo(800, 300);
    ctx.stroke();
    
    // Estrada vertical
    ctx.fillStyle = '#222222';
    ctx.fillRect(350, 0, 100, 600);
    ctx.strokeStyle = '#444444';
    ctx.strokeRect(350, 0, 100, 600);
    
    ctx.strokeStyle = '#FFFF00';
    ctx.beginPath();
    ctx.moveTo(400, 0);
    ctx.lineTo(400, 600);
    ctx.stroke();
    
    // Cruzamento
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(350, 250, 100, 100);
    
    // Faixas de pedestres
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
        ctx.fillRect(360, 260 + i * 20, 80, 5);
    }
    ctx.globalAlpha = 1.0;
    
    // Calçadas
    ctx.fillStyle = '#666666';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(0, 210, 800, 40);
    ctx.fillRect(0, 350, 800, 40);
    ctx.fillRect(310, 0, 40, 600);
    ctx.fillRect(450, 0, 40, 600);
    ctx.globalAlpha = 1.0;
    
    // Postes
    ctx.fillStyle = '#FFD700';
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 4; i++) {
        const x = 100 + i * 200;
        ctx.beginPath();
        ctx.arc(x, 225, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#CCCCCC';
        ctx.fillRect(x - 2, 215, 4, 20);
        ctx.fillStyle = '#FFD700';
    }
    ctx.globalAlpha = 1.0;
    
    // Desenhar fumaça
    smokeParticles = smokeParticles.filter(p => p.life > 0);
    smokeParticles.forEach(p => {
        p.update();
        p.draw();
    });
    
    // Adicionar fumaça contínua durante o acidente
    if (collisionOccurred && Math.random() < 0.3) {
        smokeParticles.push(new SmokeParticle(390, 275));
    }
    
    // Carros e moto
    if (car1.active) drawCar(car1.x, car1.y, car1.color, true, car1.type);
    if (car2.active) drawMotorcycle(car2.x, car2.y, car2.color, false);
    
    // Ambulância
    if (ambulance.active) {
        drawAmbulance(ambulance.x, ambulance.y, ambulance.direction);
    }
    
    // NPCs pedestres
    drawNPCs();
    
    // Informações
    ctx.font = 'bold 14px "Courier New"';
    ctx.fillStyle = '#00ff00';
    ctx.fillText('🚁 DRONE - VISÃO AÉREA', 20, 30);
    ctx.font = '10px "Courier New"';
    ctx.fillText('ALT: 120m | ZOOM: 2x', 20, 50);
}

function drawCar(x, y, color, isHorizontal, type) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    if (isHorizontal) {
        // Body
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y + 4, 44, 16, 3);
        ctx.fill();

        // Roof cabin
        const roofGrad = ctx.createLinearGradient(x + 10, y, x + 34, y + 8);
        roofGrad.addColorStop(0, lightenColor(color, 30));
        roofGrad.addColorStop(1, color);
        ctx.fillStyle = roofGrad;
        ctx.beginPath();
        ctx.roundRect(x + 10, y, 24, 10, [3, 3, 0, 0]);
        ctx.fill();

        // Windshield front
        ctx.fillStyle = 'rgba(135,206,235,0.8)';
        ctx.beginPath();
        ctx.roundRect(x + 28, y + 1, 8, 8, 2);
        ctx.fill();

        // Rear window
        ctx.fillStyle = 'rgba(135,206,235,0.6)';
        ctx.beginPath();
        ctx.roundRect(x + 10, y + 1, 8, 8, 2);
        ctx.fill();

        // Wheels
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(x + 8, y + 20, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 36, y + 20, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#888';
        ctx.beginPath(); ctx.ellipse(x + 8, y + 20, 2.5, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 36, y + 20, 2.5, 2, 0, 0, Math.PI * 2); ctx.fill();

        // Headlights
        ctx.fillStyle = '#FFFF99';
        ctx.shadowColor = '#FFFF00';
        ctx.shadowBlur = 8;
        ctx.fillRect(x + 42, y + 6, 3, 4);
        // Taillights
        ctx.fillStyle = '#FF4444';
        ctx.shadowColor = '#FF0000';
        ctx.fillRect(x - 1, y + 6, 3, 4);

    } else {
        // Vertical (going down)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 4, y, 16, 44, 3);
        ctx.fill();

        // Roof cabin
        const roofGrad2 = ctx.createLinearGradient(x, y + 10, x + 8, y + 34);
        roofGrad2.addColorStop(0, lightenColor(color, 30));
        roofGrad2.addColorStop(1, color);
        ctx.fillStyle = roofGrad2;
        ctx.beginPath();
        ctx.roundRect(x, y + 10, 10, 24, [3, 3, 0, 0]);
        ctx.fill();

        // Windshield front
        ctx.fillStyle = 'rgba(135,206,235,0.8)';
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 28, 8, 8, 2);
        ctx.fill();

        // Rear window
        ctx.fillStyle = 'rgba(135,206,235,0.6)';
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 10, 8, 8, 2);
        ctx.fill();

        // Wheels
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(x + 20, y + 8, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 20, y + 36, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#888';
        ctx.beginPath(); ctx.ellipse(x + 20, y + 8, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 20, y + 36, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();

        // Headlights (front = bottom since going down)
        ctx.fillStyle = '#FFFF99';
        ctx.shadowColor = '#FFFF00';
        ctx.shadowBlur = 8;
        ctx.fillRect(x + 6, y + 42, 4, 3);
        // Taillights (top)
        ctx.fillStyle = '#FF4444';
        ctx.shadowColor = '#FF0000';
        ctx.fillRect(x + 6, y - 1, 4, 3);
    }

    ctx.restore();
}

function lightenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `rgb(${r},${g},${b})`;
}

function drawMotorcycle(x, y, color, isHorizontal) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    if (isHorizontal) {
        // Main body / frame
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 6, y + 5, 22, 8, 3);
        ctx.fill();

        // Fuel tank
        const tankGrad = ctx.createLinearGradient(x + 10, y + 3, x + 24, y + 10);
        tankGrad.addColorStop(0, lightenColor(color, 40));
        tankGrad.addColorStop(1, color);
        ctx.fillStyle = tankGrad;
        ctx.beginPath();
        ctx.ellipse(x + 18, y + 6, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Rider helmet
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(x + 22, y + 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#87CEEB';
        ctx.beginPath();
        ctx.arc(x + 23, y + 2, 3, 0, Math.PI * 1.2);
        ctx.fill();

        // Wheels
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(x + 7, y + 14, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + 29, y + 14, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#666';
        ctx.beginPath(); ctx.arc(x + 7, y + 14, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 29, y + 14, 2.5, 0, Math.PI * 2); ctx.fill();

        // Handlebar
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 25, y + 1);
        ctx.lineTo(x + 29, y + 1);
        ctx.stroke();

        // Exhaust
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 11);
        ctx.lineTo(x + 4, y + 13);
        ctx.stroke();

        // Headlight
        ctx.fillStyle = '#FFFF99';
        ctx.shadowColor = '#FFFF00';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + 33, y + 10, 2, 0, Math.PI * 2);
        ctx.fill();

    } else {
        // Vertical motorcycle (going down)
        // Body frame - narrow strip in the center
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x + 6, y + 10, 6, 16, 2);
        ctx.fill();

        // Fuel tank (wider bump in middle)
        const tankGrad2 = ctx.createLinearGradient(x + 3, y + 14, x + 14, y + 22);
        tankGrad2.addColorStop(0, lightenColor(color, 40));
        tankGrad2.addColorStop(1, color);
        ctx.fillStyle = tankGrad2;
        ctx.beginPath();
        ctx.ellipse(x + 9, y + 18, 5, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Rider body
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.roundRect(x + 5, y + 20, 8, 10, 2);
        ctx.fill();

        // Rider helmet
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(x + 9, y + 22, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#87CEEB';
        ctx.beginPath();
        ctx.arc(x + 10, y + 21, 2.5, 0.3, Math.PI * 1.4);
        ctx.fill();

        // Wheels - clearly OUTSIDE the body (top wheel at y-2, bottom at y+34)
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#333';
        ctx.fillStyle = '#111';
        // Front wheel (bottom, direction of travel)
        ctx.beginPath(); ctx.arc(x + 9, y + 34, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#666';
        ctx.beginPath(); ctx.arc(x + 9, y + 34, 2, 0, Math.PI * 2); ctx.fill();
        // Rear wheel (top)
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(x + 9, y + 2, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#666';
        ctx.beginPath(); ctx.arc(x + 9, y + 2, 2, 0, Math.PI * 2); ctx.fill();

        // Fork (front suspension line)
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 9, y + 10);
        ctx.lineTo(x + 9, y + 29);
        ctx.stroke();

        // Headlight bottom (going down)
        ctx.fillStyle = '#FFFF99';
        ctx.shadowColor = '#FFFF00';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + 9, y + 40, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawAmbulance(x, y, direction) {
    ctx.save();
    const flash = Math.floor(Date.now() / 300) % 2 === 0;

    // Rotation angle based on direction
    // Base drawing: ambulance facing RIGHT (→), cab on right side
    const angles = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
    const angle = angles[direction] ?? 0;

    ctx.translate(x, y);
    ctx.rotate(angle);

    // Glow
    ctx.shadowColor = flash ? '#FF0000' : '#0000FF';
    ctx.shadowBlur = 20;

    // Body (facing right: extends left from center)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(-20, -9, 44, 18, 3);
    ctx.fill();

    // Red stripe
    ctx.fillStyle = '#FF2222';
    ctx.fillRect(-20, -3, 44, 6);

    // Cross symbol (on the side panel)
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(-8, -7, 5, 14);
    ctx.fillRect(-12, -3, 13, 5);

    // Cab window (front = right side)
    ctx.fillStyle = 'rgba(135,206,235,0.85)';
    ctx.beginPath();
    ctx.roundRect(14, -7, 10, 14, 2);
    ctx.fill();

    // Wheels (bottom of vehicle, below center)
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(-8, 10, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14, 10, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.ellipse(-8, 10, 2, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14, 10, 2, 1.5, 0, 0, Math.PI * 2); ctx.fill();

    // Siren lights on roof
    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? '#FF0000' : '#330000';
    ctx.beginPath(); ctx.arc(-2, -12, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#0044FF' : '#000033';
    ctx.beginPath(); ctx.arc(8, -12, 3, 0, Math.PI * 2); ctx.fill();

    // Headlight (front = right)
    ctx.fillStyle = '#FFFFAA';
    ctx.shadowColor = '#FFFF00';
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(25, 0, 3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

function restartSimulation() {
    simulationRunning = true;
    collisionOccurred = false;
    ambulanceActive = false;
    ambulance.active = false;
    ambulance.direction = 'left';
    smokeParticles = [];
    
    resetSimClock();
    resetNPCs();
    stopAllSounds();
    
    let newCar1 = randomCar();
    let newCar2 = randomCar();
    
    car1 = { 
        x: 100, y: 276, speed: CAR1_SPEED, active: true, 
        color: newCar1.color, type: newCar1.type 
    };
    car2 = { 
        x: 375, y: 60, speed: CAR2_SPEED, active: true, 
        color: newCar2.color, type: 'Moto'
    };
    
    eventLog = [];
    reportLog.innerHTML = `<div class="log-entry system"><span class="log-time">[${simTimeStr()}]</span><span class="log-message">Sistema inicializado</span></div>`;
    victimStatusText.textContent = '-';
    victimStatusText.style.color = '';
    victimStatusText.style.borderColor = '';
    victimStatusText.style.background = '';
    victimStatusText.style.textShadow = '';
    const badge = document.getElementById('severityBadge');
    badge.style.display = 'none';
    currentSeverity = null;
    
    addEvent('🔄 Simulação reiniciada', 'system');
}

// ===== SISTEMA DE NPCs (PEDESTRES) =====
// Calçadas:
//   horizontal superior: y = 210~250  → y central ≈ 228
//   horizontal inferior: y = 350~390  → y central ≈ 368
//   vertical esquerda:   x = 310~350  → x central ≈ 328
//   vertical direita:    x = 450~490  → x central ≈ 468
//
// Cada NPC fica restrito à sua calçada e para antes do cruzamento.

const SIDEWALKS = [
    { axis: 'h', fixed: 228, min: 0,   max: 800, dir:  1 }, // superior →
    { axis: 'h', fixed: 228, min: 0,   max: 800, dir: -1 }, // superior ←
    { axis: 'h', fixed: 368, min: 0,   max: 800, dir:  1 }, // inferior →
    { axis: 'h', fixed: 368, min: 0,   max: 800, dir: -1 }, // inferior ←
    { axis: 'v', fixed: 328, min: 0,   max: 600, dir:  1 }, // esq ↓
    { axis: 'v', fixed: 328, min: 0,   max: 600, dir: -1 }, // esq ↑
    { axis: 'v', fixed: 468, min: 0,   max: 600, dir:  1 }, // dir ↓
    { axis: 'v', fixed: 468, min: 0,   max: 600, dir: -1 }, // dir ↑
];

// Cruzamento proibido para pedestres (área da estrada)
const CROSS_H_MIN = 310, CROSS_H_MAX = 450; // x proibido nas calçadas h
const CROSS_V_MIN = 210, CROSS_V_MAX = 350; // y proibido nas calçadas v

const NPC_COLORS = ['#FFD700','#FF69B4','#00BFFF','#98FB98','#FFA07A','#DDA0DD','#F0E68C','#87CEEB'];

class NPC {
    constructor() {
        this.reset(true);
    }

    reset(randomStart = false) {
        const sw = SIDEWALKS[Math.floor(Math.random() * SIDEWALKS.length)];
        this.axis    = sw.axis;
        this.fixed   = sw.fixed + (Math.random() - 0.5) * 10; // pequena variação lateral
        this.dir     = sw.dir;
        this.speed   = 0.4 + Math.random() * 0.5;
        this.color   = NPC_COLORS[Math.floor(Math.random() * NPC_COLORS.length)];
        this.panicking = false;
        this.stopped   = false;

        // Posição inicial: espalhar pela calçada, nunca dentro do cruzamento
        if (this.axis === 'h') {
            let x;
            do { x = Math.random() * 800; }
            while (x > CROSS_H_MIN - 20 && x < CROSS_H_MAX + 20);
            this.pos = randomStart ? x : (this.dir > 0 ? 0 : 800);
            this.y   = this.fixed;
            this.x   = this.pos;
        } else {
            let y;
            do { y = Math.random() * 600; }
            while (y > CROSS_V_MIN - 20 && y < CROSS_V_MAX + 20);
            this.pos = randomStart ? y : (this.dir > 0 ? 0 : 600);
            this.x   = this.fixed;
            this.y   = this.pos;
        }
    }

    update() {
        if (this.stopped && !this.panicking) return;

        const spd = this.panicking ? this.speed * 2.5 : this.speed;

        if (this.axis === 'h') {
            // Parar antes do cruzamento (não na área da estrada)
            if (!this.panicking) {
                if (this.dir > 0 && this.x > CROSS_H_MIN - 15 && this.x < CROSS_H_MAX) {
                    this.stopped = true; return;
                }
                if (this.dir < 0 && this.x < CROSS_H_MAX + 15 && this.x > CROSS_H_MIN) {
                    this.stopped = true; return;
                }
            }
            this.stopped = false;
            this.x += this.dir * spd;
            this.y  = this.fixed + Math.sin(this.x * 0.05) * 1.5; // leve bobbing
            if (this.x > 820 || this.x < -20) this.reset();
        } else {
            if (!this.panicking) {
                if (this.dir > 0 && this.y > CROSS_V_MIN - 15 && this.y < CROSS_V_MAX) {
                    this.stopped = true; return;
                }
                if (this.dir < 0 && this.y < CROSS_V_MAX + 15 && this.y > CROSS_V_MIN) {
                    this.stopped = true; return;
                }
            }
            this.stopped = false;
            this.y += this.dir * spd;
            this.x  = this.fixed + Math.sin(this.y * 0.05) * 1.5;
            if (this.y > 620 || this.y < -20) this.reset();
        }
    }

    panic() {
        this.panicking = true;
        this.stopped   = false;
        // Vira para longe do acidente
        if (this.axis === 'h') this.dir = this.x < 400 ? -1 : 1;
        else                   this.dir = this.y < 300 ? -1 : 1;
    }

    draw() {
        ctx.save();

        const facing = (this.axis === 'h') ? this.dir : (this.dir > 0 ? 1 : -1);
        const walkCycle = Math.floor(Date.now() / 200) % 2; // leg alternation

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 7, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs (animated)
        ctx.strokeStyle = this.panicking ? '#FF4444' : '#555';
        ctx.lineWidth = 1.5;
        if (!this.stopped) {
            const legSwing = walkCycle === 0 ? 3 : -3;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 2);
            ctx.lineTo(this.x - legSwing * facing, this.y + 7);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 2);
            ctx.lineTo(this.x + legSwing * facing, this.y + 7);
            ctx.stroke();
        } else {
            // Standing still
            ctx.beginPath();
            ctx.moveTo(this.x - 2, this.y + 2);
            ctx.lineTo(this.x - 2, this.y + 7);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(this.x + 2, this.y + 2);
            ctx.lineTo(this.x + 2, this.y + 7);
            ctx.stroke();
        }

        // Body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.roundRect(this.x - 3, this.y - 3, 6, 6, 1);
        ctx.fill();

        // Head
        ctx.fillStyle = '#FFDAB9';
        ctx.beginPath();
        ctx.arc(this.x, this.y - 6, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Panic exclamation
        if (this.panicking) {
            ctx.fillStyle = '#FF0000';
            ctx.font = 'bold 8px sans-serif';
            ctx.fillText('!', this.x - 1, this.y - 12);
        }

        ctx.restore();
    }
}

// Criar NPCs
let npcs = Array.from({ length: 12 }, () => new NPC());

function updateNPCs() {
    npcs.forEach(n => n.update());
}

function drawNPCs() {
    npcs.forEach(n => n.draw());
}

function panicNPCs() {
    npcs.forEach(n => n.panic());
}

function resetNPCs() {
    npcs = Array.from({ length: 12 }, () => new NPC());
}

// Loop principal
function simulate() {
    if (!simulationRunning) return;
    
    updateTime();
    updateNPCs();
    
    if (!collisionOccurred) {
        moveCars();
    } else {
        moveAmbulance();
    }
    
    drawDroneView();
    
    requestAnimationFrame(simulate);
}

// Event listeners
restartBtn.addEventListener('click', restartSimulation);
window.addEventListener('load', initAudios);

// Iniciar simulação
addEvent('🚁 Sistema de monitoramento ativado', 'system');
simulate();
setInterval(updateTime, 1000);