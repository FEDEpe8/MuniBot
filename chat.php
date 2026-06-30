<?php

error_reporting(0);
ini_set('display_errors', 0);

// --- Red de seguridad: convierte cualquier error fatal en una respuesta JSON
//     (con ?debug=1 muestra el detalle; siempre lo guarda en chat_error.log) ---
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/chat_error.log');
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        while (ob_get_level() > 0) { ob_end_clean(); }
        if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
        $detalle = $e['message'] . ' @ ' . $e['file'] . ':' . $e['line'];
        echo json_encode(['reply' => isset($_GET['debug'])
            ? ('⚠️ ERROR: ' . $detalle)
            : '⚠️ Ocurrió un problema técnico. Probá de nuevo en unos minutos.']);
    }
});
// --- Polyfills para PHP < 8.0 (este server puede ser 7.4) ---
if (!function_exists('str_contains')) {
    function str_contains($haystack, $needle) {
        return $needle === '' || strpos($haystack, (string)$needle) !== false;
    }
}
if (!function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle) {
        return strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
if (!function_exists('str_ends_with')) {
    function str_ends_with($haystack, $needle) {
        return $needle === '' || substr($haystack, -strlen($needle)) === $needle;
    }
}

ob_start();

// Cookie de sesión expira al cerrar el navegador
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
]);
session_start();

// Timeout: si pasaron más de 2 min sin actividad, limpiar todo
$SESSION_TIMEOUT = 120;
if (isset($_SESSION['last_activity']) && (time() - $_SESSION['last_activity']) > $SESSION_TIMEOUT) {
    // Limpiar todo el contenido de la sesión
    $_SESSION = [];
    // Borrar la cookie de sesión del navegador
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    session_destroy();
    // Iniciar una sesión completamente nueva
    session_start();
    session_regenerate_id(true);
}
$_SESSION['last_activity'] = time();

ob_clean();
header('Content-Type: application/json; charset=utf-8');

// NOTA: deuda_rafam.php se carga de forma diferida (solo en el flujo de deuda),
// porque define ejecutaRfm() y colisiona con el dbRafam.php que trae el conf.php
// de caudalimetros (consumo de agua). Cargarlos juntos = "Cannot redeclare ejecutaRfm".
function cargarModuloDeuda() {
    static $cargado = false;
    if ($cargado) return;
    $cargado = true;
    $mod = __DIR__ . '/deuda_rafam.php';
    if (is_file($mod) && !function_exists('consultarDeuda')) {
        require_once $mod;
    }
    if (!function_exists('consultarDeuda')) {
        // Fallback si el modulo no esta disponible.
        eval('function consultarDeuda($tipo,$cuenta,$fecha=null,$listado="TASA"){'
           . 'return ["status"=>"error","message"=>"modulo de deuda no disponible"];}');
    }
}

$modMultas = __DIR__ . '/infracciones.php';
if (is_file($modMultas)) {
    require_once $modMultas;
}
if (!function_exists('consultarMultas')) {
    // Si el modulo no esta, el bot sigue funcionando; solo infracciones queda deshabilitada.
    function extraerDatoMulta($txt) { return false; }
    function consultarMultas($bsq, $dat) {
        return "Consulta de infracciones no disponible en este momento.";
    }
}

$modAgua = __DIR__ . '/agua_consumo.php';
if (is_file($modAgua)) {
    require_once $modAgua;
}
if (!function_exists('consultarConsumoAgua')) {
    function consultarConsumoAgua($nro_partida) {
        return ['reply' => "Consulta de consumo de agua no disponible en este momento.", 'charts' => []];
    }
}

// Módulo Reclamos 147
$modReclamos = __DIR__ . '/reclamos_147.php';
if (is_file($modReclamos)) {
    require_once $modReclamos;
}
if (!function_exists('flujoReclamos')) {
    function flujoReclamos($msg) {
        return ['reply' => "**🚧 RECLAMOS 147**\n\n📞 147\n🌐 https://147.chascomus.gob.ar"];
    }
}

$OLLAMA_URL   = 'http://10.240.20.24:11434/api/chat';
$OLLAMA_MODEL = 'qwen2.5:3b';

$NO_INFO = "Por el momento no puedo responder la consulta que realizaste, "
    . "por favor ingresá en la página de la municipalidad para obtener más información: "
    . "https://chascomus.gob.ar  \n\n"
    . "o comunicate al teléfono **2241-431341** \n"
    . "escribe la palabra MENU para mas opociones";

// Si entran a chat.php directo (GET, sin POST) -> mandarlos a la pagina del bot
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Location: index.php');
    exit;
}

$data = json_decode(file_get_contents("php://input"), true);
$message = trim($data['message'] ?? '');

if ($message === '') {
    echo json_encode(['reply' => '⚠️ Mensaje vacío.']);
    exit;
}

if (!isset($_SESSION['nombre_usuario'])) {
    $_SESSION['nombre_usuario'] = 'Vecino';
}
if (!isset($_SESSION['history'])) {
    $_SESSION['history'] = [];
}

// ── Primera interacción → mostrar menú directo ──
if (empty($_SESSION['menu_shown'])) {
    $_SESSION['menu_shown'] = true;
    $_SESSION['history'] = [];
    unset($_SESSION['deuda'], $_SESSION['multas'], $_SESSION['agua'], $_SESSION['reclamo147']);
    echo json_encode([
        'reply' => "👋 **¡Hola! ** \n\n¿En qué puedo ayudarte?, escribi tu consulta o la palabra MENU para mostrarte las opciones",
        'opciones' => $menu_opciones
    ]);
    exit;
}

