/* ==========================================================================
   SCRIPT PRINCIPAL: MUNIBOT (INTEGRACIÓN N8N + AVATAR + VOZ)
   ========================================================================== */

/* --- PWA: REGISTRO DEL SERVICE WORKER --- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('✅ PWA: Service Worker registrado listos para instalar'))
            .catch(err => console.error('❌ PWA: Error al registrar', err));
    });
}

/* --- ACCESIBILIDAD: RECONOCIMIENTO Y SÍNTESIS DE VOZ --- */
let vozActivada = false;

function toggleVoz() {
    vozActivada = !vozActivada;
    document.getElementById('voiceToggle').innerText = vozActivada ? '🔊' : '🔇';
    if (vozActivada) {
        hablar("Voz de MuniBot activada.");
    } else {
        window.speechSynthesis.cancel();
    }
}

function hablar(textoHtml) {
    if (!vozActivada) return;
    let div = document.createElement("div");
    div.innerHTML = textoHtml;
    let textoLimpio = div.textContent || div.innerText || "";
    
    // Filtramos emojis
    textoLimpio = textoLimpio.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');

    const mensaje = new SpeechSynthesisUtterance(textoLimpio);
    mensaje.lang = 'es-AR'; 
    mensaje.rate = 1.0; 
    window.speechSynthesis.speak(mensaje);
}

// Configuración del Micrófono
const micBtn = document.getElementById('micButton');
const inputArea = document.getElementById('userInput');
const ReconocimientoVoz = window.SpeechRecognition || window.webkitSpeechRecognition;

if (ReconocimientoVoz) {
    const reconocimiento = new ReconocimientoVoz();
    reconocimiento.lang = 'es-AR';
    reconocimiento.interimResults = false;
    
    if(micBtn) {
        micBtn.onclick = () => {
            reconocimiento.start();
            micBtn.classList.add('recording');
            inputArea.placeholder = "Escuchando... 👂";
        };
    }
    
    let procesandoVoz = false; 

    reconocimiento.onresult = (evento) => {
        const transcripcion = evento.results[0][0].transcript;
        inputArea.value = transcripcion;
        
        if (procesandoVoz) return; 
        procesandoVoz = true; 
        
        setTimeout(() => {
            processInput(); 
            procesandoVoz = false;
        }, 400);
    };
    
    reconocimiento.onend = () => {
        if(micBtn) micBtn.classList.remove('recording');
        if(inputArea) inputArea.placeholder = "Escribí un mensaje...";
    };
    
    reconocimiento.onerror = (evento) => {
        console.error("Error en micrófono: ", evento.error);
        if(micBtn) micBtn.classList.remove('recording');
        if(inputArea) inputArea.placeholder = "Escribí un mensaje...";
    };
} else {
    if(micBtn) micBtn.style.display = 'none';
}

/* --- FUNCIONES DEL MODAL DE INFO --- */
function showInfo() { document.getElementById('infoModal').style.display = 'flex'; }
function closeInfo() { document.getElementById('infoModal').style.display = 'none'; }
window.onclick = function(event) {
    const modal = document.getElementById('infoModal');
    if (event.target === modal) { modal.style.display = "none"; }
}

/* --- 1. CONFIGURACIÓN Y ESTADO --- */
let userName = localStorage.getItem('chas_user_name') || ""; 
let userNeighborhood = localStorage.getItem('chas_user_neighborhood') || ""; 
let userAge = localStorage.getItem('chas_user_age') || ""; 
let currentPath = ['main'];
let isBotThinking = false;
let interaccionIniciada = false;

// --- ENLACES A APIs EXTERNAS ---
const WEBHOOK_N8N = 'https://n8n.chascomus.gob.ar/webhook/MuniBot';

/* --- CONFIGURACIÓN DE LA MASCOTA ANIMADA --- */
const IMG_BOT_NORMAL = 'img-bot-normal.png';   

const PALABRAS_OFENSIVAS = ["puto", "puta", "mierda", "verga", "pija", "concha", "chota", "culo", "boludo", "boluda", "pelotudo", "pelotuda", "idiota", "tarado", "tarada"]; 

const PALABRAS_CLAVE = {};

const BARRIOS = ["SAN CAYETANO","COMI PINI","ACCESO NORTE","EL OBISPADO","LOMAS ALTAS",
    "BARRIO JARDIN","VILLA LUJAN","EL ALGARROBO","LA NORIA CHICA","LA ESMERALDA",
    "SAN LUIS","LA CONCORDIA","ESCRIBANO","SAN JOSE","CENTRO","EL HUECO","FATIMA",
    "SAN JUAN BAUTISTA","LAS VIOLETAS","BALDOMERO FERNANDEZ MORENO","GALLO BLANCO",
    "EL IPORA","LA PAMPITA","ANAHI","EL PORTEÑO","ESTEBAN ECHEVERRIA","LOS AROMOS",
    "BARRIO PARQUE GIRADO","CHASCOMUS","CABALLO BLANCO","30 DE MAYO","LOS SAUCES","SAN NICOLAS"]; 

/* --- FUNCIÓN CONTROL DE ESTADOS DEL AVATAR --- */
function setChasBotState() {
    const avatar = document.getElementById('avatar-bot');
    if (!avatar) return;
    avatar.src = IMG_BOT_NORMAL;
}

