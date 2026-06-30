/* ==========================================================================
   MUNIBOT - CHASCOMÚS | SCRIPT CON MEJORAS DE GESTIÓN INTELIGENTE
   Versión con: preguntas guiadas, guías extendidas, precarga de tiquetera
   ========================================================================== */

/* --- PWA: SERVICE WORKER --- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('✅ SW registrado:', reg.scope))
            .catch(err => console.error('❌ SW error:', err));
    });
}

/* --- VOZ --- */
let vozActivada = false;
let currentUtterance = null;

function toggleVoz() {
    vozActivada = !vozActivada;
    document.getElementById('voiceToggle').innerText = vozActivada ? '🔊' : '🔇';
    if (!vozActivada && currentUtterance) {
        window.speechSynthesis.cancel();
        currentUtterance = null;
    }
}

function hablar(textoHtml) {
    if (!vozActivada) return;
    
    if (currentUtterance) {
        window.speechSynthesis.cancel();
    }
    
    // Limpiar emojis y HTML
    let div = document.createElement("div");
    div.innerHTML = textoHtml;
    let txt = (div.textContent || div.innerText || "")
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/[\u{2600}-\u{26FF}]/gu, '')
        .trim();
    
    if (!txt) return;
    
    currentUtterance = new SpeechSynthesisUtterance(txt);
    currentUtterance.lang = 'es-AR';
    currentUtterance.rate = 0.95;
    currentUtterance.pitch = 1.05;
    currentUtterance.volume = 1;
    
    currentUtterance.onend = () => { currentUtterance = null; };
    currentUtterance.onerror = () => { currentUtterance = null; };
    
    if (window.speechSynthesis.getVoices().length > 0) {
        const voces = window.speechSynthesis.getVoices();
        currentUtterance.voice = voces.find(v => v.lang === 'es-AR') || 
                                  voces.find(v => v.lang.startsWith('es')) || null;
        window.speechSynthesis.speak(currentUtterance);
    } else {
        window.speechSynthesis.onvoiceschanged = () => {
            const voces = window.speechSynthesis.getVoices();
            currentUtterance.voice = voces.find(v => v.lang === 'es-AR') || 
                                      voces.find(v => v.lang.startsWith('es')) || null;
            window.speechSynthesis.speak(currentUtterance);
        };
        window.speechSynthesis.speak(currentUtterance);
    }
}

/* --- MICRÓFONO --- */
const micBtn = document.getElementById('micButton');
const inputArea = document.getElementById('userInput');
const ReconocimientoVoz = window.SpeechRecognition || window.webkitSpeechRecognition;
let isRecording = false;

if (ReconocimientoVoz) {
    const rec = new ReconocimientoVoz();
    rec.lang = 'es-AR';
    rec.interimResults = false;
    rec.continuous = false;
    
    if (micBtn) {
        micBtn.onclick = () => {
            if (isRecording) {
                rec.stop();
                return;
            }
            try {
                rec.start();
                isRecording = true;
                micBtn.classList.add('recording');
                inputArea.placeholder = "Escuchando... 👂";
            } catch (e) {
                console.error("Error al iniciar micrófono:", e);
            }
        };
    }
    
    rec.onresult = (e) => {
        const texto = e.results[0][0].transcript;
        inputArea.value = texto;
        setTimeout(() => processInput(), 100);
    };
    
    rec.onend = () => {
        isRecording = false;
        if (micBtn) micBtn.classList.remove('recording');
        if (inputArea) inputArea.placeholder = "Escribí un mensaje...";
    };
    
    rec.onerror = (e) => {
        console.error("Mic error:", e.error);
        isRecording = false;
        if (micBtn) micBtn.classList.remove('recording');
        if (inputArea) inputArea.placeholder = "Escribí un mensaje...";
    };
} else {
    if (micBtn) micBtn.style.display = 'none';
}

/* --- MODAL --- */
function showInfo() {
    document.getElementById('infoModal').style.display = 'flex';
}

function closeInfo() {
    document.getElementById('infoModal').style.display = 'none';
}

window.onclick = (e) => {
    const m = document.getElementById('infoModal');
    if (e.target === m) m.style.display = "none";
};