// ============================================================
// RESPUESTAS HARDCODEADAS (rápidas, sin Ollama)
// ============================================================

$respuestas = [

    'hospital' => "**🏥 HOSPITAL MUNICIPAL**\n\n"
        . "📍 Av. Alfonsín e Yrigoyen  \n"
        . "📞 02241-466977  \n"
        . "📱 [Turnos WhatsApp](https://wa.me/5492241466977)",

    'farmacias' => "**💊 FARMACIAS**\n\n"
        . "• Alfonsín — Libres del Sur 121  \n"
        . "• Aprile — Av. Lastra 115  \n"
        . "• Batastini — Cramer 70  \n"
        . "• Belgrano — Belgrano 649  \n"
        . "• Del Norte — El Ombú 102\n\n"
        . "🔍 https://turnofarma.com/turnos/ar/ba/chascomus",

    // 'reclamos' ahora es un flujo interactivo (reclamos_147.php)

    'genero' => "**💜 OFICINA DE GÉNERO**\n\n"
        . "📍 Moreno 259  \n"
        . "📞 02241-530448  \n"
        . "🚨 WhatsApp 24hs: https://wa.me/5492241559397  \n"
        . "📞 Línea 144",

    'agua' => "**💧 SERVICIOS SANITARIOS — Agua**\n\n"
        . "💰 Deuda: https://deuda.chascomus.gob.ar/consulta.php  \n"
        . "📱 WhatsApp: https://wa.me/5492241557616",

    'empleo' => "**💼 EMPLEO**\n\n"
        . "📍 Maipú 415  \n"
        . "📞 02241-436365",

    'poda' => "**🌿 PODA RESPONSABLE**\n\n"
        . "🌳 Solicitudes: https://apps.chascomus.gob.ar/podaresponsable/solicitud.php",

    'licencias' => "**🚗 LICENCIAS DE CONDUCIR**\n\n"
        . "📍 Horario: lunes a viernes 8:00 a 13:30hs  \n"
        . "⚠️ Solo con turno online previo\n\n"
        . "**Turno online:**  \n"
        . "https://apps.chascomus.gob.ar/conducir/turno.php\n\n"
        . "**Documentación:**  \n"
        . "• DNI con domicilio en Chascomús  \n"
        . "• Abonar sellados el día del turno  \n"
        . "• Menores de 18: autorización padre/madre certificada\n\n"
        . "**Pasos:**  \n"
        . "1. Turno online  \n"
        . "2. Examen médico  \n"
        . "3. Examen teórico  \n"
        . "4. Examen práctico — turnos: 2241-586204\n\n"
        . "**Renovación:** hasta 1 mes antes del vencimiento.  \n"
        . "Con hasta 90 días vencida: solo examen médico.  \n"
        . "Con más de 90 días: todos los exámenes.\n\n"
        . "**Duplicado** (robo/extravío): denuncia policial + DNI + turno.",

    'habilitaciones' => "**🏢 HABILITACIONES COMERCIALES**\n\n"
        . "📍 CRAMER 270 - Planta Alta  \n"
        . "📱 WhatsApp: [2241-559389](https://wa.me/5492241559389)  \n"
        . "📧 habilitaciones@chascomus.gob.ar\n\n"
        . "**Requisitos:**  \n"
        . "• DNI (mayor de 21 años)  \n"
        . "• CUIT e Ingresos Brutos  \n"
        . "• Título/contrato del local (firma certificada)  \n"
        . "• Recibo de Tasa Municipal  \n"
        . "• Certificado Urbanístico\n\n"
        . "**Trámite online:**  \n"
        . "https://apps.chascomus.gob.ar/habilitaciones/habilitacionComercial.php",

    'omic' => "**⚖️ OMIC — Defensa del Consumidor**\n\n"
        . "📍 Dorrego 229  \n"
        . "📞 02241-422234  \n"
        . "📧 omic@chascomus.gob.ar  \n"
        . "🕐 Lunes, miércoles y viernes de 9 a 12hs\n\n"
        . "Trámite **gratuito**, sin abogado.\n\n"
        . "**Denuncia online:**  \n"
        . "https://apps.chascomus.gob.ar/omic/",

    'vivienda' => "**🏠 REGISTRO DE DEMANDA HABITACIONAL**\n\n"
        . "**Requisitos:**  \n"
        . "• No ser propietario de vivienda ni terreno  \n"
        . "• DNI argentino, mayor de 18 años  \n"
        . "• Grupo familiar conviviente (mismo domicilio en DNI)  \n"
        . "• 5 años de residencia en el partido\n\n"
        . "**Turno online:**  \n"
        . "https://apps.chascomus.gob.ar/vivienda/",
    
    'juzgado' => "** ⚖️ JUZGADO DE FALTAS**\n\n"
	. "📍Soler 56 \n"
        . "•📞 Tel: 02241- 436294 / 431653 \n\n"
        . "•📧Email: juzgadodefaltas@chascomus.gob.ar \n\n"
        . "•🕐Horario de Atención: 8:00hs. a 12:00hs.\n\n",
	

    'estacionamiento' => "**🅿️ ESTACIONAMIENTO MEDIDO (SEM)**\n\n"
        . "**Formas de pagar:**  \n"
        . "• App **SEM Chascomús** (Play Store / App Store)  \n"
        . "• Código QR en los carteles (Mercado Pago o tarjeta)  \n"
        . "• Puntos de venta SEM en comercios de la zona\n\n"
        . "**Abonos:** diario, 7, 15 o 30 días.\n\n"
        . "Sin app: SMS con la letra **E** al **23123**.\n\n"
        . "**Eximiciones:**  \n"
        . "https://chascomus.gob.ar/municipio/estaticas/estacionamiento",
];