/* --- 2. RESPUESTAS Y MENÚS COMBINADOS --- */
const MENUS = {
    main: { 
        title: (name) => `¡<b>${name}</b>! 👋 Soy el asistente virtual. Acá te dejo los accesos más rápidos de hoy:`, 
        options: [
            { id: 'oea_shortcut', label: '👀 Ojos en Alerta', type: 'leaf', apiKey: 'ojos_en_alerta' },
            { id: 'ag_shortcut', label: '🎭 Agenda Cultural', type: 'leaf', apiKey: 'agenda_dinamica' }, 
            { id: 'h_shortcut', label: '📅 Turnos Hospital', type: 'leaf', apiKey: 'h_turnos' },
            { id: 'politicas_gen_shortcut', label: '💜 GÉNERO (Urgencias)', type: 'leaf', apiKey: 'politicas_gen' },
            { id: 'full_menu', label: '☰ VER MENÚ COMPLETO' }
        ]
    },
    full_menu: {
        title: () => '📱 Menú Completo de Servicios Municipales:',
        options: [
            { id: 'politicas_gen', label: '💜 GÉNERO (Urgencias)', type: 'leaf', apiKey: 'politicas_gen' },
            { id: 'politicas_comu', label: '🛍️ Módulos (alimentos)', type: 'leaf', apiKey: 'asistencia_social' },
            { id: 'desarrollo_menu', label: '🤝 Desarrollo Social' },
            { id: 'ojos_en_alerta', label: '👁️ Ojos en Alerta (Seguridad)', type: 'leaf', apiKey: 'ojos_en_alerta' },
            { id: 'el_digital', label: '📰 Kiosco Digital' },
            { id: 'educacion', label: '📚 Educación Municipal', type: 'submenu'},
            { id: 'turismo', label: '🏖️ Turismo' },
            { id: 'deportes', label: '⚽ Deportes' },
            { id: 'salud', label: '🏥 Salud' },
            { id: 'obras', label: '🚧 Reclamos 147' },
            { id: 'seguridad', label: '🛡️ Seguridad' },
            { id: 'produccion', label: '🏭 Producción y Empleo' },
            { id: 'habilitaciones', label: '💰 Habilitaciones' },
            { id: 'omic', label: '🏦 Denuncias Omic', type: 'leaf', apiKey: 'omic_info' },
            { id: 'cultura', label: '🎭 Cultura y Agenda' },
            { id: 'habitat', label: '🏡 Reg demanda Habitacional', type: 'submenu' },
            { id: 'pago_deuda', label: '🅿️ago: Auto, Agua, Inmueble', type: 'submenu' },
            { id: 'contacto_op', label: '☎️ Hablar con Operador', type: 'leaf', apiKey: 'contacto_gral' }
        ]
    },
    ojos_en_alerta: {
        title: () => '👁️ Ojos en Alerta:',
        options: [ { id: 'oea_link', label: '🔗 Contacto WhatsApp', link: 'https://wa.me/5492241557444' } ]
    },
    cultura: {
        title: () => '🎭 Agenda Cultural:',
        options: [ { id: 'ag_actual', label: '📅 agenda dinámica', type: 'leaf', apiKey: 'agenda_dinamica' } ]
    },
    el_digital: {
        type: 'card',
        title: () => '🗞️ Kiosco Digital',
        subtitle: 'Noticias y Boletín Oficial',
        image: 'el_digi.png', 
        footer: 'Portal Unificado',
        description: `Accedé a la información local y oficial desde aquí:<br><br>📰 <b>El Digital Chascomús</b><br><i>Noticias y actualidad al instante.</i><br><a href="https://www.eldigitalchascomus.com.ar/" target="_blank" class="wa-btn" style="background-color: #25d366 !important; color: white !important; padding: 5px 10px; border-radius: 5px; display: inline-block; margin-bottom: 5px; text-decoration: none; text-align: center;">🚀 Leer El Digital</a><hr style="border-top: 1px dashed #ccc; margin: 15px 0;">📜 <b>Boletín Oficial (SIBOM)</b><br><i>Decretos y normativas municipales.</i><br><a href="https://sibom.slyt.gba.gob.ar/cities/31/" target="_blank" class="wa-btn" style="background-color: #25d366 !important; color: white !important; padding: 5px 10px; border-radius: 5px; display: inline-block; margin-bottom: 5px; text-decoration: none; text-align: center;">🏛️ Ver Boletín Oficial</a>`,
        options: [] 
    },
    educacion: {
        title: () => '📚 Educación:',
        options: [
            { id: 'edu_info', label: '🎓 Educación y Tribunal', type: 'leaf', apiKey: 'educacion_info' },
            { id: 'ap_info', label: '📢 Actos Públicos (Horarios)', type: 'leaf', apiKey: 'actos_publicos' },
            { id: 'cartelera_web', label: '📊 Cartelera y Listados', type: 'leaf', apiKey: 'cartelera_docente' },
        ]
    },
    turismo: {
        title: () => 'Turismo y Cultura:',
        options: [
            { id: 't_info', label: 'ℹ️ Oficinas y Contacto', type: 'leaf', apiKey: 'turismo_info' },
            { id: 't_link', label: '🔗 Web de Turismo', link: 'https://linktr.ee/turismoch', target: '_blank' }
        ]
    },
    deportes: {
        title: () => 'Deportes:',
        options: [
            { id: 'd_info', label: '📍 Dirección de Deportes', type: 'leaf', apiKey: 'deportes_info' },
            { id: 'd_calle', label: '🏃 Circuito de Calle', type: 'leaf', apiKey: 'deportes_circuito' },
            { id: 'trail_info', label: '🚴 Trail', type: 'leaf', apiKey: 'deportes_trail' },
            { id: 'aguas_abiertas', label: '🏊 Aguas Abiertas', type: 'leaf', apiKey: 'info_deportes_aguas' }
        ]
    },
    desarrollo_menu: {
        title: () => 'Desarrollo Social y Comunitaria:', 
        options: [
            { id: 'mediacion', label: '⚖️ Mediación Vecinal', type: 'leaf', apiKey: 'mediacion_info' },
            { id: 'uda', label: '📍 Puntos UDA', type: 'leaf', apiKey: 'uda_info' },
            { id: 'ninez', label: '👶 Niñez', type: 'leaf', apiKey: 'ninez' }
        ]
    },
    habitat: {
        title: () => 'Secretaría de Hábitat:',
        options: [
            { id: 'habitat', label: '🔑 Info de Hábitat', type: 'leaf', apiKey: 'info_habitat' },
            { id: 'hab_info', label: '📍 Dirección y Contacto', type: 'leaf', apiKey: 'habitat_info' },
            { id: 'hab_plan', label: '🏘️ Planes Habitacionales', type: 'leaf', apiKey: 'habitat_planes' }
        ]
    },
    salud: { 
        title: () => 'Gestión de Salud Pública:', 
        options: [
            { id: 'centros', label: '🏥 CAPS (Salitas)', type: 'submenu' },
            { id: 'hospital_menu', label: '🏥 Hospital', type: 'submenu' },
            { id: 'f_lista', label: '💊 Farmacias y Turnos', type: 'leaf', apiKey: 'farmacias_lista' },
            { id: 'zoonosis', label: '🐾 Zoonosis', type: 'leaf', apiKey: 'zoo_rabia' },
            { id: 'vac_hu', label: '💉 Vacunatorio', type: 'leaf', apiKey: 'vacunacion_info' }
        ]
    },
    centros: { 
        title: () => 'Centros de Atención Primaria (CAPS):',
        options: [
            { id: 'c_map', label: '📍 Ver Ubicaciones (Mapas)', type: 'leaf', apiKey: 'caps_mapas' },
            { id: 'c_wa', label: '📞 Números de WhatsApp', type: 'leaf', apiKey: 'caps_wa' }
        ]
    },
    hospital_menu: {
        title: () => 'Hospital Municipal:',
        options: [
            { id: 'h_tur', label: '📅 WhatsApp Turnos', type: 'leaf', apiKey: 'h_turnos' },
            { id: 'h_espec_menu', label: '🩺 Especialidades', type: 'submenu' },
            { id: 'h_guardia', label: '🚨 Guardia e Info', type: 'leaf', apiKey: 'h_info' }
        ]
    },
    h_espec_menu: {
        title: () => '🩺 Seleccioná la especialidad para ver los días:',
        options: [
            { id: 'esp_pediatria', label: '👶 Pediatría', type: 'leaf', apiKey: 'info_pediatria' },
            { id: 'esp_clinica', label: '🩺 Clínica Médica', type: 'leaf', apiKey: 'info_clinica' },
            { id: 'esp_gineco', label: '🤰 Ginecología / Obstetricia', type: 'leaf', apiKey: 'info_gineco' },
            { id: 'esp_cardio', label: '❤️ Cardiología', type: 'leaf', apiKey: 'info_cardio' },
            { id: 'esp_trauma', label: '🦴 Traumatología', type: 'leaf', apiKey: 'info_trauma' },
            { id: 'esp_oftalmo', label: '👁️ Oftalmología', type: 'leaf', apiKey: 'info_oftalmo' },
            { id: 'esp_nutri', label: '🍎 Nutrición', type: 'leaf', apiKey: 'info_nutri' },
            { id: 'esp_cirugia', label: '🔪 Cirugía', type: 'leaf', apiKey: 'info_cirugia' },
            { id: 'esp_neuro', label: '🧠 Neurología / Psiquiatría', type: 'leaf', apiKey: 'info_neuro_psiq' }
        ]
    },
    seguridad: { 
        title: () => 'Seguridad y Trámites:', 
        options: [
            { id: 'seg_video_a', label: '🎥 Ver Video alcohol al volante', type: 'leaf', apiKey: 'alcohol_info' },
            { id: 'pamuv', label: '🆘 Asistencia Víctima (PAMUV)', type: 'leaf', apiKey: 'pamuv' },
            { id: 'seg_video_b', label: '🎥 Ver Video Instructivo Basapp ', type: 'leaf', apiKey: 'Basapp_info' },
            { id: 'apps_seg', label: '📲 Descargar Apps (Basapp y SEM)', type: 'leaf', apiKey: 'apps_seguridad' }, 
            { id: 'def_civil', label: '🌪️ Defensa Civil (103)', type: 'leaf', apiKey: 'defensa_civil' },
            { id: 'lic_tramite', label: '🪪 Licencia (Carnet)', type: 'leaf', apiKey: 'lic_turno' },
            { id: 'seg_academia', label: '🚗 Academia Conductores', type: 'leaf', apiKey: 'seg_academia' },
            { id: 'document_info', label: '🎥 Ver Video Documentación de Tránsito', type: 'leaf', apiKey: 'document_info' },
            { id: 'seg_infracciones', label: '⚖️ Mis Infracciones', type: 'leaf', apiKey: 'seg_infracciones' },
            { id: 'poli', label: '📞 Monitoreo y Comisaría', type: 'leaf', apiKey: 'poli' }
        ]
    },
    habilitaciones: {
        title: () => 'Gestión de Habilitaciones:',
        options: [
            { id: 'hab_video', label: '🎥 Ver Video Instructivo', type: 'leaf', apiKey: 'hab_video_info' },
            { id: 'hab_gral', label: '🏢 Comercio e Industria', type: 'leaf', apiKey: 'hab_gral' },
            { id: 'hab_eventos', label: '🎉 Eventos y Salones', type: 'leaf', apiKey: 'hab_eventos' },
            { id: 'hab_espacio', label: '🍔 Patios y Carros (Foodtruck)', type: 'leaf', apiKey: 'hab_espacio' },
            { id: 'hab_reba', label: '🍷 REBA (Alcohol)', type: 'leaf', apiKey: 'hab_reba' }
        ]
    },
    pago_deuda: {
        title: () => 'Pago de Deudas y Boletas:',
        options: [
            { id: 'deuda_video', label: '🎥 Ver Video Instructivo', type: 'leaf', apiKey: 'deuda_video_info' },
            { id: 'deuda', label: '🔍 Ver Deuda / Pagar', type: 'leaf', apiKey: 'deuda' },
            { id: 'agua', label: '💧 Agua', type: 'leaf', apiKey: 'agua' },
            { id: 'boleta', label: '📧 Boleta Digital', type: 'leaf', apiKey: 'boleta' },
            { id: 'consulta_tributaria', label: '💸 Consulta Tributaria', type: 'leaf', apiKey: 'consulta_tributaria' }
        ]
    },
    produccion: {
        title: () => '🏭 Producción y Empleo:',
        options: [
            { id: 'prod_eco_social', label: '🟢 Economía Social', type: 'submenu' },
            { id: 'prod_of_empleo', label: '🔵 Oficina de Empleo (Busco Trabajo)', type: 'submenu' },
            { id: 'prod_empresas', label: '🟠 Empresas y Emprendedores', type: 'submenu' },
            { id: 'prod_empleadores', label: '🟣 Empleadores (Busco Personal)', type: 'submenu' },
            { id: 'prod_manipulacion', label: '🔴 Carnet Manipulación Alimentos', type: 'leaf', apiKey: 'res_manipulacion' },
            { id: 'prod_contacto', label: '📍 Contacto y Dirección', type: 'leaf', apiKey: 'prod_contacto' }
        ]
    },
    prod_eco_social: {
        title: () => '🟢 Economía Social:',
        options: [
            { id: 'pe_compre', label: '🤝 Compre Chascomús', type: 'leaf', apiKey: 'res_compre_chascomus' },
            { id: 'pe_frescos', label: '🥦 Productores Alimentos Frescos', type: 'leaf', apiKey: 'res_prod_frescos' }
        ]
    },
    prod_of_empleo: {
        title: () => '🔵 Oficina de Empleo:',
        options: [
            { id: 'oe_inscripcion', label: '📝 Inscripción / Actualizar CV', type: 'leaf', apiKey: 'res_oe_inscripcion' },
            { id: 'oe_promover', label: '♿ Programa Promover (Discapacidad)', type: 'leaf', apiKey: 'res_oe_promover' },
            { id: 'oe_taller_cv', label: '📄 Taller Armado de CV', type: 'leaf', apiKey: 'res_oe_taller_cv' }
        ]
    },
    prod_empresas: {
        title: () => '🟠 Empresas y Emprendedores:',
        options: [ { id: 'emp_chasco', label: '🚀 Chascomús Emprende', type: 'leaf', apiKey: 'res_emp_chasco' } ]
    },
    prod_empleadores: {
        title: () => '🟣 Empleadores:',
        options: [
            { id: 'empl_busqueda', label: '🔎 Publicar Búsqueda Laboral', type: 'leaf', apiKey: 'res_empl_busqueda' },
            { id: 'empl_madrinas', label: '🤝 Empresas Madrinas', type: 'leaf', apiKey: 'res_empl_madrinas' }
        ]
    },
    obras: {
        title: () => 'Atención al Vecino 147:',
        options: [
            { id: 'info_147', label: '📝 Iniciar Reclamo 147 (Chat), ℹ️ Info, Web y Teléfonos', type: 'leaf', apiKey: 'link_147' },
            { id: 'poda', label: '🌿 Poda', type: 'leaf', apiKey: 'poda' },
            { id: 'obras_basura', label: '♻️ Recolección', type: 'leaf', apiKey: 'obras_basura' }
        ]
    }
};

/* --- ESTILO GLOBAL PARA ENLACES --- */
const linkEstiloGlobal = `class="wa-btn" style="background-color: #25d366 !important; color: white !important; padding: 5px 10px; border-radius: 5px; display: inline-block; margin-bottom: 5px; text-decoration: none; text-align: center;"`;