/* --- ESTADO --- */
let userName = localStorage.getItem('chas_user_name') || "";
let userNeighborhood = localStorage.getItem('chas_user_neighborhood') || "";
let userAge = localStorage.getItem('chas_user_age') || "";
let currentPath = ['main'];
let isBotThinking = false;

/* 🆕 ESTADO PARA PREGUNTAS GUIADAS (HABILITACIONES Y TIQUETERA) */
let pendingQuestion = null; // { type, step, collectedData, originalQuery }

const WEBHOOK_N8N = 'https://test.chascomus.gob.ar/api/chat.php';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4OwdnxlW5ux5CDKvrsoFjy9yDiTT1o1KQ0QOtghtBFjPX1dTTcpL20hV2dsPjJU0p/exec';
const IMG_BOT_NORMAL = 'icon-192.png';

/* ══════════════════════════════════════════════════════════════════════════
   🆕 TIQUETERA 147 - RECOLECCIÓN DE CAMPOS
   ══════════════════════════════════════════════════════════════════════════ */
const TIQUETERA_CONFIG = {
    "147": {
        url_base: "https://147.chascomus.gob.ar",
        soporta_precarga: false, // Cambiar a true si la tiquetera acepta GET params
        campos: [
            { nombre: "direccion", pregunta: "📍 ¿Cuál es la dirección exacta? (calle y altura, o punto de referencia)", obligatorio: true, ejemplo: "Av. Lastra 123" },
            { nombre: "tipo", pregunta: "🏷️ ¿Qué tipo de reclamo es?", obligatorio: true, opciones: ["🌳 Árbol caído/poda", "🕳️ Pozo/bache", "💡 Luminaria quemada", "🗑️ Basura acumulada", "🐕 Animal suelto", "🚰 Pérdida de agua", "🔊 Ruidos molestos", "📝 Otro (especificar)"] },
            { nombre: "detalle", pregunta: "📝 Contanos más (opcional): ¿Desde cuándo? ¿Hay riesgo?", obligatorio: false, ejemplo: "Hace 3 días, obstruye la vereda" }
        ],
        instrucciones: "Una vez que completes el formulario, tu reclamo quedará registrado en el sistema."
    },
    "habilitacion": {
        tipos: {
            "comercial": {
                nombre: "Habilitación Comercial",
                campos: [
                    { nombre: "rubro", pregunta: "🏪 ¿Cuál es el rubro de tu comercio?", opciones: ["Gastronómico", "Indumentaria", "Kiosco/Almacén", "Servicios", "Otro"], obligatorio: true },
                    { nombre: "metros", pregunta: "📏 ¿Cuántos metros cuadrados tiene el local?", opciones: ["Menos de 30m²", "Entre 30 y 100m²", "Más de 100m²"], obligatorio: true },
                    { nombre: "direccion", pregunta: "📍 ¿Dirección del comercio?", obligatorio: true }
                ]
            },
            "profesional": {
                nombre: "Habilitación Profesional",
                campos: [
                    { nombre: "profesion", pregunta: "👨‍⚕️ ¿Cuál es tu profesión?", opciones: ["Médico", "Abogado", "Contador", "Arquitecto", "Psicólogo", "Otro"], obligatorio: true },
                    { nombre: "matricula", pregunta: "🆕 ¿Tenés matrícula profesional?", opciones: ["Sí", "No", "En trámite"], obligatorio: true }
                ]
            },
            "industrial": {
                nombre: "Habilitación Industrial",
                campos: [
                    { nombre: "tipo_industria", pregunta: "🏭 ¿Qué tipo de industria?", obligatorio: true },
                    { nombre: "superficie", pregunta: "📐 ¿Superficie aproximada?", obligatorio: true },
                    { nombre: "personal", pregunta: "👥 ¿Cantidad de empleados?", obligatorio: false }
                ]
            }
        }
    }
};

/* 🆕 Función para iniciar recolección de 147 */
function iniciarRecoleccion147() {
    pendingQuestion = {
        type: "tiquetera_147",
        step: 0,
        collectedData: {},
        config: TIQUETERA_CONFIG["147"]
    };
    
    let mensajeIntro = "📞 **Te ayudo con el 147 - Reclamos Urbanos**\n\nVoy a tomarte los datos para que solo tengas que revisar y enviar. Respondé estas preguntas:\n";
    addMessage(mensajeIntro, "bot");
    
    hacerSiguientePregunta147();
}

