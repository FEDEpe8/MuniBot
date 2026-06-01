<?php
/**
 * MuniBot - Modulo de CONSULTA DE DEUDA contra RAFAM.
 * ---------------------------------------------------
 * NO se conecta a Oracle directamente: le pega por cURL al MISMO gateway que
 * usa hoy la web de deuda (deuda.chascomus.gob.ar):
 *
 *      http://10.240.22.75/consrafam/consulta.php
 *
 * Recibe { sql, params } por POST y devuelve { status, data } en JSON.
 * No hace falta oci8 ni Oracle Instant Client: solo cURL (que el bot ya usa).
 *
 * Lo usa chat.php a traves de consultarDeuda($tipo, $cuenta).
 * Compatible con PHP 7.4 y 8.0.
 */

const RAFAM_GATEWAY = 'http://10.240.22.75/consrafam/consulta.php';
const RAFAM_ORAUSER = 792;

function ejecutaRfm($sql, $params = null) {
    $sql   = str_replace("\r\n", "", $sql);
    $datos = ['sql' => $sql, 'params' => $params];

    $ch = curl_init(RAFAM_GATEWAY);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($datos),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $response = curl_exec($ch);
    $err      = curl_errno($ch);
    curl_close($ch);

    if ($err || $response === false) {
        return 'Error';
    }

    $resp = json_decode($response, true);
    $t    = strtoupper(substr(ltrim($sql), 0, 6));

    if (strncmp($t, 'SELECT', 6) === 0 || strncmp($t, 'BEGIN', 5) === 0) {
        if (!is_array($resp)) {
            return 'Error'; // respuesta inesperada del gateway
        }
        if (($resp['status'] ?? '') === 'error') {
            return 'Error'; // el gateway reportó error explícito
        }
        return $resp['data'] ?? [];
    }
    return null;
}