$menu_texto = "**📋 MENÚ PRINCIPAL**\n\n"
    . "A — 🏥 Hospital  \n"
    . "B — 💊 Farmacias  \n"
    . "C — 🚧 Reclamos 147  \n"
    . "D — 💜 Género y Diversidad  \n"
    . "E — 💧 Agua y Sanitarios  \n"
    . "F — 💼 Empleo  \n"
    . "G — 🌿 Poda  \n"
    . "H — 🚗 Licencias de Conducir  \n"
    . "I — 🏢 Habilitaciones Comerciales  \n"
    . "J — ⚖️ OMIC Defensa del Consumidor  \n"
    . "K — 🏠 Vivienda  \n"
    . "L — 🅿️ Estacionamiento SEM  \n"
    . "M — 💰 Consulta de Deuda\n\n"
    . "N — ⚖️ Juzgado de Faltas\n\n"
    . "O — 🚦 Consulta de Infracciones\n\n"
    . "✏️ Escribí la letra, el nombre del tema o hacé tu pregunta directamente.  \n"
    . "🔄 Escribe RESET para reiniciar la conversación  \n"
    . "👋 Escribe CHAU o ADIOS para finalizar la conversación";

// Texto corto cuando se muestran botones (evita repetir la lista de letras)
$menu_texto_corto = "**📋 MENÚ PRINCIPAL**\n\nElegí una opción 👇 o escribí tu pregunta.";

// Opciones que el frontend renderiza como globos/botones.
// value = lo que se "envia" al tocar (la letra del menu).
$menu_opciones = [
    ['label' => '🏥 Hospital',                 'value' => 'A'],
    ['label' => '💊 Farmacias',                'value' => 'B'],
    ['label' => '🚧 Reclamos 147',             'value' => 'C'],
    ['label' => '💜 Género y Diversidad',      'value' => 'D'],
    ['label' => '💧 Agua y Sanitarios',        'value' => 'E'],
    ['label' => '💼 Empleo',                   'value' => 'F'],
    ['label' => '🌿 Poda',                     'value' => 'G'],
    ['label' => '🚗 Licencias de Conducir',    'value' => 'H'],
    ['label' => '🏢 Habilitaciones',           'value' => 'I'],
    ['label' => '⚖️ OMIC Consumidor',          'value' => 'J'],
    ['label' => '🏠 Vivienda',                 'value' => 'K'],
    ['label' => '🅿️ Estacionamiento SEM',      'value' => 'L'],
    ['label' => '💰 Consulta de Deuda',        'value' => 'M'],
    ['label' => '⚖️ Juzgado de Faltas',        'value' => 'N'],
    ['label' => '🚦 Infracciones',             'value' => 'O'],
];

// Ordena alfabeticamente por el texto del label (ignora el emoji inicial)
usort($menu_opciones, function ($a, $b) {
    $limpia = function ($s) {
        $s = preg_replace('/^[^\p{L}]+/u', '', $s); // saca emoji/simbolos del inicio
        return mb_strtolower(trim($s));
    };
    return strcmp($limpia($a['label']), $limpia($b['label']));
});

// ============================================================
// FUNCIONES
// ============================================================

function extraerNombre($texto) {
    $texto = trim(mb_strtolower($texto));
    $patrones = [
        '/^me llamo\s+([a-záéíóúñ]+)$/iu',
        '/^mi nombre es\s+([a-záéíóúñ]+)$/iu',
        '/^soy\s+([a-záéíóúñ]+)$/iu',
        '/^([a-záéíóúñ]+)$/iu'
    ];
    foreach ($patrones as $patron) {
        if (preg_match($patron, $texto, $m)) {
            $nombre = strtolower($m[1]);
            $invalidos = ['hola','buenas','si','no','gracias','menu','reset','chau'];
            if (!in_array($nombre, $invalidos) && strlen($nombre) >= 2) {
                return ucfirst($nombre);
            }
        }
    }
    return null;
}

// ============================================================
// DETECCIÓN DE INTENCIÓN (hardcodeado + fallback a IA)
// ============================================================