function hacerSiguientePregunta147() {
    if (!pendingQuestion || pendingQuestion.type !== "tiquetera_147") return;
    
    const config = pendingQuestion.config;
    const step = pendingQuestion.step;
    
    if (step >= config.campos.length) {
        // Todas las preguntas respondidas
        finalizarRecoleccion147();
        return;
    }
    
    const campo = config.campos[step];
    let mensaje = `**${campo.pregunta}**`;
    if (campo.ejemplo) mensaje += `\n\n💡 *Ejemplo:* ${campo.ejemplo}`;
    if (campo.opciones) {
        mensaje += "\n\nOpciones:\n" + campo.opciones.map((opt, i) => `${i+1}. ${opt}`).join("\n");
        mensaje += "\n\n*Respondé con el número o escribí tu respuesta*";
    }
    
    addMessage(mensaje, "bot");
}

function procesarRespuesta147(respuesta) {
    if (!pendingQuestion || pendingQuestion.type !== "tiquetera_147") return false;
    
    const config = pendingQuestion.config;
    const step = pendingQuestion.step;
    const campo = config.campos[step];
    
    let valorFinal = respuesta;
    
    // Si tiene opciones y respondió con número, convertir
    if (campo.opciones && /^\d+$/.test(respuesta)) {
        const idx = parseInt(respuesta) - 1;
        if (idx >= 0 && idx < campo.opciones.length) {
            valorFinal = campo.opciones[idx].replace(/^[0-9]+\.\s*/, "");
        }
    }
    
    pendingQuestion.collectedData[campo.nombre] = valorFinal;
    pendingQuestion.step++;
    
    if (pendingQuestion.step < config.campos.length) {
        hacerSiguientePregunta147();
    } else {
        finalizarRecoleccion147();
    }
    
    return true;
}

function finalizarRecoleccion147() {
    const datos = pendingQuestion.collectedData;
    const config = pendingQuestion.config;
    
    // Generar resumen
    let resumen = "✅ **Resumen de tu reclamo:**\n\n";
    for (const [key, value] of Object.entries(datos)) {
        const campo = config.campos.find(c => c.nombre === key);
        resumen += `📌 **${campo?.pregunta?.split('?')[0] || key}:** ${value}\n`;
    }
    
    resumen += "\n---\n";
    
    if (config.soporta_precarga) {
        // Generar URL precargada
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(datos)) {
            params.append(key, value);
        }
        const urlFinal = `${config.url_base}?${params.toString()}`;
        resumen += `🔗 **Listo para enviar:**\n${urlFinal}\n\nHacé clic en el enlace y solo confirmá el envío.`;
    } else {
        resumen += `🔗 **Completá el reclamo acá:**\n${config.url_base}\n\n📋 **Instrucciones:** Cuando entres, copiá los datos de arriba en cada campo del formulario.\n\n${config.instrucciones || ""}`;
    }
    
    addMessage(resumen, "bot");
    
    // Opciones adicionales
    appendOptions([
        { id: 'main', label: '🏠 Volver al Menú' },
        { id: 'q', label: '📞 Otro reclamo', q: '147' }
    ]);
    
    pendingQuestion = null;
}

/* ══════════════════════════════════════════════════════════════════════════
   🆕 MENÚ FALLBACK LOCAL MEJORADO (con preguntas guiadas)
   ══════════════════════════════════════════════════════════════════════════ */