/* --- 4. RESPUESTAS ESTÁTICAS COMBINADAS --- */
const RES = {
    // --- GENERALES ---
    'agenda_dinamica': `<div class="info-card">⚠️ <b>Cargando agenda...</b><br>Si esto no cambia en unos segundos, revisá tu conexión.</div>`,
    'agenda_actual': `
    <div class="info-card">
        <strong>📅 AGENDA MARZO 2026</strong><br>
        <i>¡Viví la cultura y el deporte en Chascomús!</i><br><br>
        ✅ <b>Dom 1 - 🎉 Proyección de película:</b><br>"LA ZORRA Y LA PAMPA" (Día del Ferroviario).<br>📍 C.C. Vieja Estación | 16 a 19 hs | 🎟️ Arancelado.<br><br>
        ✅ <b>Dom 1 - ⚽ Ciclismo:</b><br>"Chascomús a Pura Ruta".<br>📍 Circuito Juan Carlos Haedo | 09:00 hs.<br><br>
        🔴 <span style="color: #e74c3c;"><b>Jue 5 y Vie 6 - 🎭 Visitas Dramatizadas:</b><br>Recorrido teatralizado histórico.<br>📍 Vieja Estación / Casa de Casco | 21:00 hs | 🎟️ $18.000.</span><br><br>
        ✅ <b>Sáb 7 - 🏊 Natación:</b><br>"Cruce de la Laguna" (3.000 mts).<br>📍 Club de Regatas | 13:00 hs (Largada).<br><br>
        ✅ <b>Dom 29 - 🚵 MTB:</b><br>"Desafío MTB Chascomús" (Rally 14k, 28k y 42k).<br>📍 Costanera | Horario a confirmar.<br><br>
        <hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
        🏛️ <b>ESPACIOS PERMANENTES:</b><br>• <b>Museos y Vieja Estación:</b> MAR a VIE 9-15hs / SAB y DOM 10-16 y 19-21hs.<br>• <b>Feria de Artesanos:</b> VIE (17hs), SAB y DOM (11hs) en Costanera y Perón.<br><br>
        🔗 <b>INSCRIPCIONES Y LINKS:</b><br><a href="https://wa.me/5492241603414" target="_blank" ${linkEstiloGlobal}>📲 Info por WhatsApp</a><br><br>
        <a href="https://linktr.ee/visitasguiadas.turismoch" target="_blank" ${linkEstiloGlobal}>🔗 Linktree de Inscripciones</a>
    </div>`,
    'error_busqueda': `
    <div class="info-card" style="border-left: 5px solid #ffc107;">
        <div style="font-size: 1.1rem; margin-bottom: 8px;">🤔 <b>¡Ups! Eso no lo tengo</b></div>
        <p style="font-size: 0.9rem; margin-bottom: 15px; color: #333;">
            Todavía estoy aprendiendo y se me escapó. ¿Lo intentamos con otras palabras, o vemos el menú completo y lo buscamos juntos?
        </p>
        <button onclick="interaccionIniciada=true; resetToMain()" class="menu-btn" style="width: 100%; padding: 12px; background-color: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
            ☰ Ver Menú Completo
        </button>
    </div>`,
    'educacion_info': `
    <div class="info-card">
        <strong>🎓 Educación, Infancias y Juventudes</strong><br>
        <i>Subsecretario: Lic. Enrique Inciarte</i><br><br>
        📍 <b>Dirección de Educación:</b><br>
        Mendoza 95, esq. Moreno.<br>
        ⏰ Lun a Vie de 8 a 14 hs.<br><br>
        📞 <b>Vías de contacto:</b><br>
        <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;">
            <a href="tel:02241430332" ${linkEstiloGlobal} style="flex:1; min-width: 120px;">📞 Fijo 43-0332</a>
           <a href="https://wa.me/5492241569898" target="_blank" ${linkEstiloGlobal} style="flex:1; min-width: 120px;">
           💬 WhatsApp 56-9898</a>
        </div> <br> 📧 <a href="mailto:educacion@chascomus.gob.ar" ${linkEstiloGlobal}>educacion@chascomus.gob.ar</a><br>
        <small><i>Admin: M. Lastero y L. Dellavalle</i></small>
        <hr style="border-top: 1px dashed #ccc; margin: 15px 0;">
        ⚖️ <b>Tribunal de Clasificación Docente</b><br>
        📅 Lunes y Miércoles 16 a 17:30 hs.<br>
        👥 <i>Sallenave, Ganuza, Esain e Inciarte.</i><br><br>
        📧 <a href="mailto:tribunalmunicipalchascomus@gmail.com" ${linkEstiloGlobal} style="display:block; width:100%;">✉️ Email Tribunal</a>
    </div>`,
    'actos_publicos': `
    <div class="info-card" style="border-left: 5px solid #2980b9;">
        <strong>📢 Actos Públicos Presenciales (AP)</strong><br>
        <i>Designación de cargos docentes</i><br><br>
        📅 <b>¿Cuándo?</b><br>
        Se realizan todos los días (Lun a Vie).<br><br>
        ⏰ <b>Horarios (Puntual):</b><br>
        ☀️ Mañana: <b>08:45 hs</b><br>
        🕐 Tarde: <b>12:45 hs</b><br><br>
        📍 <b>Lugar:</b> Mendoza 95.<br><br>
        ⚠️ <b>Requisito Excluyente:</b><br>
        Presentarse con <b style="color:#c0392b; text-decoration: underline;">DNI FÍSICO</b>.<br>
        <small>(No se acepta DNI digital en el celular).</small><br><br>
        <hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
        👤 <b>¿Envías un representante?</b><br>
        Debe presentar sin excepción:<br><br>
        1️⃣ <a href="https://docs.google.com/document/d/1EMRh4aS-bGvaayc7RrXReb950zW4dXHrOxODatNoark/edit?tab=t.0&usp=sharing" target="_blank" ${linkEstiloGlobal}>📄 Descargar Acta Poder</a><br>
        2️⃣ Copia de DNI (del docente y del representante).<br>
        3️⃣ <a href="https://docs.google.com/document/d/19iBlPe4QvzMT1G1_SI5KmNOJ9MjSJxHy/edit?usp=sharing" target="_blank" ${linkEstiloGlobal}>📜 Estatuto Docente Municipal</a><br><br>
        <a href="https://www.google.com/maps/search/?api=1&query=Mendoza+95+Chascomus" target="_blank" ${linkEstiloGlobal}>📍 Ver Ubicación en Mapa</a>
    </div>`,
    'cartelera_docente': `
    <div class="info-card" style="border-left: 5px solid #27ae60;">
        <strong>📊 Cartelera en Línea (Actos Públicos)</strong><br>
        <i>Actualización en tiempo real</i><br><br>
        En esta planilla se publican los <b>cargos/horas a cubrir</b> y los resultados (designaciones o desiertos).<br><br>
        <a href="https://docs.google.com/spreadsheets/d/15w5mnPVqRsaebkZ-zAmrum8ndqh5MhoWkMDc9j8J7tM/edit?gid=0#gid=0" target="_blank" ${linkEstiloGlobal} style="display:block;">✅ Ver Cartelera y Designaciones</a>
        <hr style="border-top: 1px dashed #ccc; margin: 15px 0;">
        <strong>🏆 Resultados Titularizaciones 2026</strong><br>
        <small>📅 Publicado: 22/12/2025</small><br><br>
        Los resultados del Acto de Titularizaciones pueden observarse aquí:<br><br>
        <a href="https://docs.google.com/spreadsheets/d/1ZzYjG5drCNG50gWmmdheHYfUygtz0XK1hWfLSoAwcyk/edit?gid=0#gid=0" target="_blank" ${linkEstiloGlobal} style="display:block;">📄 Ver Planilla Titularizaciones</a>
        <hr style="border-top: 1px dashed #ccc; margin: 15px 0;">
        <strong>📂 Listados Oficiales 2026</strong><br>
        <small style="color: #e67e22;">🚧 (En proceso de actualización)</small><br><br>
        👇 <i>Consultá por nivel:</i><br>
        <ul style="padding-left: 20px; margin-top: 5px;">
            <li>🎒 <b>Inicial</b></li>
            <li>✏️ <b>Primaria</b></li>
            <li>📖 <b>Secundaria</b></li>
           <li>🤝 <b>Psicología (EOE)</b></li>
        </ul> <br><a href="https://docs.google.com/spreadsheets/d/15731Nf1EuRPRv8Z8isPW_-_VNawWyiuHMhnFWH70W14/edit?gid=0#gid=0" target="_blank" ${linkEstiloGlobal}>🔗 Ver carpeta de Listados</a>
    </div>`,
    'omic_info': `
    <div class="info-card">
        <strong>📢 OMIC (Defensa del Consumidor)</strong><br>
        Oficina Municipal de Información al Consumidor.<br><br>
        ⚖️ <b>Asesoramiento y Reclamos:</b><br>
        Protección de derechos en compras y servicios.<br><br>
        📍 <b>Dirección:</b> Dorrego 229 (Estación Ferroautomotora).<br>
        ⏰ <b>Horario:</b> Lunes a Viernes de 8:00 a 13:00 hs.<br>
        📞 <b>Teléfonos:</b> <a href="tel:431287" ${linkEstiloGlobal}>43-1287</a> / <a href="tel:425558" ${linkEstiloGlobal}>42-5558</a>
    </div>`,
    'caps_wa': `
    <div class="info-card">
        <strong>📞 WhatsApp de los CAPS:</strong><br><br>
        🟢 <b>30 de Mayo:</b> <a href="https://wa.me/5492241588248" target="_blank" ${linkEstiloGlobal}>2241-588248</a><br>
        🟢 <b>Barrio Jardín:</b> <a href="https://wa.me/5492241498087" target="_blank" ${linkEstiloGlobal}>2241-498087</a><br>
        🟢 <b>San Luis:</b> <a href="https://wa.me/5492241604874" target="_blank" ${linkEstiloGlobal}>2241-604874</a><br>
        🟢 <b>El Porteño:</b> <a href="https://wa.me/5492241409316" target="_blank" ${linkEstiloGlobal}>2241-409316</a><br>
        🟢 <b>Gallo Blanco:</b> <a href="https://wa.me/5492241469267" target="_blank" ${linkEstiloGlobal}>2241-469267</a><br>
        🟢 <b>Iporá:</b> <a href="https://wa.me/5492241588247" target="_blank" ${linkEstiloGlobal}>2241-588247</a><br>
        🟢 <b>La Noria:</b> <a href="https://wa.me/5492241604872" target="_blank" ${linkEstiloGlobal}>2241-604872</a><br>
        🟢 <b>San Cayetano:</b> <a href="https://wa.me/5492241511430" target="_blank" ${linkEstiloGlobal}>2241-511430</a>
    </div>`,
    'caps_mapas': `
    <div class="info-card">
        <strong>📍 Ubicaciones CAPS (Toque para ver mapa):</strong><br><br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CIC+30+de+Mayo+Chascomus" target="_blank" ${linkEstiloGlobal}>CIC 30 de Mayo</a> (Bvd. 5 y Calle 2)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+Barrio+Jardin+Chascomus" target="_blank" ${linkEstiloGlobal}>Barrio Jardín</a> (Tucumán e/ Quintana)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+San+Luis+Chascomus" target="_blank" ${linkEstiloGlobal}>San Luis</a> (Chubut 755)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+El+Porteño+Chascomus" target="_blank" ${linkEstiloGlobal}>El Porteño</a> (Lucio Mansilla)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+Gallo+Blanco+Chascomus" target="_blank" ${linkEstiloGlobal}>Gallo Blanco</a> (Estados Unidos)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+Ipora+Chascomus" target="_blank" ${linkEstiloGlobal}>Iporá</a> (Sargento Cabral 387)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+La+Noria+Chascomus" target="_blank" ${linkEstiloGlobal}>La Noria</a> (Grito de Dolores)<br>
        • <a href="https://www.google.com/maps/search/?api=1&query=CAPS+San+Cayetano+Chascomus" target="_blank" ${linkEstiloGlobal}>San Cayetano</a> (Gabino Ezeiza)
    </div>`,
    'link_147': `
    <div class="info-card">
        <strong>📝 ATENCIÓN AL VECINO 147</strong><br><br>
        💻 <b>Primera opción:</b>Web Autogestión (24/7):</b><br>
        Cargá tu ticket y seguí el caso.<br>
        🔗 <a href="https://147.chascomus.gob.ar" target="_blank" ${linkEstiloGlobal}>147.chascomus.gob.ar</a><br><br>
        📧 <b>Correo:</b> <a href="mailto:atencionalvecino@chascomus.gob.ar" ${linkEstiloGlobal}>atencionalvecino@chascomus.gob.ar</a><br><br>
           <b>Utilizar como ultima opcion:</b><br>
        📞 <b>Teléfono (Línea 147):</b><br>
        Lun a Vie de 8 a 15 horas.<br><br>
    </div>`,

'poda': `<div class="info-card"><strong>🌿 Ingresa en este link 👇🏼</strong><br>🔗 <a href="https://apps.chascomus.gob.ar/podaresponsable/solicitud.php" target="_blank" ${linkEstiloGlobal}>🌳 Solicitud Poda</a></div>`,

'obras_basura': `
<div class="info-card">
<strong>♻️ Recolección de Residuos:</strong><br><br>
📅 <b>Días de Recolección:</b><br>
• Lunes, Miércoles y Viernes: Zona Norte.<br>
• Martes, Jueves y Sábado: Zona Sur.<br><br>
⏰ <b>Horario:</b> 7:00 a 15:00 hs.<br><br>
• <b>Recomendación:</b> Sacar la basura la noche anterior para evitar olores y animales.<br>
• <b>Contenedores verde oscuro:</b> Para residuos generales.<br>
• <b>Puntos verdes:</b> Para reciclables (plástico, papel, vidrio).<br><br>
</div>`,

'farmacias_lista': `
    <div class="info-card">
        <strong>📍 Farmacias en Chascomús:</strong><br><br>
        • <b>Alfonsín:</b> Libres del Sur 121<br>
        • <b>Aprile:</b> Av. Lastra 115<br>
        • <b>Batastini:</b> Cramer 70<br>
        • <b>Belgrano:</b> Belgrano 649<br>
        • <b>Bellingieri:</b> H. Yrigoyen 78<br>
        • <b>Cangialosi:</b> Garay 56<br>
        • <b>Chascomús:</b> Av. Lastra 350<br>
        • <b>Del Norte:</b> El Ombú 102<br>
        • <b>Farmasur:</b> Bahía Blanca 91<br>
        • <b>Malena:</b> Escribano y Machado<br>
        • <b>Moriset:</b> Av. Lastra 591<br>
        • <b>Oria:</b> Libres del Sur 413<br>
        • <b>Pasteur:</b> Libres del Sur 302<br>
        • <b>Pensa:</b> H. Yrigoyen 710<br>
        • <b>Pozzi:</b> Rioja 28<br>
        • <b>Puyssegur:</b> Libres del Sur 946<br><br>
        💊 <a href="https://www.turnofarma.com/turnos/ar/ba/chascomus" target="_blank" ${linkEstiloGlobal}>VER FARMACIAS DE TURNO</a>
    </div>`,
    'zoo_rabia': `
    <div class="info-card" style="border-left: 5px solid #f1c40f;">
        <strong style="color:#d35400;">🐾 Quirófano Móvil (Castración)</strong><br><br>
        📅 <b>Lunes 3 de Febrero</b><br>
        ⏰ <b>A partir de las 8:30hs</b><br>
        📍 <b>Barrio Los Sauces</b> (Destacamento policial)<br><br>
        ✅ <b>GRATIS</b> - Revisación Clínica.<br>
        🐕 <b>Requisito:</b> Llevar la mascota con collar, correa y/o transportadora.<br><br>
        🏢 <b>Sede Zoonosis:</b> Mendoza 95.
    </div>`,
    'vacunacion_info': `
    <div class="info-card">
        <strong>💉 Vacunación</strong><br><br>
        🏥 <b>Hospital San Vicente de Paul:</b><br>
        Vacunatorio central. Prioridad: Niños (6m a 2a), gestantes y puérperas.<br><br>
        🏠 <b>Puntos Barriales:</b><br>
        CIC "Dr. Quintín" (30 de Mayo) y otros CAPS.<br><br>
        📋 <b>Info Importante:</b><br>
        • <b>Demanda espontánea</b> (No requiere orden médica).<br>
        • <b>Requisitos:</b> Llevar DNI y Libreta de Vacunación.<br><br>
        📱 <i>Consultá las redes de "Secretaría de Salud Chascomús" para horarios actualizados.</i>
    </div>`,
    'info_habitat': `
    <div class="info-card">
        <strong>🔑 Info de Hábitat</strong><br>
        • Registro de Demanda (Mayores de 18).<br>
        • Bien de Familia (Protección jurídica).<br>
        • Gestión de Tierras y Catastro.<br><br>
        👇 <b>Seleccioná una opción:</b>
    </div>`,
    'habitat_info': `
    <div class="info-card">
        <strong>📍 Dirección y contacto</strong><br>
        <i>Dirección de Hábitat y Tierras</i><br><br>
        <a href="https://wa.me/5492241559412" target="_blank" ${linkEstiloGlobal}>💬 Consultas WhatsApp</a>
        <a href="https://www.google.com/maps/search/?api=1&query=Dorrego+y+Bolivar+Chascomus" target="_blank" ${linkEstiloGlobal}>📍 Dorrego y Bolivar (Ex IOMA)</a>
       </div>`,
    'habitat_planes': `
    <div class="info-card">
        <strong>🏘️ Planes Habitacionales</strong><br>
        <i>Programas de vivienda social y acceso a la tierra</i><br><br>
        📋 <b>Trámites Disponibles:</b><br>
        1. Registro de Demanda Habitacional.<br>
        2. Solicitud de Bien de Familia.<br>
        3. Consultas sobre Planes de Vivienda.<br><br>
        <a href="https://apps.chascomus.gob.ar/vivienda/" target="_blank" ${linkEstiloGlobal}>🔗 Planes Habitacionales</a>
    </div>`,
     'ojos_en_alerta': `
    <div class="info-card">
        <strong>👀 OJOS (En alerta)</strong><br>
        Programa de seguridad ciudadana.<br><br>
        ⚖️ <b>Denuncias, Robo, Accidentes, Actitudes sospechosas, etc.:</b><br>
        Protección de derechos del ciudadano.<br><br>
        📍 <b>Dirección:</b> Arenales y Julian quintana.<br>
        ⏰ <b>Horario:</b> Lunes a Lunes 24hs.<br>
        <a href="https://wa.me/5492241557444" target="_blank" ${linkEstiloGlobal}>📲 Por cualquier info (WhatsApp)</a>
    </div>`,
    'pamuv': `<div class="info-card" style="border-left: 5px solid #c0392b;"><strong style="color: #c0392b;">🆘 PAMUV (Asistencia a la Víctima)</strong><br><br>Atención, contención y asesoramiento a personas víctimas de delitos o situaciones de violencia.<br><br>🛡️ <b>Plan Integral de Seguridad 2025-2027</b><br><br>🚨 <b>ATENCIÓN 24 HORAS:</b><br>Línea permanente para emergencias o consultas.<br><a href="https://wa.me/5492241514881" target="_blank" ${linkEstiloGlobal}>📞 2241-514881 (WhatsApp)</a></div>`,
    'defensa_civil': `<div class="info-card" style="border-left: 5px solid #c0392b;">
    <strong style="color: #c0392b;">🌪️ Defensa Civil</strong><br><br>
    🚨 <b>LÍNEA DE EMERGENCIA:</b><br>
    Atención ante temporales, caída de árboles y riesgo en vía pública.<br>
    <a href="tel:103" ${linkEstiloGlobal} style="display:block;">📞 LLAMAR AL 103</a><br>
    <a href="mailto:defensa.civil@chascomus.gob.ar" ${linkEstiloGlobal} style="display:block;">📧 Enviar Correo Electrónico</a></div>`,
    'Basapp_info': `
    <div class="info-card">
        <strong>🎥 Guía de Basapp</strong><br><br>
        <video width="100%" height="auto" controls style="border-radius: 8px; border: 1px solid #ddd;">
            <source src="videos/Basapp.mp4" type="video/mp4">
            Tu navegador no soporta el video.
        </video>
        <br><br>
        <p style="font-size: 0.85rem; color: #555;">
            Mirá este breve tutorial sobre cómo usar la app Basapp.
        </p>
    </div>`,
    'apps_seguridad': `
    <div class="info-card">
        <strong>📲 Aplicaciones de Seguridad y Tránsito</strong><br><br>
        🔔 <b>BASAPP (Alerta Vecinal):</b><br>
        Botón antipánico y reportes.<br>
        🤖 <a href="https://play.google.com/store/apps/details?id=ar.com.basapp.android.client" target="_blank" rel="noopener noreferrer" ${linkEstiloGlobal}>Descargar Android</a><br>
        🍎 <a href="https://apps.apple.com/ar/app/basapp/id1453051463" target="_blank" rel="noopener noreferrer" ${linkEstiloGlobal}>Descargar iPhone</a><br><br>
        
        🅿️ <b>SEM (Estacionamiento Medido):</b><br>
        Gestioná tu estacionamiento.<br>
        🤖 <a href="https://play.google.com/store/apps/details?id=ar.edu.unlp.semmobile.chascomus" target="_blank" rel="noopener noreferrer" ${linkEstiloGlobal}>Descargar Android</a><br>
        🍎 <a href="https://apps.apple.com/ar/app/sem-mobile/id1387705895" target="_blank" rel="noopener noreferrer" ${linkEstiloGlobal}>Descargar iPhone</a></div>`,
   
        'alcohol_info': `
    <div class="info-card">
        <strong>🎥 Guía de alcohol al volante</strong><br><br>
        <video width="100%" height="auto" controls style="border-radius: 8px; border: 1px solid #ddd;">
            <source src="videos/Alcohol_al_volante.mp4" type="video/mp4">
            Tu navegador no soporta el video.
        </video>
        <br><br>
        <p style="font-size: 0.85rem; color: #555;">
            Mirá este breve tutorial sobre alcohol al volante.
        </p>
    </div>`,

    'document_info': `
    <div class="info-card">
        <strong>🎥 Guía de Documentación de Tránsito</strong><br><br>
         <video width="100%" height="auto" controls style="border-radius: 8px; border: 1px solid #ddd;">
            <source src="videos/documentacion.mp4" type="video/mp4">
            Tu navegador no soporta el video.
        </video>
        <br><br>
        <p style="font-size: 0.85rem; color: #555;">
            Mirá este breve tutorial sobre documentación de tránsito.
        </p>
    </div>`,

    'seg_infracciones': 
    `<div class="info-card">
    <strong>⚖️ Infracciones:</strong><br>
    🔗 <a href="https://chascomus.gob.ar/municipio/estaticas/consultaInfracciones" target="_blank" ${linkEstiloGlobal}>VER MIS MULTAS</a></div>`,
    'seg_academia': `<div class="info-card"><strong>🚗 Academia de Conductores</strong><br>Turnos para cursos y exámenes teóricos.<br>🔗 <a href="https://apps.chascomus.gob.ar/academia/" target="_blank" ${linkEstiloGlobal}>INGRESAR A LA WEB</a></div>`,
    'seg_medido': `<div class="info-card"><strong>🅿️ Estacionamiento Medido</strong><br>Gestioná tu estacionamiento desde el celular.<br><br>📲 <b>Descargar App:</b><br>🤖 <a href="https://play.google.com/store/apps/details?id=ar.edu.unlp.sem.mobile.chascomus" target="_blank" ${linkEstiloGlobal}>Android (Google Play)</a><br>🍎 <a href="https://apps.apple.com/ar/app/sem-mobile/id1387705895" target="_blank" ${linkEstiloGlobal}>iPhone (App Store)</a><br><br>💻 <a href="https://chascomus.gob.ar/estacionamientomedido/" target="_blank" ${linkEstiloGlobal}>Gestión vía Web</a></div>`,
    'lic_turno': `<b>📅 Turno Licencia:</b><br>🔗 <a href="https://apps.chascomus.gob.ar/conducir/" target="_blank" ${linkEstiloGlobal}>SOLICITAR TURNO</a>`, 
    'poli': `
    <div class="info-card">
        <strong>🎥 (MONITOREO)</strong><br><br>
        Secretaría de Seguridad Ciudadana y el Centro de Monitoreo.<br><br>
        ☎️ <b>Para comunicarte:</b><br>
        <a href="tel:431333" ${linkEstiloGlobal}>📞 43-1333</a><br>
        <small><i>⚠️ Solo emergencias.</i></small><br><br>
         🚔 <b>POLICIA:</b><br>
        Solicitalo a <a href="tel:422222" ${linkEstiloGlobal}>📞 42-2222</a><br><br></div>`,
    'turismo_info': `<div class="info-card"><strong>🏖️ Subsecretaría de Turismo</strong><br>📍 Av. Costanera España 25<br>📞 <a href="tel:02241615542" ${linkEstiloGlobal}>02241 61-5542</a><br>📧 <a href="mailto:turismo@chascomus.gob.ar" ${linkEstiloGlobal}>Enviar Email</a><br>🔗 <a href="https://linktr.ee/turismoch" target="_blank" ${linkEstiloGlobal}>Más info en Linktree</a></div>`,
    'deportes_info': `<div class="info-card"><strong>⚽ Dirección de Deportes</strong><br>
    📍 Av. Costanera España y Av. Lastra<br>📞 <a href="tel:02241424649" ${linkEstiloGlobal}>(02241) 42-4649</a></div>`,
    
    'deportes_circuito': `
    <div class="info-card"><strong>🏃 Circuito de Calle</strong><br>Inscripciones y resultados oficiales.
    <br>🔗 <a href="https://apps.chascomus.gob.ar/deportes/circuitodecalle/" target="_blank" ${linkEstiloGlobal}>INSCRIPCIONES CIRCUITO DE CALLE</a><br>
    </div>`,
    
    'deportes_trail': `
    <div class="info-card"><strong>🚴 Trail Bike</strong><br>Inscripciones y resultados oficiales.
    <br>🔗 <a href="https://apps.chascomus.gob.ar/deportes/trail/inscripcion.php" target="_blank" ${linkEstiloGlobal}>INSCRIPCIONES TRAIL BIKE</a><br>
    </div>`,
    
'info_deportes_aguas': `
     <div class="info-card"><strong>🏊 Aguas Abiertas</strong><br>Inscripciones y resultados oficiales
     <br>🔗 <a href="https://apps.chascomus.gob.ar/deportes/aguasabiertas/inscripcion.php" target="_blank" ${linkEstiloGlobal}>INSCRIPCIONES AGUAS ABIERTAS</a><br>
    <br>🔗 <a href="https://docs.google.com/spreadsheets/d/e/2PACX-1vTdlmaYq_wSB0aZj-GNNOWRtzBK8OwZ86_eu2McGhPfcfwrelp8I1IMWWT7v9bv3QBh86sdGPVOWDKy/pubhtml" target="_blank" ${linkEstiloGlobal}>RESULTADOS OFICIALES</a><br>
     </div>`,
    'politicas_gen': `<div class="info-card" style="border-left: 5px solid #9b59b6;"><strong style="color: #8e44ad; font-size: 1rem;">
    💜 Género y Diversidad</strong><br><br><div style="font-size: 0.85rem; margin-bottom: 12px;">
    🚨 <b>Guardia 24/7:</b> Orientación y acompañamiento en casos de violencia.<br>
    🧠 <b>Equipo Técnico:</b> Abogadas, psicólogas y trabajadoras sociales.<br>
    🏠 <b>Hogar de Tránsito:</b> Alojamiento temporal para mujeres en riesgo.<br>
    🗣️ <b>Varones:</b> Espacio de abordaje y deconstrucción de conductas violentas.<br>
    👮‍♀️ <b>Articulación:</b> Trabajo conjunto con Comisaría de la Mujer.</div><div style="background: #fdf2ff; padding: 10px; border-radius: 8px; font-size: 0.9rem;">
    📍 <b>Oficina:</b> Moreno 259 (Lun-Vie 9-14hs)<br>
    ☎️ <b>Fijo Oficina:</b> <a href="tel:02241530448" ${linkEstiloGlobal}>2241-530448</a><br>
    🚓 <b>Comisaría Mujer:</b> <a href="tel:02241422653" ${linkEstiloGlobal}>42-2653</a></div><a href="https://wa.me/5492241559397" target="_blank" ${linkEstiloGlobal}>🚨 GUARDIA 24HS (WhatsApp)</a></div>`,
    'asistencia_social': `
    <div class="info-card" style="border-left: 5px solid #e67e22;">
        <strong style="color: #d35400; font-size: 1rem;">🍎 Módulos Alimentarios (CAM)</strong><br><br>
        
        <div style="font-size: 0.85rem; margin-bottom: 12px;">
            📦 <b>RETIRO DE MERCADERÍA:</b><br>
            Entrega mensual de módulos de alimentos secos para familias empadronadas.<br><br>
            📋 <b>Requisitos al retirar:</b><br>
            • Presentar DNI del titular (Obligatorio).<br>
            • Certificado médico (si corresponde a dieta celíaca).
        </div>

        <div style="background: #edb482ff; padding: 10px; border-radius: 8px; font-size: 0.9rem; border: 1px solid #ffe0b2;">
            📍 <b>Lugar de Retiro:</b><br>
            Depósito de calle Juárez (casi esquina Mazzini).<br><br>
            ⏰ <b>Horario:</b><br>
            Lunes a Viernes de 8:00 a 14:00 hs.<br><br>
            🏢 <b>Trámites y Empadronamiento:</b><br>
            Secretaría de Desarrollo (Moreno 259).
        </div>

        <br>
        <a href="https://wa.me/5492241530478" target="_blank" ${linkEstiloGlobal}>📲 Consultar Cronograma (WhatsApp)</a>
    </div>`,
    'ninez': `<div class="info-card"><strong>👶 Niñez:</strong> Mendoza Nº 95. 📞 43-1146.</div>`,
    'mediacion_info': `<div class="info-card"><strong>⚖️ Mediación Comunitaria</strong><br>Resolución pacífica y gratuita de conflictos vecinales (ruidos, mascotas, edilicios).<br>📍 <b>Acercate a:</b> Moreno 259.</div>`,
    'uda_info': `<div class="info-card"><strong>📍 Puntos UDA (Atención en Barrios)</strong><br><i>Acercate a tu punto más cercano:</i><br><br>🔹 <b>UDA 1 (San Luis):</b> Chubut 755 (Mar/Vie 9-12).<br>🔹 <b>UDA 2 (San José Obrero):</b> F. Chapa 625 (Mar/Vie 9-12).<br>🔹 <b>UDA 3 (El Porteño):</b> Mansilla y Calle 3 (Vie 9-12).<br>🔹 <b>UDA 4 (30 de Mayo):</b> Bvd. 5 y Calle 2 (Vie 9-12).<br>🔹 <b>UDA 5 (B. Jardín):</b> J. Quintana e/ Misiones (Mar/Mié 9-12).<br>🔹 <b>UDA 6 (Gallo Blanco):</b> EE.UU. y Las Flores (Lun 9-12).<br>🔹 <b>UDA 7 (San Cayetano):</b> Comedor (Mar 9-12).<br>🔹 <b>UDA 8 (Políticas Com.):</b> Sarmiento 42 (Lun-Vie 8-12).<br>🔹 <b>UDA 9 (Iporá):</b> Perú y S. Cabral (Jue 9-12).<br><br>🚨 <b>Guardia 24hs:</b> <a href="https://wa.me/5492241559397" target="_blank" ${linkEstiloGlobal}>2241-559397</a></div>`,
    'hac_tomasa': `<div class="info-card"><strong>🌾 TOMASA:</b><br>ℹ️ Portal de autogestión.<br>🔗 <a href="https://tomasa.chascomus.gob.ar/"target="_blank" ${linkEstiloGlobal}>INGRESAR</a></div>`,
    'deuda_video_info': `
    <div class="info-card">
        <strong>🎥 La muni Invierte</strong><br><br>
        <video width="100%" height="auto" controls style="border-radius: 8px; border: 1px solid #ddd;">
            <source src="videos/la_muni_invierte.mp4" type="video/mp4"> Tu navegador no soporta el video.
        </video>
        <br><br>
        <p style="font-size: 0.85rem; color: #555;">
            Mirá este breve tutorial sobre cómo iniciar tu trámite de habilitación comercial 100% online.
        </p>
    </div>`,
    'boleta': `<div class="info-card"><strong>📧 BOLETA DIGITAL</strong><br>🟢 <i>Para inscribirse comunicarse por estas vias<br> 
    📲: <a href="https://wa.me/5492241557616" target="_blank" ${linkEstiloGlobal}>2241-557616</a><br>📧 <a href="mailto:ingresospublicos@chascomus.gob.ar" ${linkEstiloGlobal}>Email</a></div>`,
    'agua': `<div class="info-card"><strong>💧 CONSUMO DE AGUA</strong><br> ℹ️ Para conocer y pagar su consumo ingrese a este Link<br>
    🔗 <a href="https://apps.chascomus.gob.ar/caudalimetros/consulta.php" target="_blank" ${linkEstiloGlobal}>VER MI CONSUMO</a></div>`, 
    'consulta_tributaria': `
    <div class="info-card">
        <strong>💸 CONSULTA TRIBUTARIA</strong><br><br>
        Ingresos Públicos.<br><br>
        ☎️ <b>Para comunicarte</b><br>
        📲 <a href="https://wa.me/5492241557616" target="_blank" ${linkEstiloGlobal}>2241-557616</a><br>
        📧 <a href="mailto:ingresospublicos@chascomus.gob.ar" ${linkEstiloGlobal}>ingresospublicos@chascomus.gob.ar</a><br><br>
        Seleccione tipo de cuenta 🏠<b>INMUEBLE</b> para deudas de Servicios Sanitarios y Alumbrado Público Empresas (ALPEM).<br>
        Seleccione tipo de cuenta 🏢<b>COMERCIO</b> para deudas de Seguridad e Higiene.<br>
        Seleccione tipo de cuenta 🚗<b>VEHÍCULOS</b> para deudas relacionadas con Impuesto Automotor o Patentes de Rodados Menores.<br>
        Seleccione tipo de cuenta 👤<b>CONTRIBUYENTE</b> para deudas de Marcas y señales (Guías) y 16 Viviendas.<br>
        Seleccione <b>PERÍODOS ADEUDADOS</b> para listar los períodos impagos de tasas.<br>
        Seleccione <b>CUOTAS DE CONVENIO</b> para listar las cuotas de convenio de pago vigentes.<br><br>
        🔗 <a href="https://deuda.chascomus.gob.ar/consulta.php" target="_blank" ${linkEstiloGlobal}>CONSULTAR AQUÍ</a>
    </div>`,
    'deuda': `<div class="info-card"><strong>🔍 CONSULTA DEUDA</strong><br>💸 Para ver sus impuestos.<br>
    🏠<b>INMOBILIARIO</b><br>
    👤<b>CONTRIBUYENTE</b><br>
    ⚰️<b>CEMENTERIO</b><br>
    🔗 <a href="https://pagos.chascomus.gob.ar/#destino=imponible" target="_blank" ${linkEstiloGlobal}>CONSULTAR AQUÍ</a></div>`,
    'hab_gral': `
    <div class="info-card">
        <strong>🏢 Habilitación Comercial / Industrial</strong><br><br>
        <i>Para comercios, industrias y servicios.</i><br><br>
        📋 <b>Requisitos Principales:</b><br>
        • DNI (Mayor de 21 años).<br>
        • Constancia CUIT e IIBB.<br>
        • Título Propiedad/Alquiler (Firmas certificadas).<br>
        • Libre deuda Tasas Municipales.<br>
        • Certificado Urbanístico.<br><br>
        📍 <b>Presencial:</b> Maipú 415 (Producción).<br><br>
        🚀 <a href="https://apps.chascomus.gob.ar/habilitaciones/habilitacionComercial.php" target="_blank" ${linkEstiloGlobal}>INICIAR TRÁMITE ONLINE</a>
    </div>`,
    'hab_eventos': `
    <div class="info-card">
        <strong>🎉 Eventos y Salones de Fiesta</strong><br>
        <i>Regulado por Ord. 5660, 5672 y 5923.</i><br><br>
        ⚠️ <b>Plazos:</b><br>
        Solicitar con <b>10 días hábiles</b> de anticipación.<br><br>
        🚒 <b>Requisito Bomberos:</b><br>
        Se exige certificado final de obra (Bomberos Dolores).<br>
        📧 <a href="mailto:tecnica_dolores@hotmail.com" ${linkEstiloGlobal}>tecnica_dolores@hotmail.com</a><br>
        📞 <a href="tel:02245446107" ${linkEstiloGlobal}>(02245) 44-6107</a><br><br>
        📝 <a href="https://apps.chascomus.gob.ar/habilitaciones/habilitacionEventoPrivado2.0.php" target="_blank" ${linkEstiloGlobal}>IR AL FORMULARIO</a>
    </div>`,
    'hab_espacio': `
    <div class="info-card">
        <strong>🍔 Uso de Espacio Público</strong><br>
        <i>Patios gastronómicos y Foodtrucks.</i><br><br>
        📋 <b>Requisitos:</b><br>
        • DNI y CUIT del titular.<br>
        • Curso manipulación de alimentos (todo el personal).<br>
        • Título del vehículo/carro.<br>
        • Seguros (Vehículo + Responsabilidad Civil).<br>
        • Domicilio en Chascomús.<br><br>
        📝 <a href="https://apps.chascomus.gob.ar/habilitaciones/habilitacionCarro.php" target="_blank" ${linkEstiloGlobal}>INICIAR TRÁMITE ONLINE</a>
    </div>`,
  'hab_reba': `
    <div class="info-card">
        <strong>🍷 Registro de Alcohol (REBA)</strong><br><br>
        Obligatorio para comercializar bebidas alcohólicas.<br><br>
        📲 <b>WhatsApp HABILITACIONES:</b><br>
        <a href="https://wa.me/5492241559389" target="_blank" ${linkEstiloGlobal}>💬 2241-559389</a><br>
        <small><i>⚠️ Solo mensajes escritos o audios. No llamadas.</i></small><br><br>
        📧 <b>Por Email:</b><br>
        Solicitalo a <a href="mailto:habilitaciones@chascomus.gob.ar" ${linkEstiloGlobal}>habilitaciones@chascomus.gob.ar</a><br><br>
        🏦 <b>Pago:</b> Recibirás una boleta para abonar en Banco Provincia.
    </div>`,
    'h_turnos': `
    <div class="info-card">
        <strong>📍 <b>Hospital Municipal:</b> Av. Alfonsín e Yrigoyen.<br>🚨 Guardia 24 hs.</strong><br>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📲 Consultar por turnos (WhatsApp)</a>
    </div>`, 
    'info_pediatria': `
    <div class="info-card">
        <strong>👶 Pediatría</strong><br>
        <i>Atención en Consultorios Externos</i><br><br>
        📅 <b>Días:</b> Lunes, Martes y Jueves.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_clinica': `
    <div class="info-card">
        <strong>🩺 Clínica Médica</strong><br><br>
        📅 <b>Días:</b> Lunes, Miércoles y Viernes.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_gineco': `
    <div class="info-card">
        <strong>🤰 Salud de la Mujer</strong><br><br>
        🔹 <b>Ginecología:</b> Lunes.<br>
        🔹 <b>Obstetricia:</b> Miércoles.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_cardio': `
    <div class="info-card">
        <strong>❤️ Cardiología</strong><br><br>
        📅 <b>Días:</b> Martes.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_trauma': `
    <div class="info-card">
        <strong>🦴 Traumatología</strong><br><br>
        📅 <b>Días:</b> Martes.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_oftalmo': `
    <div class="info-card">
        <strong>👁️ Oftalmología</strong><br><br>
        📅 <b>Días:</b> Miércoles.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_nutri': `
    <div class="info-card">
        <strong>🍎 Nutrición</strong><br><br>
        📅 <b>Días:</b> Jueves.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_cirugia': `
    <div class="info-card">
        <strong>🔪 Cirugía General</strong><br><br>
        📅 <b>Días:</b> Jueves.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'info_neuro_psiq': `
    <div class="info-card">
        <strong>🧠 Salud Mental y Neurología</strong><br><br>
        🔹 <b>Neurología:</b> Viernes.<br>
        🔹 <b>Psiquiatría:</b> Viernes.<br><br>
        👇 <i>Sacá turno por WhatsApp:</i>
        <a href="https://wa.me/5492241466977" target="_blank" ${linkEstiloGlobal}>📅 SOLICITAR TURNO</a>
    </div>`,
    'res_compre_chascomus': `
    <div class="info-card">
        <strong>🤝 Compre Chascomús - Producción Local</strong><br><br>
        Vinculamos a la economía social con comerciantes locales (Micro, Pequeños y Grandes) con habilitación.<br><br>
        📋 <b>Requisitos para inscripción:</b><br>
        Tener foto de: AFIP, ARBA, Habilitación Municipal y DNI.<br><br>
        👇 <i>Completá el formulario y la Dirección de Producción te contactará:</i><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSfa4LPccR6dYwkQFWhG31HELnaKMCSgUF7Jqy1xfiSNR_fA_g/viewform" target="_blank" ${linkEstiloGlobal}>📝 FORMULARIO DE INSCRIPCIÓN</a>
    </div>`,
    'res_prod_frescos': `
    <div class="info-card">
        <strong>🥦 Orientación Productores Alimentos Frescos</strong><br><br>
        Para productores de alimentos agroecológicos, agricultura familiar, cooperativas y PyMEs de Chascomús.<br><br>
        <i>Acompañamos el desarrollo de tu unidad económica.</i><br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSeMzImHt14uXF4ZSk3wiJEqfxK4U2Tw9bSJrJXaKGLv5kLGew/closedform" target="_blank" ${linkEstiloGlobal}>📝 FORMULARIO PRODUCTORES</a>
    </div>`,
    'res_oe_inscripcion': `
    <div class="info-card">
        <strong>📝 Inscripción / Actualización Laboral</strong><br><br>
        Para mayores de 18 años residentes en Chascomús en búsqueda activa.<br><br>
        1. Completá el formulario con tus datos y perfil.<br>
        2. Te contactaremos (Lun a Vie 8 a 14hs) para una entrevista y asesoramiento.<br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSfl7uzaIU0u8G-S3uTjtddZl7y4o5jajZUzNuftZEyfqPdDKg/viewform" target="_blank" ${linkEstiloGlobal}>📝 CARGAR MI CV / DATOS</a>
    </div>`,
    'res_oe_promover': `
    <div class="info-card">
        <strong>♿ Programa Nacional Promover</strong><br><br>
        Para mayores de 18 años desempleados que posean <b>Certificado Único de Discapacidad (CUD)</b>.<br><br>
        Ofrece formación, capacitación y acompañamiento en el perfil laboral.<br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSdGoPi4Xmg0zD2VtBzTr1sFol1QtLAM5G0oDA6vExM_cvIYbQ/viewform" target="_blank" ${linkEstiloGlobal}>📝 INSCRIPCIÓN PROMOVER</a>
    </div>`,
    'res_oe_taller_cv': `
    <div class="info-card">
        <strong>📄 Armado de CV y Búsqueda de Empleo</strong><br><br>
        ¿No sabés por dónde empezar a buscar trabajo? ¿Querés mejorar tu Currículum?<br><br>
        Te ofrecemos información y strategies para tener la mejor herramienta de presentación.<br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSdQkEPZZx7gXZXO9vAb7u3Klxj8g5cwSe1fXqz6Zmo4jjMNBg/viewform" target="_blank" ${linkEstiloGlobal}>📝 INSCRIBIRSE AL TALLER</a>
    </div>`,
    'res_emp_chasco': `
    <div class="info-card">
        <strong>🚀 Programa Chascomús Emprende</strong><br><br>
        Objetivo: Fortalecer y acompañar unidades productivas.<br><br>
        Al completar el formulario, ingresás al listado para coordinar una entrevista de diagnóstico y orientación.<br><br>
        <a href="https://uploads.chascomus.gob.ar/produccion/PROGRAMA%20CHASCOMUS%20EMPRENDE.pdf" target="_blank" ${linkEstiloGlobal}>📝 INSCRIPCIÓN EMPRENDEDORES</a>
    </div>`,
    'res_empl_busqueda': `
    <div class="info-card">
        <strong>🔎 Búsqueda de Personal</strong><br><br>
        Si sos empleador, completá el formulario describiendo el puesto.<br><br>
        ✅ La Dirección de Producción realizará una preselección y te presentará una <b>terna final de candidatos</b>.<br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSdOeVRsshYtc8JF-sTXyEqQgJl2hyTbxyfDPb0G7SsiGBMj_g/viewform" target="_blank" ${linkEstiloGlobal}>📝 PUBLICAR PUESTO</a>
    </div>`,
    'res_empl_madrinas': `
    <div class="info-card">
        <strong>🤝 Programa Formando Red - Empresas Madrinas</strong><br><br>
        Vinculamos empresas con compromiso social que deseen capacitar a futuros trabajadores, favoreciendo la igualdad de oportunidades.<br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSe7SA_eKKQw-EDuFU9pDBIE_nUjzLOX6AZrHI_KfO3bwufVSA/viewform" target="_blank" ${linkEstiloGlobal}>📝 QUIERO SER EMPRESA MADRINA</a>
    </div>`,
    'res_manipulacion': `
    <div class="info-card">
        <strong>🔴 Carnet de Manipulación de Alimentos</strong><br><br>
        Obligatorio (Código Alimentario Argentino) para quien elabore, transporte o comercialice alimentos.<br><br>
        ✅ <b>Validez:</b> 3 años (Nacional).<br>
        🎓 <b>Requisito:</b> Aprobar el Curso de Manipulación Segura.<br><br>
        <i>Modalidad presencial (y próximamente virtual).</i><br><br>
        <a href="https://docs.google.com/forms/d/e/1FAIpQLSctX7eGQxBNei5howcIjXhIzlBTKQQb_RIBImnKXjVPvIVrvw/closedform" target="_blank" ${linkEstiloGlobal}>📝 INSCRIPCIÓN AL CURSO</a>
    </div>`,
     'prod_contacto': `
    <div class="info-card">
        <strong>📍 Dirección de Producción</strong><br><br>
        📍 <b>Dirección:</b> Maipú 415, Chascomús.<br>
        📞 <b>Teléfonos:</b> <a href="tel:02241436365" ${linkEstiloGlobal}>43-6365</a> / <a href="tel:02241430841" ${linkEstiloGlobal}>43-0841</a><br>
        📧 <a href="mailto:produccion@chascomus.gob.ar" ${linkEstiloGlobal}>produccion@chascomus.gob.ar</a><br><br>
        ℹ️ <b>Atención:</b><br>
        Orientación a productores de alimentos frescos, PYMES y cooperativas, impulsando la economía social y la agricultura familiar.
    </div>`,
        'contacto_gral': `<div class="info-card">
    <strong>🏛️ Contacto Municipalidad</strong><br>
    <i>Canales de atención directa:</i><br><br>
    📞 <b>Teléfono Fijo (Conmutador):</b><br>
    Atención de 7:30 a 13:30 hs.<br>
    <a href="tel:02241431341" ${linkEstiloGlobal} style="display:block;">📞 LLAMAR AL 43-1341</a><br>
    
 📧 <b>E-Mail:</b><br>
Consultas generales.<br>
<a href="mailto:mesadeentradas@chascomus.gob.ar" target="_blank" ${linkEstiloGlobal} style="display:block;">💬 ENVIAR CONSULTA</a><br>
    📍 <b>Mesa de Entradas:</b><br>
    Cr. Cramer 270.</div>`
};