function detectarIntencion($m) {

    $m = mb_strtolower(trim($m));

    if (in_array($m, ['reset', 'reiniciar'])) return 'reset';
    if (in_array($m, ['chau', 'adios', 'hasta luego', 'bye'])) return 'despedida';
    if (str_contains($m, 'menu') || str_contains($m, 'menú')) return 'menu';

    // Saludos → mostrar menú
    $saludos = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días',
                'buenas tardes', 'buenas noches', 'que tal', 'qué tal', 'hey', 'ey',
                'hola!', 'hola!!', 'holaa', 'hi', 'hello'];
    if (in_array($m, $saludos)) return 'menu';

    // Respuestas negativas al "¿Puedo ayudarte con algo más?"
    $negativas = ['no', 'no gracias', 'nada', 'nada mas', 'nada más', 'estoy bien',
                  'eso es todo', 'es todo', 'gracias', 'muchas gracias', 'ok gracias',
                  'listo', 'perfecto gracias', 'gracias nada mas', 'gracias nada más'];
    if (in_array($m, $negativas)) return 'despedida';

    // Letras del menú
    $letras = [
        'a' => 'hospital',
        'b' => 'farmacias',
        'c' => 'reclamos',
        'd' => 'genero',
        'e' => 'agua',
        'f' => 'empleo',
        'g' => 'poda',
        'h' => 'licencias',
        'i' => 'habilitaciones',
        'j' => 'omic',
        'k' => 'vivienda',
        'l' => 'estacionamiento',
        'm' => 'deuda',
	'n' => 'juzgado',
	'o' => 'multas',
    ];
    if (isset($letras[$m])) return $letras[$m];

    // Mapa de palabras clave => intención
    $mapa = [
        'hospital|guardia|turno|medico'                    => 'hospital',
        'farmacia|farma|medicamento'                       => 'farmacias',
        'reclamo|147|calles|alumbrado|basura|liminaria|luminaria|bache|vereda|seguimiento' => 'reclamos',
        'genero|género|violencia'                          => 'genero',
        'agua|consumo|sanitario'                           => 'agua',
        'empleo|trabajo|cv|laburo'                         => 'empleo',
        'poda|arbol|árbol'                                 => 'poda',
        'licencia|conducir|carnet|registro de conducir'    => 'licencias',
        'habilitacion|habilitación|comercio|negocio|local' => 'habilitaciones',
        'omic|consumidor|denuncia|defensa'                 => 'omic',
        'vivienda|habitacional|casa propia'                => 'vivienda',
        'estacionamiento|parquimetro|parquímetro|sem'      => 'estacionamiento',
        'deuda|deudas|adeudo|adeuda|impuesto|impuestos|cuanto debo|cuánto debo|consulta de deuda|consultar deuda|pagar tasa|mis tasas' => 'deuda',
	'juzgado|faltas'                                   => 'juzgado',
	'infraccion|infracciones|multa|multas|acta|actas'  => 'multas',
    ];

    foreach ($mapa as $patron => $intencion) {
        foreach (explode('|', $patron) as $p) {
            if (str_contains($m, $p)) return $intencion;
        }
    }

    return 'ia'; // No matcheó nada → Ollama
}

// ============================================================
// MAPA DE CONTEXTOS PARA OLLAMA
// Cuando cae a 'ia', busca qué .md cargar
// ============================================================

function buscarContexto($mensaje) {

    $m = mb_strtolower($mensaje);

    $mapa = [
        'hospital|turno|guardia|medico|médico'               => 'hospital.md',
        'farmacia|medicamento|remedio'                       => 'farmacias.md',
        'reclamo|147|bache|alumbrado|basura|liminaria'       => 'reclamos.md',
        'genero|género|violencia|mujer'                      => 'genero.md',
        'agua|consumo|sanitario|cloaca'                      => 'agua.md',
        'empleo|trabajo|cv|laburo|oferta'                    => 'empleo.md',
        'poda|arbol|árbol|rama|verde'                        => 'poda.md',
        'licencia|conducir|carnet|manejo|chofer'             => 'licencias.md',
        'habilitacion|habilitación|comercio|negocio|local'   => 'habilitaciones.md',
        'omic|consumidor|denuncia|defensa|estafa|garantia'   => 'omic.md',
        'vivienda|habitacional|casa|terreno|lote'            => 'vivienda.md',
        'estacionamiento|parquimetro|sem|multa|cochera'      => 'estacionamiento.md',
	
    ];

    foreach ($mapa as $patron => $archivo) {
        foreach (explode('|', $patron) as $p) {
            if (str_contains($m, $p)) return $archivo;
        }
    }

    return 'general.md'; // fallback
}

function consultarOllama($message, $contexto_archivo, $ollama_url, $ollama_model, $no_info) {

    $ctx_path = __DIR__ . '/contextos/' . $contexto_archivo;

    $contexto = file_exists($ctx_path)
        ? file_get_contents($ctx_path)
        : '';

    // Si no hay contexto, no gastar CPU
    if (empty(trim($contexto))) {
        return $no_info;
    }

    $system_prompt = "Sos MuniBot de la Municipalidad de Chascomús.\n"
        . "Reglas:\n"
        . "- Respondé SOLO con la info del contexto de abajo.\n"
        . "- Respuestas cortas y en español.\n"
        . "- Si la pregunta no se puede responder con el contexto, respondé exactamente:\n"
        . "'No tengo información sobre eso.'\n"
        . "- NO inventes datos.\n\n"
        . "CONTEXTO:\n" . $contexto;

    $_SESSION['history'][] = [
        'role' => 'user',
        'content' => $message
    ];

    // Limitar historial a últimos 4 mensajes (2 intercambios)
    if (count($_SESSION['history']) > 4) {
        $_SESSION['history'] = array_slice($_SESSION['history'], -4);
    }

    $payload = [
        'model'   => $ollama_model,
        'messages' => array_merge(
            [['role' => 'system', 'content' => $system_prompt]],
            $_SESSION['history']
        ),
        'stream'  => false,
        'options' => [
            'num_ctx'     => 768,
            'num_predict' => 150,
            'temperature' => 0.3,
            'num_thread'  => 4,
        ]
    ];

    $ch = curl_init($ollama_url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 12,
    ]);

    $response = curl_exec($ch);

    if (curl_errno($ch)) {
        curl_close($ch);
        return $no_info;
    }

    curl_close($ch);

    $result = json_decode($response, true);
    $reply  = trim($result['message']['content'] ?? '');

    // Si Ollama dice que no sabe, devolver mensaje bonito
    if (
        empty($reply)
        || str_contains(mb_strtolower($reply), 'no tengo información')
        || str_contains(mb_strtolower($reply), 'no tengo info')
        || str_contains(mb_strtolower($reply), 'no puedo responder')
    ) {
        return $no_info;
    }

    return $reply;
}