const MENU_FALLBACK = {
    title: (name) => `¡Hola <b>${name || 'Visitante'}</b>! 👋 Soy el asistente virtual de Chascomús. ¿En qué puedo ayudarte?`,
    options: [
        { id: 'habilitacion_handler', label: '🏢 Habilitaciones Comerciales', special: 'habilitacion' },
        { id: 'q', label: '🏥 Salud / Turnos Hospital', q: 'turnos hospital salud' },
        { id: 'q', label: '🎭 Agenda Cultural', q: 'agenda cultural eventos' },
        { id: 'q', label: '💜 GÉNERO (Urgencias)', q: 'genero violencia urgencias' },
        { id: 'q', label: '👀 Ojos en Alerta', link: 'https://wa.me/5492241557444' },
        { id: '147_handler', label: '🚧 Reclamos 147', special: '147' },
        { id: 'q', label: '💊 Farmacias de Turno', link: 'https://www.turnofarma.com/turnos/ar/ba/chascomus' },
        { id: 'q', label: '💧 Ver Consumo de Agua', link: 'https://apps.chascomus.gob.ar/caudalimetros/consulta.php' },
        { id: 'q', label: '🔍 Consultar Deuda', link: 'https://pagos.chascomus.gob.ar/#destino=imponible' },
        { id: 'q', label: '🌿 Solicitud de Poda', link: 'https://apps.chascomus.gob.ar/podaresponsable/solicitud.php' },
        { id: 'q', label: '🪪 Turno Licencia de Conducir', link: 'https://apps.chascomus.gob.ar/conducir/' },
        { id: 'q', label: '⚖️ Consultar Infracciones', link: 'https://chascomus.gob.ar/municipio/estaticas/consultaInfracciones' },
        { id: 'q', label: '💰 Habilitaciones Comerciales (web)', link: 'https://apps.chascomus.gob.ar/habilitaciones/habilitacionComercial.php' },
        { id: 'q', label: '🏘️ Planes Habitacionales', link: 'https://apps.chascomus.gob.ar/vivienda/' },
        { id: 'q', label: '🚗 Academia de Conductores', link: 'https://apps.chascomus.gob.ar/academia/' }
    ]
};

/* 🆕 Manejador especial para Habilitaciones */
function iniciarRecoleccionHabilitacion() {
    pendingQuestion = {
        type: "habilitacion",
        step: "tipo", // primero preguntar qué tipo
        collectedData: {},
        tiposDisponibles: TIQUETERA_CONFIG.habilitacion.tipos
    };
    
    let mensaje = "🏢 **Te ayudo con las Habilitaciones Comerciales**\n\nPrimero, ¿qué tipo de habilitación necesitás?\n\n";
    const tipos = Object.entries(TIQUETERA_CONFIG.habilitacion.tipos);
    tipos.forEach(([key, value], idx) => {
        mensaje += `${idx+1}. **${value.nombre}**\n`;
    });
    mensaje += "\n*Respondé con el número o escribí el nombre*";
    
    addMessage(mensaje, "bot");
}

function procesarTipoHabilitacion(respuesta) {
    const tipos = Object.entries(TIQUETERA_CONFIG.habilitacion.tipos);
    let tipoSeleccionado = null;
    let tipoKey = null;
    
    // Si es número
    if (/^\d+$/.test(respuesta)) {
        const idx = parseInt(respuesta) - 1;
        if (idx >= 0 && idx < tipos.length) {
            tipoKey = tipos[idx][0];
            tipoSeleccionado = tipos[idx][1];
        }
    } else {
        // Buscar por nombre
        for (const [key, value] of tipos) {
            if (value.nombre.toLowerCase().includes(respuesta.toLowerCase())) {
                tipoKey = key;
                tipoSeleccionado = value;
                break;
            }
        }
    }
    
    if (!tipoSeleccionado) {
        addMessage("No entendí el tipo. Por favor, elegí una opción:", "bot");
        iniciarRecoleccionHabilitacion();
        return;
    }
    
    pendingQuestion.tipoKey = tipoKey;
    pendingQuestion.tipoData = tipoSeleccionado;
    pendingQuestion.step = 0; // empezar con los campos
    pendingQuestion.collectedData = { tipo: tipoSeleccionado.nombre };
    
    hacerSiguientePreguntaHabilitacion();
}

function hacerSiguientePreguntaHabilitacion() {
    const campos = pendingQuestion.tipoData.campos;
    const step = pendingQuestion.step;
    
    if (step >= campos.length) {
        finalizarRecoleccionHabilitacion();
        return;
    }
    
    const campo = campos[step];
    let mensaje = `**${campo.pregunta}**`;
    if (campo.opciones) {
        mensaje += "\n\nOpciones:\n" + campo.opciones.map((opt, i) => `${i+1}. ${opt}`).join("\n");
    }
    
    addMessage(mensaje, "bot");
}