/* --- CONEXIÓN CON GOOGLE SHEETS (LOGS) --- */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4OwdnxlW5ux5CDKvrsoFjy9yDiTT1o1KQ0QOtghtBFjPX1dTTcpL20hV2dsPjJU0p/exec';

function registrarEnPlanilla(detalle) {
    if (!SCRIPT_URL || SCRIPT_URL.includes('TU_ID_DEL_SCRIPT_AQUI')) return;

    const payload = {
        fecha: new Date().toLocaleString('es-AR'), 
        usuario: userName || "Anónimo",
        barrio: userNeighborhood || "No especificado",
        edad: userAge || "No especificada",
        detalle: detalle 
    };

    fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(error => {
        console.error("❌ Error de red al intentar guardar en Sheets:", error);
    });
}

/* --- 3. LÓGICA DEL CHAT Y FUNCIONES ÚTILES --- */
function normalizar(str) { return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); } 

function validarTexto(texto) {
    const t = normalizar(texto);
    for (let i = 0; i < PALABRAS_OFENSIVAS.length; i++) {
        const regexOfensiva = new RegExp(`\\b${PALABRAS_OFENSIVAS[i]}\\b`, 'i');
        if (regexOfensiva.test(t)) {
            const respuestasModeracion = [
                "Bajemos un cambio, dale 😇 Te leo mejor si lo escribís de otra forma.",
                "Prefiero que sigamos con buena onda. ¿Me contás de nuevo qué necesitás?",
                "Por favor, mantengamos el respeto en el chat. 😇"
            ];
            return { v: false, m: respuestasModeracion[Math.floor(Math.random() * respuestasModeracion.length)] };
        }
    }
    return { v: true, m: "" };
}