// ============================================================
// FLUJO PRINCIPAL
// ============================================================

if ($message === '__diag') {
    $ping = function ($url) {
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>3, CURLOPT_TIMEOUT=>5]);
        $r = curl_exec($c); $e = curl_errno($c); curl_close($c);
        return $e ? ("ERROR cURL " . $e . " (" . curl_strerror($e) . ")") : "OK";
    };
    echo json_encode(['reply' =>
        "DIAG\n" .
        "intencion('a') = " . detectarIntencion('a') . "\n" .
        "intencion('hospital') = " . detectarIntencion('hospital') . "\n" .
        "respuesta_hardcodeada_hospital = " . (isset($respuestas['hospital']) ? 'SI' : 'NO') . "\n" .
        "flujo_deuda_activo = " . (empty($_SESSION['deuda']) ? 'no' : 'SI (' . ($_SESSION['deuda']['paso'] ?? '?') . ')') . "\n" .
        "ollama (" . $OLLAMA_URL . ") = " . $ping($OLLAMA_URL)
    ]);
    exit;
}

$intencion = detectarIntencion($message);

// -- Reset
if ($intencion === 'reset') {
    $_SESSION['nombre_usuario'] = 'Vecino';
    $_SESSION['history'] = [];
    unset($_SESSION['deuda'], $_SESSION['multas'], $_SESSION['agua'], $_SESSION['reclamo147'], $_SESSION['menu_shown']);
    echo json_encode([
        'reply' => "🔄 **Conversación reiniciada**\n\n¿En qué puedo ayudarte?",
        'opciones' => $menu_opciones
    ]);
    exit;
}

// -- Despedida (pero NO si estamos dentro de un flujo activo)
$enFlujoActivo = !empty($_SESSION['deuda']) || !empty($_SESSION['multas']) || !empty($_SESSION['agua']) || !empty($_SESSION['reclamo147']);
if ($intencion === 'despedida' && !$enFlujoActivo) {
    session_destroy();
    echo json_encode(['reply' => "👋 ¡Hasta luego! Fue un gusto ayudarte. Si necesitás algo más, estaré por acá. ¡Que tengas un excelente día!"]);
    exit;
}

// Si estamos en un flujo activo y la intención era despedida,
// tratarla como input libre para que el flujo la procese
if ($enFlujoActivo && $intencion === 'despedida') {
    $intencion = 'ia';
}

// -- Pedir nombre
function humanizarRespuesta($nombre, $tema, $info_cruda, $ollama_url, $ollama_model) {

    $system = "Sos MuniBot, asistente de la Municipalidad de Chascomús. "
        . "Te paso INFORMACION OFICIAL sobre un tema y la reescribís para el vecino "
        . "$nombre de forma cálida y clara, en español rioplatense.\n"
        . "REGLAS ESTRICTAS:\n"
        . "- Conservá EXACTOS todos los datos: telefonos, direcciones, links, mails, horarios y requisitos. No inventes ni borres nada.\n"
        . "- Respondé SOLO sobre el tema y la info dada. NO agregues preguntas ni ofrecimientos que no esten en la info.\n"
        . "- Podés usar vinetas y negritas (markdown).\n"
        . "- Cerrá con la frase: ¿Puedo ayudarte con algo más?";

    $user_msg = "Tema: $tema.\n\nInformación oficial a reescribir (no agregues nada que no este aca):\n$info_cruda";

    $payload = [
        'model'   => $ollama_model,
        'messages' => [
            ['role' => 'system',  'content' => $system],
            ['role' => 'user',    'content' => $user_msg],
        ],
        'stream'  => false,
        'options' => [
            'num_ctx'     => 512,
            'num_predict' => 180,
            'temperature' => 0.3,
            'num_thread'  => 4,
        ]
    ];

    $ch = curl_init($ollama_url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 12,
    ]);
    $response = curl_exec($ch);
    $err = curl_errno($ch);
    curl_close($ch);

    if ($err) return null;

    $result = json_decode($response, true);
    $reply  = trim($result['message']['content'] ?? '');
    return $reply ?: null;
}

// ============================================================
// FLUJO CONSULTA DE DEUDA (wizard multi-paso) - RAFAM via OCI
// ============================================================
function mapTipoDeuda($m) {
    $m = mb_strtolower(trim($m));
    if (in_array($m, ['1','inmueble','inmuebles','inmbl','partida','casa','terreno'])) return 'inmbl';
    if (in_array($m, ['2','comercio','comercios','comrc','negocio','local'])) return 'comrc';
    if (in_array($m, ['3','vehiculo','vehículo','auto','rodado','dominio','patente','vehic'])) return 'vehic';
    if (in_array($m, ['4','contribuyente','cuit','cuil','contr','persona'])) return 'contr';
    return null;
}