function procesarRespuestaHabilitacion(respuesta) {
    const campos = pendingQuestion.tipoData.campos;
    const step = pendingQuestion.step;
    const campo = campos[step];
    
    let valorFinal = respuesta;
    
    if (campo.opciones && /^\d+$/.test(respuesta)) {
        const idx = parseInt(respuesta) - 1;
        if (idx >= 0 && idx < campo.opciones.length) {
            valorFinal = campo.opciones[idx];
        }
    }
    
    pendingQuestion.collectedData[campo.nombre] = valorFinal;
    pendingQuestion.step++;
    
    if (pendingQuestion.step < campos.length) {
        hacerSiguientePreguntaHabilitacion();
    } else {
        finalizarRecoleccionHabilitacion();
    }
}

function finalizarRecoleccionHabilitacion() {
    const datos = pendingQuestion.collectedData;
    const tipo = pendingQuestion.tipoData;
    
    // 🧾 TARJETA RESUMEN
    let tarjeta = `🏢 **${tipo.nombre} - ${datos.rubro || 'Trámite'}**\n\n`;
    tarjeta += `**PASOS CLAVE:**\n`;
    tarjeta += `1. Solicitar turno en Ventanilla Única\n`;
    tarjeta += `2. Presentar documentación requerida\n`;
    tarjeta += `3. Pagar tasa de habilitación\n`;
    tarjeta += `4. Inspección municipal\n`;
    tarjeta += `5. Descargar cédula definitiva\n\n`;
    tarjeta += `⏱ **Tiempo estimado:** 30-45 días hábiles\n`;
    tarjeta += `⚠️ **Importante:** Sin habilitación, multas desde 10 UTM\n`;
    
    // 📘 GUÍA EXTENDIDA (aparte)
    let guia = `📘 **GUÍA COMPLETA - ${tipo.nombre}**\n\n`;
    guia += `**📋 Documentación necesaria:**\n`;
    guia += `• Formulario de solicitud (llenar online)\n`;
    guia += `• Copia de DNI del titular\n`;
    guia += `• Constancia de CUIT\n`;
    guia += `• Título de propiedad o contrato de alquiler\n`;
    if (datos.metros && datos.metros.includes("30")) {
        guia += `• Plano de evacuación (por ser >30m²)\n`;
    }
    guia += `• Certificado de libre deuda municipal\n\n`;
    
    guia += `**🏛 Dónde iniciarlo:**\n`;
    guia += `• Online: https://apps.chascomus.gob.ar/habilitaciones/\n`;
    guia += `• Presencial: Centro Cívico - Mesa de Entrada (L a V 8-13hs)\n\n`;
    
    guia += `**💰 Costos aproximados:**\n`;
    guia += `• Derecho de registro: $15.000\n`;
    guia += `• Tasa de inspección: $10.000\n`;
    guia += `• Sellados: $3.000\n`;
    guia += `• **Total estimado: $28.000**\n\n`;
    
    guia += `**⚠️ Errores comunes a evitar:**\n`;
    guia += `• Llevar fotocopias sin legalizar\n`;
    guia += `• Rubro del contrato no coincide con lo solicitado\n`;
    guia += `• Olvidar el libre deuda de tasas\n\n`;
    
    guia += `**📞 Contacto ante dudas:**\n`;
    guia += `• WhatsApp: 2241-XXXXXX\n`;
    guia += `• Mail: habilitaciones@chascomus.gob.ar\n\n`;
    
    guia += `**✅ Checklist descargable:**\n`;
    guia += `[✓] Documentación completa\n`;
    guia += `[✓] Impuestos al día\n`;
    guia += `[✓] Instalaciones en regla`;
    
    // Mostrar ambas cosas
    addMessage(tarjeta, "bot");
    addMessage(guia, "bot");
    
    // Opciones finales
    appendOptions([
        { id: 'main', label: '🏠 Volver al Menú' },
        { id: 'habilitacion_handler', label: '🔄 Otra habilitación', special: 'habilitacion' },
        { id: 'q', label: '📞 Consultar con un agente', q: 'quiero hablar con un operador' }
    ]);
    
    pendingQuestion = null;
}

/* ══════════════════════════════════════════════════════════════════════════
   TARJETAS RICAS (existente)
   ══════════════════════════════════════════════════════════════════════════ */
function colorBoton(type) {
    const colors = {
        whatsapp: '#25D366',
        map: '#4285F4',
        phone: '#FF6B35',
        web: '#555555'
    };
    return colors[type] || '#888888';
}