/* --- CHARLA CASUAL: RESPUESTAS HUMANAS PARA MENSAJES QUE NO SON UN TRÁMITE --- */
function saludoSegunHora() {
    const h = new Date().getHours();
    if (h >= 6 && h < 13) return "¡Buen día";
    if (h >= 13 && h < 20) return "¡Buenas tardes";
    return "¡Buenas noches";
}

const CHARLA_CASUAL = [
    {
        tipo: 'saludo',
        patrones: [/^(hola+|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|que tal|ey|hey)\b/],
        respuestas: (nombre) => [
            `${saludoSegunHora()}${nombre ? ', ' + nombre : ''}! 👋 ¿En qué te puedo ayudar hoy?`,
            `¡Hola${nombre ? ' ' + nombre : ''}! Acá ando, listo para ayudarte. ¿Qué necesitás?`,
            `${saludoSegunHora()}${nombre ? ', ' + nombre : ''}! Decime qué buscás y vemos cómo te doy una mano.`
        ]
    },
    {
        tipo: 'como_estas',
        patrones: [/como estas/, /como andas/, /como te va/, /todo bien\??$/],
        respuestas: (nombre) => [
            `¡Todo bien por acá, gracias por preguntar! 😊 ¿Y vos${nombre ? ', ' + nombre : ''}? Contame en qué te ayudo.`,
            `De diez, ¡dale para adelante! ¿En qué te puedo dar una mano hoy?`
        ]
    },
    {
        tipo: 'agradecimiento',
        patrones: [/\bgracias\b/, /\bse agradece\b/, /\bmuy amable\b/],
        respuestas: (nombre) => [
            `¡De nada${nombre ? ', ' + nombre : ''}! Para eso estoy. 🙌`,
            `¡Un placer ayudarte! Si necesitás otra cosa, acá estoy.`,
            `¡Dale, no hay drama! Cualquier otra consulta, escribime nomás.`
        ]
    },
    {
        tipo: 'despedida',
        patrones: [/^(chau|adios|nos vemos|hasta luego|bye|me voy)\b/],
        respuestas: (nombre) => [
            `¡Chau${nombre ? ', ' + nombre : ''}! Que tengas un gran día. Volvé cuando quieras 👋`,
            `¡Nos vemos! Acá voy a estar si me necesitás de nuevo.`
        ]
    },
    {
        tipo: 'cumplido',
        patrones: [/sos groso/, /sos util/, /me ayudaste/, /buenisimo/, /excelente bot/, /sos un capo/, /sos genial/, /muy bueno el bot/],
        respuestas: (nombre) => [
            `¡Qué lindo lo que decís! 🥹 Hago lo que puedo para ayudarte mejor.`,
            `¡Gracias! Eso me pone muy contento. Seguimos ayudando en lo que necesites.`
        ]
    },
    {
        tipo: 'frustracion',
        patrones: [/no entendes/, /no entendiste/, /no sirve/, /no funciona/, /esto es un desastre/, /que bodrio/, /no me ayuda/, /no me sirvio/],
        respuestas: (nombre) => [
            `Perdón si no di en la tecla todavía${nombre ? ', ' + nombre : ''}. Contame con otras palabras qué necesitás, o tocá "Ver Menú Completo" y lo buscamos juntos.`,
            `Entiendo, a veces no doy con la respuesta justa. Probemos de nuevo: ¿qué trámite o información estás buscando?`
        ]
    },
    {
        tipo: 'chiste',
        patrones: [/contame un chiste/, /hace reir/, /decime un chiste/, /sabes algun chiste/],
        respuestas: () => [
            `¿Por qué la laguna de Chascomús nunca se aburre? ¡Porque siempre tiene buena onda fluyendo! 🌊😄 ¿Seguimos con algún trámite?`,
            `Che, de comediante tengo poco, pero te tiro una: ¿sabés cuál es el trámite más rápido de la Muni? El que ya hiciste 😅. ¿En qué te ayudo?`
        ]
    }
];