function consultarDeuda($tipo, $cuenta, $fecha = null, $listado = 'TASA') {
    $tipo    = strtolower(trim($tipo));
    $cuenta  = trim((string)$cuenta);
    $fecha   = $fecha ?: date('Y-m-d');
    $listado = strtoupper($listado) === 'PPAGO' ? 'PPAGO' : 'TASA';

    $cfgs = [
        'inmbl' => ['let'=>'I','cc'=>'ING_CC_INM','con'=>'ING_CON_INMUEBLES',     'rec'=>'ING_RECURSOS_INM','col'=>'NRO_INMUEBLE','recursos'=>"'31','03','07'"],
        'comrc' => ['let'=>'C','cc'=>'ING_CC_COM','con'=>'ING_CON_COMERCIOS',     'rec'=>'ING_RECURSOS_COM','col'=>'NRO_COMERCIO','recursos'=>"'02','24'"],
        'vehic' => ['let'=>'R','cc'=>'ING_CC_ROD','con'=>'ING_CON_RODADOS',       'rec'=>'ING_RECURSOS_ROD','col'=>'NRO_RODADO',  'recursos'=>"'06','41'"],
        'contr' => ['let'=>'N','cc'=>'ING_CC_CON','con'=>'ING_CON_CONTRIBUYENTES','rec'=>'ING_RECURSOS_CON','col'=>'NRO_CONTRIB', 'recursos'=>"'11','34'"],
    ];
    if (!isset($cfgs[$tipo])) return ['status'=>'error','message'=>'tipo invalido'];
    $cfg = $cfgs[$tipo];

    $ts = strtotime($fecha);
    if ($ts === false) return ['status'=>'error','message'=>'fecha invalida'];
    $fchPago = date('d/m/Y', $ts);

    $O         = 'OWNER_RAFAM.';
    $oraUser   = RAFAM_ORAUSER;
    $idSesion  = uniqid('bot_', true);
    $idConsult = '0';

    // 1) Lookup imponible -> nro_contrib + clave interna
    if ($tipo === 'inmbl' || $tipo === 'comrc') {
        $cta = (int)$cuenta;
        $col = $cfg['col'];
        $sql = "SELECT C.Apynom, C.Cuim, C.Nro_Contrib
                FROM {$O}{$cfg['con']} CON, {$O}ING_CONTRIBUYENTES C
                WHERE CON.$col = $cta AND CON.Titular='S' AND C.Nro_Contrib = CON.Nro_Contrib";
        $r = ejecutaRfm($sql);
        if ($r === 'Error') return ['status'=>'error','message'=>'sin conexion a RAFAM'];
        if (empty($r))      return ['status'=>'notfound','message'=>'No se encontraron datos del imponible'];
        $nroContrib = $r[0]['NRO_CONTRIB']; $impKey = $cta; $titular = $r[0]['APYNOM'];
    } elseif ($tipo === 'vehic') {
        $dominio = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $cuenta));
        $sql = "SELECT Imp.Nro_Rodado, C.Apynom, C.Cuim, C.Nro_Contrib
                FROM {$O}ING_RODADOS Imp, {$O}ING_CON_RODADOS CON, {$O}ING_CONTRIBUYENTES C
                WHERE CON.Nro_Rodado = IMP.Nro_Rodado AND CON.Titular='S'
                  AND C.Nro_Contrib = CON.Nro_Contrib AND Imp.Dominio = '$dominio'";
        $r = ejecutaRfm($sql);
        if ($r === 'Error') return ['status'=>'error','message'=>'sin conexion a RAFAM'];
        if (empty($r))      return ['status'=>'notfound','message'=>'No se encontraron datos del dominio'];
        $nroContrib = $r[0]['NRO_CONTRIB']; $impKey = $r[0]['NRO_RODADO']; $titular = $r[0]['APYNOM'];
    } else { // contr
        $cuit = preg_replace('/[^0-9]/', '', $cuenta);
        $sql = "SELECT Nro_Contrib, CUIM, ApyNom
                FROM {$O}ING_CONTRIBUYENTES
                WHERE REPLACE(CUIM,'-','') = '$cuit' AND NRO_CONTRIB <> 1";
        $r = ejecutaRfm($sql);
        if ($r === 'Error') return ['status'=>'error','message'=>'sin conexion a RAFAM'];
        if (empty($r))      return ['status'=>'notfound','message'=>'No se encontro el contribuyente'];
        $nroContrib = $r[0]['NRO_CONTRIB']; $impKey = $nroContrib; $titular = $r[0]['APYNOM'];
    }

    // 2) Tabla temporal + procedimientos de calculo (misma secuencia que el sitio)
    $col = $cfg['col'];
    ejecutaRfm("DELETE FROM {$O}ING_TMP_CC WHERE usuario = $oraUser AND idsesion = '$idSesion' AND idconsulta = '$idConsult'");

    $insert = "INSERT INTO {$O}ING_TMP_CC (usuario, recurso, anio, cuota, tipo_imp, nro_imp, orden, periodo, concepto_cc, descripcion, monto_origen, monto_act, monto_int, monto_total, fecha_vto, tipo_comprob, nro_comprob, nro_contrib, descr_abrev, descr_recurso, situacion, estado, monto_iva, nro_plan, descr_abrev_cc, marcado, monto_multa, observaciones, idsesion, idconsulta, remesa, fecha_tol, porc_aplicar, situacion_pos_acred, expediente_nro, expediente_anio)