function renderCards(cards) {
    if (!cards || !Array.isArray(cards) || cards.length === 0) return;
    const container = document.getElementById('chatMessages');
    cards.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'message-wrapper bot';
        let botonesHTML = '';
        if (card.buttons && card.buttons.length > 0) {
            botonesHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">';
            card.buttons.forEach(btn => {
                botonesHTML += `<a href="${btn.link}" target="_blank" rel="noopener noreferrer"
                    style="background:${colorBoton(btn.type)};color:#fff;padding:7px 12px;border-radius:20px;
                    text-decoration:none;font-size:13px;font-weight:600;display:inline-flex;
                    align-items:center;gap:4px;white-space:nowrap;">${btn.label}</a>`;
            });
            botonesHTML += '</div>';
        }
        cardDiv.innerHTML = `
            <img src="${IMG_BOT_NORMAL}" class="avatar-chat" alt="Bot">
            <div class="message bot info-card" style="border-left:4px solid #b8d30f;padding:12px 14px;">
                ${card.title ? `<div style="font-weight:700;font-size:15px;margin-bottom:6px;">${card.title}</div>` : ''}
                ${card.body ? `<div style="font-size:13px;line-height:1.6;">${card.body.replace(/\n/g, '<br>')}</div>` : ''}
                ${botonesHTML}
            </div>`;
        container.appendChild(cardDiv);
    });
    container.scrollTop = container.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════════════════
   IA - n8n via proxy PHP (existente)
   ══════════════════════════════════════════════════════════════════════════ */
async function ejecutarBusquedaInteligente(texto) {
    showTyping();
    try {
        const response = await fetch(WEBHOOK_N8N, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mensaje: texto, 
                usuario: userName, 
                barrio: userNeighborhood, 
                edad: userAge 
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        let rawOutput = data.output || (Array.isArray(data) && data[0]?.output) || "";

        let respuestaTexto = "";
        let tarjetas = [];
        let opciones = [{ id: 'main', label: '🏠 Menú Principal' }];

        try {
            const limpio = rawOutput
                .replace(/```json|```/gi, '')
                .replace(/""/g, '"')
                .replace(/"\s*"\s*}/g, '"}')
                .replace(/"\s*"\s*,/g, '",')
                .trim();
            const parsed = JSON.parse(limpio);
            if (parsed.output) respuestaTexto = parsed.output;
            if (Array.isArray(parsed.cards) && parsed.cards.length > 0) tarjetas = parsed.cards;
            if (Array.isArray(parsed.options) && parsed.options.length > 0) opciones = parsed.options;
        } catch (e) {
            console.warn("JSON inválido:", e.message);
            respuestaTexto = rawOutput || "No pude obtener una respuesta. Por favor intentá de nuevo.";
        }

        respuestaTexto = respuestaTexto
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\n/g, '<br>');

        addMessage(`<div class="info-card">${respuestaTexto}</div>`, "bot");
        if (tarjetas.length > 0) renderCards(tarjetas);
        appendOptions(opciones);

    } catch (error) {
        console.error("Error n8n:", error);
        addMessage("Lo siento, tengo problemas de conexión. Por favor, intentá más tarde.", "bot",
            [{ id: 'main', label: '🏠 Menú Principal' }]);
    }
}

/* ══════════════════════════════════════════════════════════════════════════
   MENÚ PRINCIPAL (existente, mejorado)
   ══════════════════════════════════════════════════════════════════════════ */
