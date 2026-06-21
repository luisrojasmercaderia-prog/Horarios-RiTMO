import React, { useState } from "react";
import { Clock, CheckCircle2, AlertCircle, LogIn, LogOut as LogOutIcon } from "lucide-react";
import { supabase } from "./supabaseClient";

// ─── Funciones replicadas de HorariosTienda.jsx para mantener exactamente la
// misma lógica de cálculo al fichar (horas reales, saldo, horas nocturnas). ───

function formatFechaISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatHoraISO(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Domingo de la semana calendario que contiene "fecha" — misma clave que usa
// HorariosTienda.jsx para identificar cada semana en Supabase.
function getDomingoDeSemana(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

const MIN_HORAS_PARA_BREAK = 3;

function calcularHorasRealesDesdeLlegadaSalida(llegadaReal, salidaReal) {
  if (!llegadaReal || !salidaReal) return "";
  const [lh, lm] = llegadaReal.split(":").map(Number);
  const [sh, sm] = salidaReal.split(":").map(Number);
  if (isNaN(lh) || isNaN(lm) || isNaN(sh) || isNaN(sm)) return "";
  let llegadaMin = lh * 60 + lm;
  let salidaMin = sh * 60 + sm;
  if (salidaMin < llegadaMin) salidaMin += 24 * 60;
  const minutosBrutos = salidaMin - llegadaMin;
  const minutosTotales = minutosBrutos >= MIN_HORAS_PARA_BREAK * 60 ? minutosBrutos - 60 : minutosBrutos;
  if (minutosTotales <= 0) return "0";
  const horas = minutosTotales / 60;
  return horas % 1 === 0 ? String(horas) : horas.toFixed(1);
}

function calcSaldo(prog, real) {
  const p = parseFloat(prog);
  const r = parseFloat(real);
  if (isNaN(p) || isNaN(r)) return "";
  const diff = r - p;
  return diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
}

const INICIO_NOCTURNO_MIN = 21 * 60;

function calcularHorasNocturnas(horaSalida) {
  if (!horaSalida) return "";
  const [h, m] = horaSalida.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  let salidaMin = h * 60 + m;
  if (salidaMin < INICIO_NOCTURNO_MIN && salidaMin < 6 * 60) salidaMin += 24 * 60;
  if (salidaMin <= INICIO_NOCTURNO_MIN) return "0";
  const minutosNocturnos = salidaMin - INICIO_NOCTURNO_MIN;
  const horas = minutosNocturnos / 60;
  return horas % 1 === 0 ? String(horas) : horas.toFixed(1);
}

/**
 * Componente de fichaje por cédula. Pensado para insertarse en la pantalla de
 * login de la tienda (o como sección/modal aparte) sin requerir que el
 * operario tenga acceso a la planilla completa.
 *
 * Flujo:
 * 1. El operario escribe su cédula y pulsa "Fichar".
 * 2. Se busca, en la semana actual (Domingo a Sábado) de esa tienda, el día de
 *    HOY y la fila cuya cédula coincida.
 * 3. Si la fila no tiene Llegada Real → se registra como ENTRADA (hora actual).
 * 4. Si ya tiene Llegada Real pero no Salida Real → se registra como SALIDA.
 * 5. Si ya tiene ambas → se informa que el fichaje del día ya está completo.
 *
 * Este componente es autocontenido: el operario ingresa tanto el código de
 * tienda como su cédula (sin contraseña), pensado para usarse desde la
 * pantalla pública de login, sin necesitar las credenciales del supervisor.
 */
export default function Fichaje({ onCerrar }) {
  const [codigoTienda, setCodigoTienda] = useState("");
  const [cedula, setCedula] = useState("");
  const [estado, setEstado] = useState("idle"); // idle | buscando | ok | error
  const [mensaje, setMensaje] = useState("");
  const [detalle, setDetalle] = useState(null); // { nombre, tipo: 'entrada'|'salida', hora }

  const handleFichar = async (e) => {
    e.preventDefault();
    const cedulaLimpia = cedula.trim();
    const codigoLimpio = codigoTienda.trim().toUpperCase();
    if (!cedulaLimpia || !codigoLimpio) return;

    setEstado("buscando");
    setMensaje("");
    setDetalle(null);

    try {
      // Verificamos primero que el código de tienda exista.
      const { data: tiendaData, error: errorTienda } = await supabase
        .from("tiendas")
        .select("codigo")
        .eq("codigo", codigoLimpio)
        .maybeSingle();

      if (errorTienda || !tiendaData) {
        setEstado("error");
        setMensaje("No existe una tienda con ese código. Verifica e intenta de nuevo.");
        return;
      }

      const ahora = new Date();
      const hoyISO = formatFechaISO(ahora);
      const horaActual = formatHoraISO(ahora);
      const semanaKey = formatFechaISO(getDomingoDeSemana(ahora));

      const { data, error } = await supabase
        .from("horarios_semana")
        .select("datos")
        .eq("tienda_codigo", codigoLimpio)
        .eq("semana_fecha", semanaKey)
        .maybeSingle();

      if (error || !data || !data.datos || !data.datos.days) {
        setEstado("error");
        setMensaje("No se encontró la planilla de esta semana para tu tienda. Avisa a tu supervisor.");
        return;
      }

      const datos = data.datos;
      const diaHoy = datos.days.find((d) => d.fechaDate === hoyISO);

      if (!diaHoy) {
        setEstado("error");
        setMensaje("No se encontró el día de hoy en la planilla. Avisa a tu supervisor.");
        return;
      }

      const entry = diaHoy.entries.find((e) => e.cedula && e.cedula.trim() === cedulaLimpia);

      if (!entry) {
        setEstado("error");
        setMensaje("No estás programado en la planilla de hoy para esta tienda. Avisa a tu supervisor.");
        return;
      }

      if (entry.llegadaReal && entry.salidaReal) {
        setEstado("error");
        setMensaje(`${entry.nombre}, ya registraste tu entrada (${entry.llegadaReal}) y tu salida (${entry.salidaReal}) hoy.`);
        return;
      }

      let tipo;
      if (!entry.llegadaReal) {
        // Fichaje de ENTRADA
        entry.llegadaReal = horaActual;
        tipo = "entrada";
      } else {
        // Fichaje de SALIDA
        entry.salidaReal = horaActual;
        tipo = "salida";
      }

      // Recalculamos horas reales / saldo / horas nocturnas igual que lo haría
      // la planilla al editar manualmente estos campos.
      entry.horasReales = calcularHorasRealesDesdeLlegadaSalida(entry.llegadaReal, entry.salidaReal);
      entry.saldo = calcSaldo(entry.horasProgramadas, entry.horasReales);
      entry.horasNocturnas = calcularHorasNocturnas(entry.salidaReal || entry.salida);

      const { error: errorUpdate } = await supabase
        .from("horarios_semana")
        .update({ datos, updated_at: new Date().toISOString() })
        .eq("tienda_codigo", codigoLimpio)
        .eq("semana_fecha", semanaKey);

      if (errorUpdate) {
        setEstado("error");
        setMensaje("No se pudo guardar el fichaje. Intenta de nuevo.");
        return;
      }

      setEstado("ok");
      setDetalle({ nombre: entry.nombre, tipo, hora: horaActual });
      setMensaje("");
      setCedula("");
    } catch (e) {
      setEstado("error");
      setMensaje("Ocurrió un error inesperado. Intenta de nuevo.");
    }
  };

  return (
    <div
      style={{
        background: "white",
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        padding: 28,
        maxWidth: 380,
        width: "100%",
        fontFamily: "'Inter', system-ui, sans-serif",
        position: "relative",
      }}
    >
      {onCerrar && (
        <button
          type="button"
          onClick={onCerrar}
          title="Cerrar"
          style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", cursor: "pointer", color: "#5C5F5A" }}
        >
          ✕
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Clock size={20} color="#E85D1F" />
        <div style={{ fontSize: 17, fontWeight: 700, color: "#241C14" }}>Registro de entrada / salida</div>
      </div>
      <div style={{ fontSize: 12.5, color: "#5C5F5A", marginBottom: 20 }}>
        Escribe el código de tu tienda y tu cédula para registrar tu hora de llegada o de salida de hoy.
      </div>

      <form onSubmit={handleFichar}>
        <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>
          Código de tienda
        </label>
        <input
          value={codigoTienda}
          onChange={(e) => setCodigoTienda(e.target.value)}
          placeholder="Ej. RIT-014"
          autoFocus
          style={{
            width: "100%",
            border: "1px solid #DEDBD2",
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 16,
            fontFamily: "inherit",
            background: "#FAFAF8",
            outline: "none",
            color: "#241C14",
            marginBottom: 14,
            boxSizing: "border-box",
          }}
        />
        <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>
          Tu cédula
        </label>
        <input
          value={cedula}
          onChange={(e) => setCedula(e.target.value)}
          placeholder="Tu cédula"
          style={{
            width: "100%",
            border: "1px solid #DEDBD2",
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 16,
            fontFamily: "inherit",
            background: "#FAFAF8",
            outline: "none",
            color: "#241C14",
            marginBottom: 14,
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={estado === "buscando" || cedula.trim() === "" || codigoTienda.trim() === ""}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "#E85D1F",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 700,
            cursor: estado === "buscando" ? "default" : "pointer",
            opacity: cedula.trim() === "" ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          <Clock size={16} />
          {estado === "buscando" ? "Verificando..." : "Fichar"}
        </button>
      </form>

      {estado === "ok" && detalle && (
        <div
          style={{
            marginTop: 18,
            background: "#E8F5E9",
            border: "1px solid #2E7D32",
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <CheckCircle2 size={20} color="#2E7D32" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1B5E20" }}>
              {detalle.tipo === "entrada" ? "Entrada registrada" : "Salida registrada"}
            </div>
            <div style={{ fontSize: 13, color: "#2E7D32", marginTop: 2 }}>
              {detalle.nombre} — {detalle.hora}
            </div>
          </div>
        </div>
      )}

      {estado === "error" && mensaje && (
        <div
          style={{
            marginTop: 18,
            background: "#FCEBEB",
            border: "1px solid #B3261E",
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <AlertCircle size={20} color="#B3261E" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: "#791F1F" }}>{mensaje}</div>
        </div>
      )}
    </div>
  );
}