function mapListado($m) {
    $m = mb_strtolower(trim($m));
    if (in_array($m, ['1','periodos','períodos','periodos adeudados','adeudado','adeudados','tasa','tasas'])) return 'TASA';
    if (in_array($m, ['2','convenio','convenios','cuota','cuotas','cuotas de convenio','plan','plan de pago','planes','ppago'])) return 'PPAGO';
    return null;
}

function formatearDeuda($r) {
    $nombres = ['inmbl'=>'Inmueble','comrc'=>'Comercio','vehic'=>'Vehículo','contr'=>'Contribuyente'];
    $nom  = $nombres[$r['tipo']] ?? $r['tipo'];
    $esPP = (($r['listado'] ?? 'TASA') === 'PPAGO');

    $titulo = $esPP ? "CUOTAS DE CONVENIO" : "DEUDA";
    $out  = "💰 **$titulo — $nom " . $r['cuenta'] . "**\n";
    if (!empty($r['contribuyente'])) $out .= "👤 Titular: " . $r['contribuyente'] . "  \n";
    $out .= "📅 Calculado al: " . $r['fecha_pago'] . "\n\n";

    if (empty($r['items'])) {
        $vacio = $esPP
            ? "✅ No tiene cuotas de convenio vigentes para este recurso."
            : "✅ ¡No registra deuda para este recurso!";
        return $out . $vacio . "\n\n¿Puedo ayudarte con algo más?";
    }

    $out .= $esPP ? "**Cuotas de convenio:**\n" : "**Períodos adeudados:**\n";
    $max = 25; $i = 0;
    foreach ($r['items'] as $it) {
        if ($i++ >= $max) { $out .= "… y " . (count($r['items']) - $max) . " cuota(s) más.  \n"; break; }
        $monto = number_format($it['monto_total'], 2, ',', '.');
        $out .= "• " . $it['periodo'] . " — " . $it['descripcion'] . " (vence " . $it['fecha_vto'] . "): $ " . $monto . "  \n";
    }
    $total = number_format($r['total'], 2, ',', '.');
    $out .= "\n**TOTAL: $ " . $total . "**\n\n";
    $out .= "Para emitir el comprobante o pagar online:  \nhttps://deuda.chascomus.gob.ar/consulta.php\n\n";
    $out .= "¿Puedo ayudarte con algo más?";
    return $out;
}

function flujoDeuda($message) {
    $msg = mb_strtolower(trim($message));

    // Inicio del flujo
    if (empty($_SESSION['deuda'])) {
        $_SESSION['deuda'] = ['paso' => 'tipo'];
        return "💰 **CONSULTA DE DEUDA**\n\n¿Sobre qué recurso querés consultar?\n\n"
            . "1 — 🏠 Inmueble (Nro de partida)  \n"
            . "2 — 🏢 Comercio (Nro de comercio)  \n"
            . "3 — 🚗 Vehículo (dominio / patente)  \n"
            . "4 — 👤 Contribuyente (CUIT / CUIL)\n\n"
            . "Respondé con el número o el nombre.  \n_(Escribí MENU para salir)_";
    }

    $paso = $_SESSION['deuda']['paso'] ?? 'tipo';

    // Paso 1: tipo de recurso
    if ($paso === 'tipo') {
        $tipo = mapTipoDeuda($msg);
        if (!$tipo) {
            return "No entendí el recurso 🤔. Elegí una opción:\n\n1 — Inmueble  \n2 — Comercio  \n3 — Vehículo  \n4 — Contribuyente";
        }
        $_SESSION['deuda'] = ['paso' => 'listado', 'tipo' => $tipo];
        return "¿Qué querés consultar?\n\n"
            . "1 — 📋 Períodos adeudados (tasas)  \n"
            . "2 — 📄 Cuotas de convenio de pago\n\n"
            . "Respondé 1 o 2.";
    }

    // Paso 2: tipo de listado (TASA / PPAGO)
    if ($paso === 'listado') {
        $listado = mapListado($msg);
        if (!$listado) {
            return "Elegí una opción:\n\n1 — Períodos adeudados  \n2 — Cuotas de convenio";
        }
        $_SESSION['deuda']['listado'] = $listado;
        $_SESSION['deuda']['paso']    = 'cuenta';
        $tipo = $_SESSION['deuda']['tipo'];
        $etiquetas = [
            'inmbl' => "el **Nro de partida** del inmueble",
            'comrc' => "el **Nro de comercio**",
            'vehic' => "el **dominio** (patente) del vehículo",
            'contr' => "el **CUIT / CUIL** del contribuyente",
        ];
        return "Perfecto 👍. Ingresá " . $etiquetas[$tipo] . ":";
    }

    // Paso 3: recibir el dato y consultar
    if ($paso === 'cuenta') {
        $tipo    = $_SESSION['deuda']['tipo'];
        $listado = $_SESSION['deuda']['listado'] ?? 'TASA';
        $cuenta  = trim($message);

        try {
            $r = consultarDeuda($tipo, $cuenta, null, $listado);
        } catch (Throwable $e) {
            unset($_SESSION['deuda']);
            return "😕 No pude conectarme con el sistema de RAFAM en este momento. "
                . "Probá más tarde o ingresá a https://deuda.chascomus.gob.ar/consulta.php\n\n¿Puedo ayudarte con algo más?";
        }

        $st = $r['status'] ?? 'error';
        if ($st === 'notfound') {
            return "No encontré datos para **" . $cuenta . "** 😕. Verificá el valor y volvé a ingresarlo, o escribí MENU para salir.";
        }
        if ($st !== 'success') {
            unset($_SESSION['deuda']);
            return "Ocurrió un error en la consulta. Probá de nuevo más tarde.\n\n¿Puedo ayudarte con algo más?";
        }

        unset($_SESSION['deuda']); // fin del flujo
        return formatearDeuda($r);
    }

    unset($_SESSION['deuda']);
    return "Reiniciemos. Escribí **deuda** para consultar de nuevo.";
}