async function resetToMain() {
    currentPath = ['main'];
    pendingQuestion = null; // Limpiar cualquier pregunta pendiente
    
    const existingTyping = document.getElementById('typingWrapper');
    if (existingTyping) existingTyping.remove();
    isBotThinking = false;
    
    showTyping();
    
    try {
        const response = await fetch(WEBHOOK_N8N, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mensaje: '__MENU_PRINCIPAL__',
                usuario: userName,
                barrio: userNeighborhood,
                edad: userAge
            })
        });

        if (!response.ok) throw new Error('fallback');
        
        const data = await response.json();
        let rawOutput = data.output || (Array.isArray(data) && data[0]?.output) || "";

        let respuestaTexto = "";
        let tarjetas = [];
        let opciones = [];

        const limpio = rawOutput.replace(/```json|```/gi, '').replace(/""/g, '"').trim();
        const parsed = JSON.parse(limpio);
        if (parsed.output) respuestaTexto = parsed.output;
        if (Array.isArray(parsed.cards)) tarjetas = parsed.cards;
        if (Array.isArray(parsed.options) && parsed.options.length > 0) opciones = parsed.options;
        
        if (opciones.length === 0) throw new Error('fallback');

        respuestaTexto = respuestaTexto.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
        
        const typingDiv = document.getElementById('typingWrapper');
        if (typingDiv) typingDiv.remove();
        isBotThinking = false;
        
        addMessage(`<div class="info-card">${respuestaTexto}</div>`, "bot");
        if (tarjetas.length > 0) renderCards(tarjetas);
        appendOptions(opciones);

    } catch (error) {
        console.warn("Usando menú local de fallback");
        const typingDiv = document.getElementById('typingWrapper');
        if (typingDiv) typingDiv.remove();
        isBotThinking = false;
        
        const titulo = typeof MENU_FALLBACK.title === 'function'
            ? MENU_FALLBACK.title(userName)
            : MENU_FALLBACK.title;
        addMessage(`<div class="info-card">${titulo}</div>`, "bot");
        appendOptions(MENU_FALLBACK.options);
    }
}

/* ══════════════════════════════════════════════════════════════════════════
   PROCESAMIENTO PRINCIPAL (MODIFICADO para manejar preguntas guiadas)
   ══════════════════════════════════════════════════════════════════════════ */
function handleAction(opt) {
    if (opt.link) {
        window.open(opt.link, opt.target || '_blank');
        return;
    }
    if (opt.id === 'main') {
        resetToMain();
        return;
    }
    // 🆕 Manejar acciones especiales
    if (opt.special === '147' || (opt.label && opt.label.toLowerCase().includes('147'))) {
        iniciarRecoleccion147();
        return;
    }
    if (opt.special === 'habilitacion' || (opt.label && opt.label.toLowerCase().includes('habilitacion'))) {
        iniciarRecoleccionHabilitacion();
        return;
    }
    if (opt.q) {
        ejecutarBusquedaInteligente(opt.q);
        return;
    }
    ejecutarBusquedaInteligente(opt.label);
}

function processInput() {
    const input = document.getElementById('userInput');
    const val = input.value.trim();
    if (!val || isBotThinking) return;
    
    addMessage(val, 'user');
    input.value = "";

    // 🆕 Si hay una pregunta pendiente, procesar según el tipo
    if (pendingQuestion) {
        if (pendingQuestion.type === "tiquetera_147") {
            procesarRespuesta147(val);
            registrarEnPlanilla(val);
            return;
        } else if (pendingQuestion.type === "habilitacion") {
            if (pendingQuestion.step === "tipo") {
                procesarTipoHabilitacion(val);
            } else {
                procesarRespuestaHabilitacion(val);
            }
            registrarEnPlanilla(val);
            return;
        }
    }

    // Onboarding
    if (!userName) {
        userName = val;
        localStorage.setItem('chas_user_name', userName);
        setTimeout(() => addMessage(`¡Hola <b>${userName}</b>! 👋 ¿De qué barrio sos?`, 'bot'), 100);
        return;
    }
    if (!userNeighborhood) {
        userNeighborhood = val;
        localStorage.setItem('chas_user_neighborhood', userNeighborhood);
        setTimeout(() => addMessage(`¡Anotado! Por último, ¿qué edad tenés?`, 'bot'), 100);
        return;
    }
    if (!userAge) {
        userAge = val;
        localStorage.setItem('chas_user_age', userAge);
        showTyping();
        setTimeout(() => {
            const t = document.getElementById('typingWrapper');
            if (t) t.remove();
            isBotThinking = false;
            resetToMain();
        }, 800);
        return;
    }

    // Palabras clave
    const valLower = val.toLowerCase();
    if (valLower.includes('menu') || valLower.includes('menú') ||
        valLower.includes('inicio') || valLower.includes('volver')) {
        resetToMain();
        registrarEnPlanilla(val);
        return;
    }
    
    // 🆕 Detectar intenciones directamente desde texto
    if (valLower.includes('147') || (valLower.includes('reclamo') && valLower.includes('calle'))) {
        iniciarRecoleccion147();
        registrarEnPlanilla(val);
        return;
    }
    
    if (valLower.includes('habilitacion') && (valLower.includes('comercial') || valLower.includes('comercio'))) {
        iniciarRecoleccionHabilitacion();
        registrarEnPlanilla(val);
        return;
    }

    ejecutarBusquedaInteligente(val);
    registrarEnPlanilla(val);
}