function detectarCharlaCasual(texto) {
    const t = normalizar(texto);
    // Si el mensaje es largo, probablemente sea una consulta real (no charla casual) -> lo dejamos pasar a la IA/buscador.
    if (t.split(' ').filter(Boolean).length > 6) return null;
    for (const grupo of CHARLA_CASUAL) {
        for (const patron of grupo.patrones) {
            if (patron.test(t)) {
                const opciones = grupo.respuestas(userName);
                return opciones[Math.floor(Math.random() * opciones.length)];
            }
        }
    }
    return null;
}

/* --- URGENCIAS: DETECCIÓN INSTANTÁNEA Y LOCAL (no espera a la IA/n8n) ---
   Si alguien escribe algo que suena a un pedido de ayuda urgente (violencia
   de género, ser víctima de un delito/agresión), mostramos la tarjeta de
   contacto inmediato directo, sin depender de que el webhook de n8n esté
   arriba o entienda el mensaje. Mejor pecar de sensible que de no responder. */
const URGENCIAS = [
    {
        tipo: 'violencia_genero',
        patrones: [
            /violencia de genero/, /violencia familiar/, /violencia domestica/, /\bviolencia\b/,
            /me pega/, /me pegan/, /me esta(n)? pegando/, /me golpea/, /me golpean/,
            /\bmaltrato\b/, /me maltratan/, /me abusan/, /abuso sexual/,
            /me agrede/, /me agreden/, /agresion sexual/, /me amenaza/, /me quiere matar/,
            /tengo miedo de mi (pareja|marido|esposo|novio)/
        ],
        apiKeys: ['politicas_gen'],
        intro: (nombre) => `💜 ${nombre ? nombre + ', ' : ''}quiero que sepas que no estás sola/o. Te paso ya mismo el contacto de ayuda:`
    },
    {
        tipo: 'victima_delito',
        patrones: [
            /me robaron/, /me asaltaron/, /me quisieron robar/, /\bme atacaron\b/,
            /sufri un robo/, /soy victima de un delito/, /fui victima de/
        ],
        apiKeys: ['ojos_en_alerta', 'pamuv'],
        intro: (nombre) => `🆘 ${nombre ? nombre + ', ' : ''}lamento que te haya pasado. Te dejo dos contactos: uno para reportarlo ahora mismo y otro para que te acompañen:`
    }
];

