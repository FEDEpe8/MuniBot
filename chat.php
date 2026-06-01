<?php
// ============================================================
//  PROXY ANTI-CORS — MuniBot → n8n
//  Ubicación: /www/wwwroot/test.chascomus.gob.ar/api/chat.php
// ============================================================
 
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
 
// Evitar que PHP corte la ejecución antes que cURL
set_time_limit(120);
 
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
 
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}
 
$rawBody = file_get_contents('php://input');
$data    = json_decode($rawBody, true);
 
if (json_last_error() !== JSON_ERROR_NONE || empty($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Body inválido o vacío']);
    exit;
}
 
 
 # prueba
     // $data2 = [
       // 'pregunta'  => $data['mensaje'],
        //'session_id'=> 'MuniBot'
    //];
    
    //$ch = curl_init('http://10.240.23.7:8080/api/preguntas');
    
    //curl_setopt_array($ch, [
      //  CURLOPT_POST => true,
      //  CURLOPT_RETURNTRANSFER => true,
       // CURLOPT_HTTPHEADER => [
         //   'Authorization: Bearer 2916902a4d2f68cedfa0256818c8568e061440e41920c6dd',
           // 'Content-Type: application/json'
        //],
        //CURLOPT_POSTFIELDS => json_encode($data2)
    //]);
    
    //$response = curl_exec($ch);
    //curl_close($ch);
    
    //$output = json_decode($response, true)['respuesta'] ?? null;
    //if(!empty($output)){
      //  echo json_encode([
        //    'output' => $output
        //]); 
        //exit;
    //}else {
      //  echo json_encode([
        //    'output' => json_decode($response, true)['error']
        //]);
        //exit;// code...
    //}

    ## fin prueba
 
 
// ============================================================
//  CONSULTA DE DEUDA — RAFAM (intercepción local)
// ============================================================
require_once __DIR__ . '/deuda_rafam.php';

/**
 * Detecta si el mensaje es una consulta de deuda y extrae tipo + cuenta.
 * Patrones reconocidos:
 *   "deuda inmueble 1234"
 *   "deuda comercio 567"
 *   "deuda rodado/patente/auto ABC123"
 *   "deuda contribuyente/cuit 20-12345678-9"
 * También acepta solo "deuda 1234" → asume inmueble.
 */
function detectarConsultaDeuda(string $msg): ?array {
    $msg = mb_strtolower(trim($msg));

    // Mapa de palabras clave → tipo interno
    $tipos = [
        'inmueble'       => 'inmbl',
        'propiedad'      => 'inmbl',
        'inmuebles'      => 'inmbl',
        'comercio'       => 'comrc',
        'comercios'      => 'comrc',
        'local'          => 'comrc',
        'rodado'         => 'vehic',
        'rodados'        => 'vehic',
        'patente'        => 'vehic',
        'auto'           => 'vehic',
        'vehiculo'       => 'vehic',
        'contribuyente'  => 'contr',
        'contribuyentes' => 'contr',
        'cuit'           => 'contr',
        'cuil'           => 'contr',
    ];

    // Debe contener la palabra "deuda" (o "consulta deuda")
    if (!preg_match('/\bdeuda\b/', $msg)) return null;

    $tipo  = 'inmbl'; // default
    $cuenta = null;

    foreach ($tipos as $kw => $t) {
        if (strpos($msg, $kw) !== false) {
            $tipo = $t;
            break;
        }
    }

    // Extraer la cuenta: número o dominio alfanumérico al final del mensaje
    if (preg_match('/\b([A-Z]{2,3}\d{3,4}[A-Z]{0,2}|\d{3,10}(?:-\d+)*)\s*$/i', $msg, $m)) {
        $cuenta = $m[1];
    } elseif (preg_match('/(\d{2}-\d{8}-\d)/', $msg, $m)) {
        $cuenta = $m[1]; // CUIT con guiones
    } elseif (preg_match('/\b(\d{9,11})\b/', $msg, $m)) {
        $cuenta = $m[1]; // CUIT sin guiones
    }

    if ($cuenta === null) return null;

    return ['tipo' => $tipo, 'cuenta' => $cuenta];
}

/**
 * Formatea el resultado de consultarDeuda() como texto para el bot.
 */
function formatearDeuda(array $res): string {
    if ($res['status'] === 'error')    return "❌ Error al consultar RAFAM: " . $res['message'];
    if ($res['status'] === 'notfound') return "🔍 " . $res['message'];

    $out  = "📋 *Consulta de deuda al {$res['fecha_pago']}*\n";
    $out .= "👤 *Contribuyente:* {$res['contribuyente']}\n";

    if ($res['cantidad'] === 0) {
        $out .= "\n✅ No registra deuda pendiente.";
        return $out;
    }

    $out .= "📌 *Ítems pendientes:* {$res['cantidad']}\n";
    $out .= "💰 *Total:* $" . number_format($res['total'], 2, ',', '.') . "\n\n";

    foreach ($res['items'] as $i) {
        $out .= "• {$i['periodo']} — {$i['descripcion']}";
        $out .= " | Vto: {$i['fecha_vto']}";
        $out .= " | Total: $" . number_format($i['monto_total'], 2, ',', '.');
        $out .= "\n";
    }
    return $out;
}

$consulta = detectarConsultaDeuda($data['mensaje'] ?? '');
if ($consulta !== null) {
    $res = consultarDeuda($consulta['tipo'], $consulta['cuenta']);
    echo json_encode(['output' => formatearDeuda($res)], JSON_UNESCAPED_UNICODE);
    exit;
}

// ============================================================
//  FIN CONSULTA DEUDA
// ============================================================

$webhookUrl = 'https://n8n.chascomus.gob.ar/webhook/MuniBot';
 
$ch = curl_init($webhookUrl);
curl_setopt_array($ch, [
    CURLOPT_POST            => true,
    CURLOPT_POSTFIELDS      => json_encode($data),
    CURLOPT_HTTPHEADER      => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER  => true,
    CURLOPT_TIMEOUT         => 90,
    CURLOPT_CONNECTTIMEOUT  => 15,
    CURLOPT_SSL_VERIFYPEER  => false,
    CURLOPT_SSL_VERIFYHOST  => false,
    CURLOPT_FOLLOWLOCATION  => true,
    CURLOPT_MAXREDIRS       => 3,
]);
 
$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
$curlErrNo = curl_errno($ch);
curl_close($ch);
 
if ($curlError || $response === false) {
    
    http_response_code(502);
    echo json_encode([
        'output' => 'Lo siento, el servidor tardó demasiado en responder. Por favor, intentá más tarde.',
        'debug'  => ['curl_error' => $curlError, 'curl_errno' => $curlErrNo]
    ]);
    exit;
}
 
if (empty(trim($response))) {
    http_response_code(502);
    echo json_encode(['output' => 'El servidor no devolvió respuesta. Intentá más tarde.']);
    exit;
}
 
http_response_code($httpCode ?: 200);
echo $response;