/* ══════════════════════════════════════════════════════════════════════════
   UI (funciones existentes)
   ══════════════════════════════════════════════════════════════════════════ */
function showTyping() {
    isBotThinking = true;
    const container = document.getElementById('chatMessages');
    // Evitar duplicados
    if (document.getElementById('typingWrapper')) return;
    const w = document.createElement('div');
    w.id = 'typingWrapper';
    w.className = 'message-wrapper bot';
    w.innerHTML = `<img src="${IMG_BOT_NORMAL}" class="avatar-chat" alt="Bot"><div class="message bot"><span class="typing-dots">Escribiendo</span></div>`;
    container.appendChild(w);
    container.scrollTop = container.scrollHeight;
}

function addMessage(content, side = 'bot', options = null) {
    isBotThinking = false;
    const t = document.getElementById('typingWrapper');
    if (t) t.remove();
    
    const container = document.getElementById('chatMessages');
    const w = document.createElement('div');
    w.className = `message-wrapper ${side}`;
    
    if (side === 'bot') {
        w.innerHTML = `<img src="${IMG_BOT_NORMAL}" class="avatar-chat" alt="Bot"><div class="message ${side}">${content}</div>`;
    } else {
        w.innerHTML = `<div class="message ${side}">${content}</div>`;
    }
    
    container.appendChild(w);
    
    if (options && options.length > 0) appendOptions(options);
    
    container.scrollTop = container.scrollHeight;
    if (side === 'bot') hablar(content);
}

function appendOptions(options) {
    if (!options || options.length === 0) return;
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'options-container';
    options.forEach(o => {
        const btn = document.createElement('button');
        btn.className = 'option-button';
        btn.innerText = o.label;
        btn.onclick = () => handleAction(o);
        div.appendChild(btn);
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════════════════
   UTILIDADES
   ══════════════════════════════════════════════════════════════════════════ */
function registrarEnPlanilla(detalle) {
    fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
            fecha: new Date().toLocaleString('es-AR'),
            usuario: userName,
            barrio: userNeighborhood,
            edad: userAge,
            detalle
        })
    }).catch(e => console.warn("Error registrando:", e));
}

function clearSession() {
    if (confirm("¿Reiniciar chat y borrar datos?")) {
        localStorage.clear();
        location.reload();
    }
}

function cerrarAlerta() {
    document.getElementById('weather-banner').classList.add('hidden');
}

function cerrarTarjeta() {
    document.getElementById('vista-tarjeta').style.display = 'none';
}

/* --- PWA INSTALACIÓN --- */
let eventoInstalacion;
const botonInstalar = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacion = e;
    if (botonInstalar) botonInstalar.classList.remove('hidden');
    console.log('✅ PWA lista para instalar');
});

if (botonInstalar) {
    botonInstalar.addEventListener('click', async () => {
        if (!eventoInstalacion) {
            alert("Para instalar la app, usá el menú del navegador ➕ 'Agregar a pantalla de inicio'");
            return;
        }
        eventoInstalacion.prompt();
        const { outcome } = await eventoInstalacion.userChoice;
        if (outcome === 'accepted') {
            botonInstalar.classList.add('hidden');
            console.log('✅ Usuario instaló la PWA');
        }
        eventoInstalacion = null;
    });
}

/* --- INICIO --- */
document.addEventListener('DOMContentLoaded', () => {
    if (!userName) {
        addMessage("¡Hola! Soy MuniBot. ¿Cómo te llamás?", "bot");
    } else {
        resetToMain();
    }
    
    const sendBtn = document.getElementById('sendButton');
    const input = document.getElementById('userInput');
    
    if (sendBtn) sendBtn.onclick = processInput;
    if (input) input.onkeypress = (e) => { if (e.key === 'Enter') processInput(); };
});