function detectarUrgencia(texto) {
    const t = normalizar(texto);
    for (const grupo of URGENCIAS) {
        for (const patron of grupo.patrones) {
            if (patron.test(t)) return grupo;
        }
    }
    return null;
}

function showTyping() {
    isBotThinking = true;

    const container = document.getElementById('chatMessages');
    const wrapper = document.createElement('div'); 
    wrapper.className = 'message-wrapper'; 
    wrapper.id = 'typingWrapper';
    
    wrapper.innerHTML = `
        <img src="${IMG_BOT_NORMAL}" class="avatar-chat" alt="Bot Pensando">
        <div class="message bot"><span class="typing-dots">Escribiendo</span></div>
    `;
    
    container.appendChild(wrapper); 
    container.scrollTop = container.scrollHeight; 
}

function addMessage(content, side = 'bot', options = null) {
    if(side === 'bot') { 
        isBotThinking = false; 
        const t = document.getElementById('typingWrapper'); 
        if(t) t.remove(); 
    } 

    const container = document.getElementById('chatMessages');
    const wrapper = document.createElement('div'); wrapper.className = `message-wrapper ${side}`;
    
    let html = (side === 'bot') ? `<img src="${IMG_BOT_NORMAL}" class="avatar-chat" alt="Bot">` : ''; 
    html += `<div class="message ${side}">${content}</div>`;
    wrapper.innerHTML = html; container.appendChild(wrapper);

    if (side === 'bot') { 
        hablar(content); 
    }

    if (options) {
        const optDiv = document.createElement('div'); optDiv.className = 'options-container'; 
        options.forEach(o => {
            const btn = document.createElement('button'); btn.className = `option-button ${o.id==='back'?'back':''}`;
            btn.innerText = o.label; btn.onclick = () => handleAction(o);
            optDiv.appendChild(btn);
        });
        container.appendChild(optDiv);
    }
    container.scrollTop = container.scrollHeight;
}

function showNavControls() {
    const container = document.getElementById('chatMessages');
    const navDiv = document.createElement('div'); navDiv.className = 'options-container'; 
    navDiv.innerHTML = `<button class="option-button back" onclick="interaccionIniciada=true; showMenu(currentPath[currentPath.length-1])">⬅️ Volver</button><button class="option-button" onclick="interaccionIniciada=true; resetToMain()">🏠 Inicio</button>`;
    container.appendChild(navDiv); container.scrollTop = container.scrollHeight;
}

function handleAction(opt) {
    interaccionIniciada = true;

    if(opt.id === 'back') { 
        if(currentPath.length > 1) currentPath.pop(); 
        showMenu(currentPath[currentPath.length-1]); 
        return; 
    } 
    
    if(opt.type === 'age_select') { 
        userAge = opt.label; 
        localStorage.setItem('chas_user_age', userAge); 
        resetToMain(); 
        return; 
    } 
    
    if(opt.type === 'barrio_select') { 
        selectBarrio(opt.label); 
        return; 
    }

    // --- FLUJO NORMAL DE BOTONES ---
    addMessage(opt.label, 'user');
    
    if(opt.apiKey) {
        showTyping();
        setTimeout(() => { addMessage(RES[opt.apiKey]); showNavControls(); }, 800);
        registrarEnPlanilla(opt.label);
    } else if(opt.link) {
        showTyping();
        setTimeout(() => {
            addMessage(`Te dejo el acceso directo acá: <br><br><a href="${opt.link}" target="_blank" ${linkEstiloGlobal}>${opt.label}</a>`, 'bot');
            showNavControls();
            registrarEnPlanilla(opt.label);
        }, 800);
    } else if(MENUS[opt.id]) {
        currentPath.push(opt.id); showMenu(opt.id);
    }
}

function showMenu(key) {
    const m = MENUS[key];
    
    if (m.type === 'card') {
        const cardHtml = `
            <div class="info-card card-visual">
                <img src="${m.image}" style="width:100%; border-radius:10px; margin-bottom:10px;">
                <strong>${typeof m.title === 'function' ? m.title() : m.title}</strong><br>
                <small style="color:var(--text-muted)">${m.subtitle}</small><br><br>
                <p>${m.description}</p>
                <hr style="border-top: 1px dashed #ccc; margin: 10px 0;">
                <small><i>${m.footer}</i></small>
            </div>
        `;
        let opts = [...(m.options || [])]; 
        if(currentPath.length > 1) opts.push({ id: 'back', label: '⬅️ Volver' }); 
        addMessage(cardHtml, 'bot', opts);
        return;
    }

    let opts = typeof m.options === 'function' ? m.options() : m.options;
    let finalOpts = [...opts];
    if(currentPath.length > 1 && key !== 'main') finalOpts.push({ id: 'back', label: '⬅️ Volver' }); 
    addMessage(typeof m.title === 'function' ? m.title(userName) : m.title, 'bot', finalOpts);
}

function resetToMain() { currentPath = ['main']; showMenu('main'); } 

/* --- 4. BUSCADOR INTELIGENTE IA (N8N) + BACKUP LOCAL --- */
const FRASES = ["¡Bip bop! 🤖 Encontré esto:", "¡Acá tengo la info! ✨", "¡Búsqueda exitosa! 🐾", "¡Ya sé lo que buscás! 💡", "¡Eso era lo que buscabas! 🎯", "¡Mirá lo que encontré para vos! 🔎", "¡Listo, acá te dejo esto! 👇"];

function buscarOpcionProfunda(texto) {
    let t = normalizar(texto);
    
    // 1. Búsqueda por palabra clave fuerte
    for (let clave in PALABRAS_CLAVE) {
        if (t.includes(clave)) return PALABRAS_CLAVE[clave];
    }

    // 2. Filtramos palabras genéricas que rompen la búsqueda
    const palabrasIgnoradas = ["quiero", "para", "como", "sacar", "pido", "turno", "turnos", "hacer", "necesito"];
    const palabrasBuscadas = t.split(' ').filter(p => p.length > 3 && !palabrasIgnoradas.includes(p));
    
    for (let menuId in MENUS) {
        const opciones = typeof MENUS[menuId].options === 'function' ? MENUS[menuId].options() : MENUS[menuId].options;
        for (let i = 0; i < opciones.length; i++) {
            const opt = opciones[i];
            if (opt.id === 'back' || opt.id === 'full_menu') continue;
            const labelNorm = normalizar(opt.label);
            
            if (labelNorm.includes(t)) return opt; 
            for(let p of palabrasBuscadas) {
                if(labelNorm.includes(p)) return opt;
            }
        }
    }
    return null;
}

// Búsqueda con N8N IA y respaldo local si N8N falla
async function ejecutarBusquedaInteligente(texto) {
    showTyping();
    try {
        const response = await fetch(WEBHOOK_N8N, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_accion: "chat",
                mensaje: texto,
                usuario: userName,
                barrio: userNeighborhood,
                edad: userAge
            })
        });
        const data = await response.json();
        renderRespuestaIA(data, texto);
    } catch (error) {
        console.warn("⚠️ N8N no respondió, usando buscador local:", error);
        fallbackBusqueda(texto); // Respaldo local
    }
}

// Interpreta y dibuja lo que devuelve el webhook de n8n.
// Formato real del prompt: { output: "texto", cards: [{title, body, buttons:[{label,link,type}]}], options: [{id,label,link?}] }
// Se mantiene compatibilidad con un formato viejo más simple ({accion, texto/id}) por las dudas.
function renderRespuestaIA(data, textoOriginal) {
    if (!data || typeof data !== 'object') {
        fallbackBusqueda(textoOriginal);
        return;
    }

    // --- Formato viejo (compatibilidad) ---
    if (data.accion) {
        if (data.accion === 'texto') {
            addMessage(data.texto, "bot", [{ id: 'main', label: '🏠 Ver Menú' }]);
        } else if (data.accion === 'tarjeta' && RES[data.id]) {
            addMessage(RES[data.id], "bot", [{ id: 'main', label: '🏠 Inicio' }]);
        } else if (data.accion === 'menu') {
            handleAction({ id: data.id, label: 'Buscando...' });
        } else {
            fallbackBusqueda(textoOriginal);
        }
        return;
    }

    // --- Formato actual: { output, cards, options } ---
    const hayOutput = typeof data.output === 'string' && data.output.trim() !== '';
    const hayCards  = Array.isArray(data.cards) && data.cards.length > 0;

    if (!hayOutput && !hayCards) {
        fallbackBusqueda(textoOriginal);
        return;
    }

    if (hayOutput) {
        addMessage(data.output.replace(/\n/g, '<br>'), 'bot');
    }

    if (hayCards) {
        data.cards.forEach(card => addMessage(renderizarTarjetaIA(card), 'bot'));
    }

    if (Array.isArray(data.options) && data.options.length > 0) {
        mostrarOpcionesIA(data.options);
    } else {
        showNavControls();
    }

    registrarEnPlanilla(textoOriginal);
}

// Arma el HTML de una tarjeta { title, body, buttons:[{label,link,type}] } con el mismo
// estilo visual (.info-card / botones verdes) que el resto de las tarjetas estáticas del bot.
function renderizarTarjetaIA(card) {
    if (!card) return '';
    const titulo  = card.title ? `<strong>${card.title}</strong><br><br>` : '';
    const cuerpo  = card.body ? `${card.body.replace(/\n/g, '<br>')}<br><br>` : '';
    const botones = (Array.isArray(card.buttons) ? card.buttons : [])
        .filter(b => b && b.label && b.link)
        .map(b => `<a href="${b.link}" target="_blank" ${linkEstiloGlobal} style="display:inline-block; margin:3px 6px 3px 0;">${b.label}</a>`)
        .join('');
    return `<div class="info-card">${titulo}${cuerpo}${botones}</div>`;
}

// Botones de "options" que devuelve la IA: con link abren/derivan al instante,
// sin link mandan el label como una nueva consulta a la IA, y "main" vuelve al menú local.
function mostrarOpcionesIA(opciones) {
    const container = document.getElementById('chatMessages');
    const optDiv = document.createElement('div');
    optDiv.className = 'options-container';
    opciones.forEach(o => {
        if (!o || !o.label) return;
        const btn = document.createElement('button');
        btn.className = `option-button ${o.id === 'main' ? 'back' : ''}`;
        btn.innerText = o.label;
        btn.onclick = () => {
            interaccionIniciada = true;
            addMessage(o.label, 'user');
            if (o.id === 'main') {
                resetToMain();
                return;
            }
            if (o.link) {
                addMessage(`Te dejo el acceso directo acá: <br><br><a href="${o.link}" target="_blank" ${linkEstiloGlobal}>${o.label}</a>`, 'bot');
                showNavControls();
                registrarEnPlanilla(o.label);
                return;
            }
            registrarEnPlanilla(o.label);
            ejecutarBusquedaInteligente(o.label);
        };
        optDiv.appendChild(btn);
    });
    container.appendChild(optDiv);
    container.scrollTop = container.scrollHeight;
}