SELECT $oraUser Usuario, CC.Recurso, CC.Anio, CC.Cuota, '{$cfg['let']}' Imponible, CC.$col Nro_Impo, CC.Orden, (CC.Anio*1000+CC.Cuota) Periodo, CC.Concepto_CC, CCTE.Descripcion, CC.Monto_Original, 0,0,0, CC.Fecha_Vto, CC.Tipo_Comprob, CC.Nro_Comprob, $nroContrib Nro_Contrib, CCTE.Descr_Abrev, R.Descripcion, CC.Situacion, CC.Estado, 0, CC.Nro_Plan, cc.descr_Abrev, 'N', 0, SUBSTR(DECODE(cc.observaciones,NULL,'',cc.observaciones||' - ')||DECODE(cc.fecha_reconoc_deuda,NULL,' ',' Deuda Reconocida al: '||cc.fecha_reconoc_deuda)||CO.observaciones,1,500), '$idSesion', '$idConsult', RI.remesa, null, cc.porc_aplicar, cc.situacion_pos_acred, cc.expediente_nro, cc.expediente_anio
FROM {$O}{$cfg['cc']} CC, {$O}ING_RECURSOS_CTOS_CC CCTE, {$O}{$cfg['con']} C, {$O}ING_RECURSOS R, {$O}ING_COMPR_OBS CO, {$O}{$cfg['rec']} RI
WHERE C.Nro_Contrib = $nroContrib AND CC.$col = $impKey AND CC.Recurso IN ({$cfg['recursos']}) AND C.Titular='S' AND CC.$col = C.$col AND CC.Concepto_CC = CCTE.Concepto_CC AND CC.Recurso = CCTE.Recurso AND CC.Recurso = R.Recurso AND CC.Estado <> 'C' AND CC.tipo_comprob = CO.tipo_comprob(+) AND CC.nro_comprob = CO.nro_comprob(+) AND CC.$col = RI.$col AND CC.Recurso = RI.Recurso";
    ejecutaRfm($insert);

    $pz = [':PUSUARIO'=>(int)$oraUser, ':PTABLA'=>'C', ':PIDSESION'=>$idSesion, ':PIDCONSULTA'=>$idConsult];
    $pp = $pz + [':PFECHAPAGO'=>$fchPago, ':V001'=>'<OutParam>'];

    ejecutaRfm("BEGIN {$O}ING_ACTUALIZAR_FECHATOL_CC(:PUSUARIO,:PTABLA,:PIDSESION,:PIDCONSULTA);end;", $pz);
    ejecutaRfm("BEGIN {$O}ING_CALC_ACTUALIZACION(:PUSUARIO,:PFECHAPAGO,:PTABLA,:V001,:PIDSESION,:PIDCONSULTA);end;", $pp);
    ejecutaRfm("BEGIN {$O}ING_CALC_INTERESES(:PUSUARIO,:PFECHAPAGO,:PTABLA,:V001,:PIDSESION,:PIDCONSULTA);end;", $pp);
    ejecutaRfm("BEGIN {$O}ING_CALC_IVA(:PUSUARIO,:PTABLA,:PIDSESION,:PIDCONSULTA);end;", $pz);
    ejecutaRfm("BEGIN {$O}ing_cta_cte_Actual_PPago(:PUSUARIO,:PTABLA,:PIDSESION,:PIDCONSULTA);end;", $pz);

    // 3) Resultado
    $sel = "SELECT {$O}ing_get_cuotaanio(anio, Cuota) PeriodoChar, Recurso, descr_Abrev_cc, cc.Descripcion, Fecha_Vto, Monto_origen, Monto_Act, Monto_Iva, Monto_Int, Monto_Total, Anio, Cuota, Orden, Situacion, Est.Codigo Estado, CC.Nro_Plan, Nro_Imp
            FROM {$O}ING_TMP_CC CC, {$O}ING_SITUACION_CC Sit, {$O}ING_ESTADO_CC Est
            WHERE cc.usuario = $oraUser AND cc.situacion = sit.codigo AND cc.Estado = Est.Codigo AND cc.idsesion = '$idSesion' ";
    if ($listado === 'TASA') {
        $sel .= "AND ANIO > 0 AND ESTADO <> 'P' ";
    } else {
        $sel .= "AND ANIO = 0 AND CUOTA > 0 AND NRO_PLAN > 0 AND ESTADO = 'D' AND SITUACION NOT IN ('J','W') ";
    }
    $sel .= "ORDER BY anio, cuota, orden, Nro_Imp, Recurso";
    $filas = ejecutaRfm($sel);

    ejecutaRfm("DELETE FROM {$O}ING_TMP_CC WHERE usuario = $oraUser AND idsesion = '$idSesion' AND idconsulta = '$idConsult'");

    if ($filas === 'Error') return ['status'=>'error','message'=>'sin conexion a RAFAM'];
    if (!is_array($filas))  $filas = [];

    $items = []; $total = 0.0;
    foreach ($filas as $f) {
        $total += (float)$f['MONTO_TOTAL'];
        $items[] = [
            'periodo'      => $f['PERIODOCHAR'],
            'recurso'      => $f['RECURSO'],
            'descripcion'  => $f['DESCRIPCION'],
            'fecha_vto'    => $f['FECHA_VTO'],
            'monto_origen' => (float)$f['MONTO_ORIGEN'],
            'monto_actual' => (float)$f['MONTO_ACT'],
            'monto_int'    => (float)$f['MONTO_INT'],
            'monto_total'  => (float)$f['MONTO_TOTAL'],
            'situacion'    => $f['SITUACION'],
        ];
    }

    return [
        'status'        => 'success',
        'tipo'          => $tipo,
        'cuenta'        => $cuenta,
        'contribuyente' => $titular,
        'nro_contrib'   => $nroContrib,
        'fecha_pago'    => $fchPago,
        'listado'       => $listado,
        'cantidad'      => count($items),
        'total'         => round($total, 2),
        'items'         => $items,
    ];
}