// ============================================================
// FLUJO CONSULTA DE INFRACCIONES (DNI / patente) - mch_jfaltas
// ============================================================
function flujoMultas($message) {
    // Inicio del flujo: pedir el dato
    if (empty($_SESSION['multas'])) {
        $_SESSION['multas'] = ['paso' => 'dato'];
        return "🚦 **CONSULTA DE INFRACCIONES**\n\n"
            . "Ingresá tu **DNI** (sin puntos) o tu **patente** y te digo si tenés actas impagas.\n\n"
            . "Ejemplo: `30111222`  o  `AB123CD`\n\n_(Escribí MENU para salir)_";
    }

    // Paso unico: recibir DNI o patente y consultar
    $dm = extraerDatoMulta($message);
    if ($dm === false) {
        return "No reconocí el dato 🤔. Ingresá un **DNI** (7 u 8 dígitos) "
            . "o una **patente** (formato `AAA123` o `AB123CD`).\n\n_(Escribí MENU para salir)_";
    }

    try {
        $reply = consultarMultas($dm['bsq'], $dm['dat']);
    } catch (Throwable $e) {
        unset($_SESSION['multas']);
        return "😕 No pude conectarme con el sistema de infracciones en este momento. "
            . "Probá más tarde.\n\n¿Puedo ayudarte con algo más?";
    }

    unset($_SESSION['multas']); // fin del flujo
    return $reply;
}

// ============================================================
// FLUJO CONSUMO DE AGUA (Nro de Partida -> grafico de barras)
// Devuelve ['reply'=>texto, 'charts'=>[...]] para que index.php grafique.
// ============================================================
function flujoAgua($message, $info_agua) {
    // Inicio: mostrar info oficial + pedir el Nro de Partida
    if (empty($_SESSION['agua'])) {
        $_SESSION['agua'] = ['paso' => 'partida'];
        return ['reply' =>
            $info_agua
            . "\n\n---\n\n💧 **Ver tu consumo:** ingresá tu **Nro de Partida** "
            . "y te muestro el gráfico de consumo.\n\n_(Escribí MENU para salir)_",
            'charts' => []];
    }

    // Paso unico: recibir Nro de Partida y consultar
    $np = preg_replace('/[^0-9]/', '', $message);
    if ($np === '') {
        return ['reply' =>
            "Ingresá un **Nro de Partida** válido (solo números), o escribí MENU para salir.",
            'charts' => []];
    }

    $res = consultarConsumoAgua($np);
    unset($_SESSION['agua']); // fin del flujo
    return $res;
}

// 'menu' siempre cancela un flujo de deuda en curso
if ($intencion === 'menu') {
    unset($_SESSION['deuda']);
}

$enFlujoDeuda = !empty($_SESSION['deuda']);

// ¿El mensaje es una entrada valida del wizard de deuda segun el paso actual?
// Si NO lo es (el usuario eligio otra opcion del menu), dejamos que el flujo
// se cancele y el mensaje se procese normal (respuestas / contextos).
$esInputDeuda = false;
if ($enFlujoDeuda) {
    $pasoDeuda = $_SESSION['deuda']['paso'] ?? 'tipo';
    if ($pasoDeuda === 'tipo') {
        $mapeado = mapTipoDeuda($message);
    } elseif ($pasoDeuda === 'listado') {
        $mapeado = mapListado($message);
    } else {
        $mapeado = null; // paso 'cuenta': el dato es libre
    }
    // Es input del wizard si mapea una opcion, o si la intencion no es un tema
    // concreto del menu (es 'ia' = texto libre como un nro de cuenta o un typo).
    $esInputDeuda = ($mapeado !== null) || in_array($intencion, ['ia', 'deuda'], true);
}

// Iniciar (intencion 'deuda') o continuar el flujo
if ($intencion === 'deuda' || ($enFlujoDeuda && $esInputDeuda)) {
    cargarModuloDeuda();
    $reply = flujoDeuda($message);
    $_SESSION['history'][] = ['role' => 'assistant', 'content' => $reply];
    echo json_encode(['reply' => $reply]);
    exit;
}

// Estaba en el flujo pero el usuario eligio otra cosa del menu -> cancelar
if ($enFlujoDeuda) {
    unset($_SESSION['deuda']);
}

// ============================================================
// FLUJO INFRACCIONES (mismo patron que deuda)
// ============================================================
if ($intencion === 'menu') {
    unset($_SESSION['multas']);
}

$enFlujoMultas = !empty($_SESSION['multas']);

// En el paso 'dato' la entrada es libre (DNI/patente). Es input del wizard
// salvo que el usuario haya elegido otra opcion concreta del menu (letra/tema).
$esInputMultas = false;
if ($enFlujoMultas) {
    $esInputMultas = in_array($intencion, ['ia', 'multas'], true);
}