function fallbackBusqueda(texto) {
    const opcionEncontrada = buscarOpcionProfunda(texto);
    if (opcionEncontrada) {
        addMessage(FRASES[Math.floor(Math.random() * FRASES.length)], 'bot');
        setTimeout(() => {
            if (opcionEncontrada.apiKey) {
                showTyping();
                setTimeout(() => { addMessage(RES[opcionEncontrada.apiKey]); showNavControls(); }, 600);
            } else if (opcionEncontrada.link) {
                showTyping();
                setTimeout(() => {
                    addMessage(`Te dejo el acceso directo acá: <br><br><a href="${opcionEncontrada.link}" target="_blank" ${linkEstiloGlobal}>${opcionEncontrada.label}</a>`, 'bot');
                    showNavControls();
                }, 600);
            } else if (MENUS[opcionEncontrada.id]) {
                currentPath.push(opcionEncontrada.id);
                showMenu(opcionEncontrada.id);
            }
        }, 500);
    } else {
        setChasBotState();
        addMessage(RES['error_busqueda'], "bot");
    }
}

/* --- 5. REGISTRO (FLUJO LINEAL ESTRICTO) --- */
function selectBarrio(b) {
    userNeighborhood = b; 
    localStorage.setItem('chas_user_neighborhood', b); 
    
    setTimeout(() => {
        const edades = [{label:'-20', type:'age_select'}, {label:'20-40', type:'age_select'}, {label:'40-60', type:'age_select'}, {label:'+60', type:'age_select'}];
        addMessage(`¡Excelente barrio <b>${userName}</b>! Por último, decime tu edad para ayudarte mejor:`, 'bot', edades);
    }, 800);
}

function procesarEdadTexto(val) {
    let numeros = val.match(/\d+/);
    let edadNum = null;

    if (numeros) {
        edadNum = parseInt(numeros[0]);
    } else {
        const txt = normalizar(val);
        const numMap = { 'uno':1, 'dos':2, 'tres':3, 'cuatro':4, 'cinco':5, 'seis':6, 'siete':7, 'ocho':8, 'nueve':9, 'diez':10, 'once':11, 'doce':12, 'trece':13, 'catorce':14, 'quince':15, 'dieciseis':16, 'diecisiete':17, 'dieciocho':18, 'diecinueve':19, 'veinte':20 };
        for (let key in numMap) {
            if (txt.includes(key) || txt === key) {
                edadNum = numMap[key];
                break;
            }
        }
    }

    if (edadNum !== null) {
        if (edadNum < 20) userAge = '-20';
        else if (edadNum <= 40) userAge = '20-40';
        else if (edadNum <= 60) userAge = '40-60';
        else userAge = '+60';

        localStorage.setItem('chas_user_age', userAge); 
        
        showTyping();
        setTimeout(() => {
            resetToMain();
        }, 800);
    } else {
        addMessage(`Mmm, mi oído falló ahí. 🤔 Escribí tu edad con números (ej: 35) o elegí un botón:`, 'bot', [
            {label:'-20', type:'age_select'}, 
            {label:'20-40', type:'age_select'}, 
            {label:'40-60', type:'age_select'}, 
            {label:'+60', type:'age_select'}
        ]);
    }
}

// --- BUCLE PRINCIPAL DE INPUT ---
function processInput() {
    const input = document.getElementById('userInput'); const val = input.value.trim();
    if(!val || isBotThinking) return; 

    interaccionIniciada = true;

    const validacion = validarTexto(val); 
    if(!validacion.v) { addMessage(val, 'user'); input.value = ""; showTyping(); setTimeout(() => addMessage(validacion.m, 'bot'), 600); return; } 

    addMessage(val, 'user');
    input.value = "";

    // 1. Onboarding
    if (!userName) {
        userName = val;
        localStorage.setItem('chas_user_name', userName);
        showTyping();
        setTimeout(() => addMessage(`¡Un gusto, <b>${userName}</b>! 😊 Contame, ¿de qué barrio sos?`, 'bot'), 800);
        return; 
    }
    if (!userNeighborhood) {
        const exacto = BARRIOS.find(x => normalizar(x) === normalizar(val));
        const similares = BARRIOS.filter(x => normalizar(x).includes(normalizar(val))); 
        
        if(exacto) {
            selectBarrio(exacto);
        } else if(similares.length > 0 && normalizar(val).length > 2) {
            addMessage("No lo encontré exacto. ¿Es alguno de estos?, tocá el botón correspondiente:", "bot", similares.map(s => ({label: s, type: 'barrio_select'})));
        } else {
            addMessage(`Mmm, ese barrio no lo tengo identificado 🤔 ¿Me lo escribís de nuevo? (por ejemplo "Centro" o "San Cayetano")`, 'bot');
        }
        return; 
    }
    if (!userAge) {
        procesarEdadTexto(val);
        return;
    }

    // 2. Urgencias (violencia de género, víctima de delito): tarjeta de ayuda YA, sin esperar a la IA
    const urgencia = detectarUrgencia(val);
    if (urgencia) {
        showTyping();
        setTimeout(() => {
            addMessage(urgencia.intro(userName), 'bot');
            urgencia.apiKeys.forEach(k => addMessage(RES[k]));
            showNavControls();
        }, 500);
        registrarEnPlanilla(`[URGENCIA] ${val}`);
        return;
    }

    // 3. Charla casual (respuesta humana e instantánea, sin esperar a la IA)
    const respuestaCasual = detectarCharlaCasual(val);
    if (respuestaCasual) {
        showTyping();
        setTimeout(() => { addMessage(respuestaCasual, 'bot'); showNavControls(); }, 600);
        return;
    }

    // 4. IA
    registrarEnPlanilla(val);
    ejecutarBusquedaInteligente(val);
}

/* --- GESTOR DE AGENDA DINÁMICA (GOOGLE SHEETS) --- */
async function cargarAgendaDinamica() {
    const BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTl9D6xP_nenB_S-xlnMgAd9rBjY17-fGNiGrVnKgOvlQ3I23giB2VgCnN62JYRB6qX_cVEfpdx6g6k/pub?output=csv'; 
    const SHEET_URL = `${BASE_URL}&t=${Date.now()}`;

    RES['agenda_dinamica'] = `<div class="info-card">⚠️ <b>Cargando agenda...</b><br>Si esto no cambia en unos segundos, revisá tu conexión.</div>`;

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error("Error de conexión");
        const data = await response.text();
        const filas = data.split('\n').slice(1); 
        if (filas.length < 1 || !data.includes(',')) throw new Error("Archivo vacío o formato incorrecto");

        let htmlAgenda = '<div class="info-card"><strong>📅 AGENDA ACTUALIZADA</strong><br><i>En tiempo real</i><br><br>';
        filas.forEach(fila => {
            const cols = fila.split(','); 
            if (cols.length >= 5) { 
                const fecha = cols[0] ? cols[0].trim() : '';
                const titulo = cols[1] ? cols[1].trim() : '';
                const lugar = cols[2] ? cols[2].trim() : '';
                const hora = cols[3] ? cols[3].trim() : '';
                const precio = cols[4] ? cols[4].trim() : '';
                const estado = cols[5] ? cols[5].trim() : 'Confirmado';

           if (titulo) {
                    let iconoEstado = '🟢'; // <-- CAMBIO ACÁ: Círculo verde por defecto (Confirmado)
                    if (estado.toLowerCase().includes('cancelado')) iconoEstado = '🔴';
                    if (estado.toLowerCase().includes('reprogramado')) iconoEstado = '🟠';

                    htmlAgenda += `
                        ${iconoEstado} <b>${fecha} - ${titulo}</b><br>
                        📍 ${lugar} | ⏰ ${hora} | 🎟️ ${precio}<br>
                        <hr style="border-top: 1px dashed #eee; margin: 8px 0;">
                    `;
                }
            }
        });
        htmlAgenda += `<br><small><i>⚠️ Información sujeta a cambios.</i></small></div>`;
        RES['agenda_dinamica'] = htmlAgenda;
        return true; 
    } catch (error) {
        console.warn('⚠️ No se pudo cargar Google Sheets, usando Agenda Estática de respaldo.', error);
        if (RES['agenda_actual']) {
            RES['agenda_dinamica'] = RES['agenda_actual'];
        } else {
            RES['agenda_dinamica'] = `<div class="info-card">❌ <b>Info no disponible</b><br>Intentá más tarde.</div>`;
        }
        return false;
    }
}

/* --- GESTOR DE ALERTAS METEOROLÓGICAS (GOOGLE SHEETS) --- */
async function cargarAlertaClima() {
    const BASE_ALERTA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTl9D6xP_nenB_S-xlnMgAd9rBjY17-fGNiGrVnKgOvlQ3I23giB2VgCnN62JYRB6qX_cVEfpdx6g6k/pub?gid=468896868&single=true&output=csv'; 
    const ALERTA_URL = `${BASE_ALERTA_URL}&t=${Date.now()}&rnd=${Math.random()}`;

    try {
        const response = await fetch(ALERTA_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
        if (!response.ok) throw new Error("Error de conexión con Alertas");
        const data = await response.text();
        const filas = data.split('\n'); 
        if (filas.length > 1 && data.includes(',')) {
            const cols = filas[1].split(','); 
            const estado = cols[0] ? cols[0].trim().toUpperCase() : 'INACTIVA';
            const nivel = cols[1] ? cols[1].trim().toLowerCase() : 'amarilla';
            let mensaje = cols.slice(2).join(',').trim();
            if (mensaje.startsWith('"') && mensaje.endsWith('"')) mensaje = mensaje.slice(1, -1);
            if (mensaje.endsWith('"\r')) mensaje = mensaje.slice(0, -2);
            if (estado === 'ACTIVA' && mensaje !== '') mostrarAlerta(mensaje, nivel);
            else cerrarAlerta(); 
        }
    } catch (error) {
        console.warn('⚠️ No se pudo cargar el estado de la alerta meteorológica.', error);
    }
}

// INICIALIZACIÓN
document.addEventListener('DOMContentLoaded', async () => {
    await cargarAgendaDinamica();
    await cargarAlertaClima();

    if (!userName) {
        showTyping();
        setTimeout(() => {
            setChasBotState();
            addMessage(`${saludoSegunHora()}! 👋 Soy MuniBot, el asistente virtual de la Municipalidad de Chascomús. ¿Cómo te llamás?`, "bot");
        }, 500);
    } else {
        setChasBotState();
        showTyping();
        setTimeout(() => {
            setChasBotState();
            addMessage(`${saludoSegunHora()}, <b>${userName}</b>! 👋 Qué bueno verte de nuevo. ¿En qué te ayudo hoy?`, 'bot');
            setTimeout(() => {
                resetToMain();
                setChasBotState();
            }, 1000);
        }, 1000);
    }

    const sendBtn = document.getElementById('sendButton');
    if (sendBtn) sendBtn.onclick = processInput; 
    
    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.onkeypress = (e) => { if(e.key === 'Enter') processInput(); };
    }
});

function clearSession() { 
    if(confirm("¿Reiniciar chat y borrar datos?")) { 
        localStorage.clear(); 
        location.reload(); 
    } 
}

function abrirTarjeta() {
    document.getElementById('menu-principal').style.display = 'none';
    document.getElementById('vista-tarjeta').style.display = 'block';
    history.pushState({ vista: 'tarjeta' }, "Tarjeta", "#tarjeta");
}

function cerrarTarjeta() {
    document.getElementById('vista-tarjeta').style.display = 'none';
    document.getElementById('menu-principal').style.display = 'block';
}

window.onpopstate = function(event) {
    cerrarTarjeta();
};

let eventoInstalacion;
const botonInstalar = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacion = e;
    if (botonInstalar) {
        botonInstalar.classList.remove('hidden');
    }
});

if (botonInstalar) {
    botonInstalar.addEventListener('click', async () => {
        if (!eventoInstalacion) return;
        eventoInstalacion.prompt();
        const { outcome } = await eventoInstalacion.userChoice;
        if (outcome === 'accepted') {
            botonInstalar.classList.add('hidden');
        }
        eventoInstalacion = null;
    });
}

/* --- CONTROL DE ALERTAS METEOROLÓGICAS --- */
function mostrarAlerta(mensaje, nivel = 'naranja') {
    const banner = document.getElementById('weather-banner');
    const texto = document.getElementById('weather-text');
    if(texto) texto.innerHTML = mensaje;
    if(banner) {
        banner.className = `weather-banner ${nivel}`; 
        banner.classList.remove('hidden');
    }
}

function cerrarAlerta() {
    const banner = document.getElementById('weather-banner');
    if(banner) banner.classList.add('hidden');
}