if ($intencion === 'multas' || ($enFlujoMultas && $esInputMultas)) {
    $reply = flujoMultas($message);
    $_SESSION['history'][] = ['role' => 'assistant', 'content' => $reply];
    echo json_encode(['reply' => $reply]);
    exit;
}

// Estaba en el flujo de infracciones pero eligio otra cosa -> cancelar
if ($enFlujoMultas) {
    unset($_SESSION['multas']);
}

// ============================================================
// FLUJO CONSUMO DE AGUA (intercepta la opcion E / 'agua')
// ============================================================
if ($intencion === 'menu') {
    unset($_SESSION['agua']);
}

$enFlujoAgua = !empty($_SESSION['agua']);

// En el paso 'partida' la entrada es libre (un numero). Es input del wizard
// salvo que el usuario haya elegido otra opcion concreta del menu.
$esInputAgua = false;
if ($enFlujoAgua) {
    $esInputAgua = in_array($intencion, ['ia', 'agua'], true);
}

if ($intencion === 'agua' || ($enFlujoAgua && $esInputAgua)) {
    $res = flujoAgua($message, $respuestas['agua']);
    $_SESSION['history'][] = ['role' => 'assistant', 'content' => $res['reply']];
    $out = ['reply' => $res['reply']];
    if (!empty($res['charts'])) {
        $out['charts'] = $res['charts'];
    }
    echo json_encode($out);
    exit;
}

// Estaba en el flujo de agua pero eligio otra cosa -> cancelar
if ($enFlujoAgua) {
    unset($_SESSION['agua']);
}

// ============================================================
// FLUJO RECLAMOS 147 (mismo patron que deuda/multas/agua)
// ============================================================
if ($intencion === 'menu') {
    unset($_SESSION['reclamo147']);
}

$enFlujoReclamo = !empty($_SESSION['reclamo147']);

$esInputReclamo = false;
if ($enFlujoReclamo) {
    // 'despedida' incluye "no", "gracias", etc. que el flujo usa para saltear campos opcionales
    $esInputReclamo = in_array($intencion, ['ia', 'reclamos', 'despedida'], true);
}

if ($intencion === 'reclamos' || ($enFlujoReclamo && $esInputReclamo)) {
    $res = flujoReclamos($message);
    $reply = $res['reply'] ?? $res;
    $_SESSION['history'][] = ['role' => 'assistant', 'content' => is_string($reply) ? $reply : $reply];
    $out = ['reply' => $reply];
    if (!empty($res['opciones'])) {
        $out['opciones'] = $res['opciones'];
    }
    echo json_encode($out);
    exit;
}

// Estaba en el flujo de reclamos pero eligio otra cosa -> cancelar
if ($enFlujoReclamo) {
    unset($_SESSION['reclamo147']);
}

// -- Menú
$opciones_salida = null;
if ($intencion === 'menu') {
    $reply = $menu_texto_corto;
    $opciones_salida = $menu_opciones;
}
// -- Respuesta hardcodeada (texto exacto, sin pasar por el modelo)
//    Se devuelve tal cual: es info oficial (telefonos, links, direcciones) y
//    el modelo chico (0.5b) la reescribia/arruinaba. Para reactivar la
//    "humanizacion", pone $HUMANIZAR = true.
elseif (isset($respuestas[$intencion])) {
    $HUMANIZAR = false; // false = devolver el texto oficial sin reformular
    if ($HUMANIZAR) {
        // Tema claro (no la letra cruda) para que el modelo no divague.
        $temas = [
            'hospital'        => 'el Hospital Municipal',
            'farmacias'       => 'las farmacias de turno',
            'reclamos'        => 'reclamos al 147',
            'genero'          => 'la Oficina de Genero',
            'agua'            => 'Agua y Servicios Sanitarios',
            'empleo'          => 'la oficina de Empleo',
            'poda'            => 'la poda responsable',
            'licencias'       => 'licencias de conducir',
            'habilitaciones'  => 'habilitaciones comerciales',
            'omic'            => 'la OMIC (Defensa del Consumidor)',
            'vivienda'        => 'el registro de demanda habitacional',
            'estacionamiento' => 'el estacionamiento medido (SEM)',
        ];
        $tema   = $temas[$intencion] ?? $intencion;
        $nombre = $_SESSION['nombre_usuario'] ?? 'vecino';
        $humanizada = humanizarRespuesta($nombre, $tema, $respuestas[$intencion], $OLLAMA_URL, $OLLAMA_MODEL);
        $reply = $humanizada ?? $respuestas[$intencion];
    } else {
        $reply = $respuestas[$intencion];
    }
}
// -- Fallback: si HUMANIZAR está en false, no ir a Ollama → mostrar menú
else {
    $nombre = $_SESSION['nombre_usuario'] ?? 'vecino';
    $reply = "😅 {$nombre}, no encontré información sobre eso.\n\nProbá eligiendo una opción del menú 👇\n\no escribí tu consulta con otras palabras.";
    $opciones_salida = $menu_opciones;
}

$_SESSION['history'][] = [
    'role' => 'assistant',
    'content' => $reply
];

$salida = ['reply' => $reply];
if (!empty($opciones_salida)) {
    $salida['opciones'] = $opciones_salida;
}
echo json_encode($salida);
