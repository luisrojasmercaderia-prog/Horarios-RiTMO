import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Printer, Clock, AlertCircle, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet, LogOut, Users, X, Lock, Unlock, ChevronLeft, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import logoRitmo from "./logo-ritmo.png";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ─── Tolerancias de fichaje ───
// Si el operario llega tarde pero dentro de este margen, se usa la hora programada.
// Si sale un poco después pero dentro de este margen, se usa la hora programada.
const TOLERANCIA_ENTRADA_MIN = 10; // minutos de gracia en llegada
const TOLERANCIA_SALIDA_MIN  = 15; // minutos de gracia en salida

// ─── Lógica de periodos de nómina (corte del día 20) ───
function getRangoPeriodo(anio, mes) {
  const fin = new Date(anio, mes - 1, 20);
  const inicio = new Date(anio, mes - 2, 21);
  return { inicio, fin };
}

function formatFechaCorta(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatFechaISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const NOMBRES_MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function getPeriodoLabel(anio, mes) {
  return `${NOMBRES_MESES[mes - 1]} ${anio}`;
}

function getSemanasDelPeriodo(anio, mes) {
  const { inicio, fin } = getRangoPeriodo(anio, mes);
  const semanas = [];
  const cursor = new Date(inicio);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  while (cursor <= fin) {
    const semana = [];
    for (let i = 0; i < 7; i++) {
      const dia = new Date(cursor);
      dia.setDate(cursor.getDate() + i);
      if (dia >= inicio && dia <= fin) {
        semana.push(dia);
      } else {
        semana.push(null);
      }
    }
    semanas.push(semana);
    cursor.setDate(cursor.getDate() + 7);
  }
  return semanas;
}

function getDomingoDeSemana(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getDiasDeSemana(fechaDomingo) {
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const dia = new Date(fechaDomingo);
    dia.setDate(fechaDomingo.getDate() + i);
    dias.push(dia);
  }
  return dias;
}

function desplazarSemana(fechaDomingo, n) {
  const d = new Date(fechaDomingo);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function emptyEntry(id) {
  return {
    id,
    estado: "",
    fecha: "",
    nombre: "",
    cedula: "",
    llegada: "",
    salida: "",
    breakInicio: "",
    breakFin: "",
    horasProgramadas: "",
    llegadaReal: "",
    salidaReal: "",
    horasReales: "",
    esFestivo: false,
    horasNocturnas: "",
    saldo: "",
    firma: "",
    observacion: "",
    validado: false,
    enviadoRRHH: false,
    fechaRegistroNovedad: "",
  };
}

const ROWS_PER_DAY = 5;

function emptyDay(dia, idStart, fechaDate) {
  return {
    dia,
    fechaDate: fechaDate ? formatFechaISO(fechaDate) : null,
    entries: Array.from({ length: ROWS_PER_DAY }, (_, i) => {
      const e = emptyEntry(idStart + i);
      if (fechaDate) e.fecha = formatFechaCorta(fechaDate);
      return e;
    }),
  };
}

function calcSaldo(prog, real) {
  const p = parseFloat(prog);
  const r = parseFloat(real);
  if (isNaN(p) || isNaN(r)) return "";
  const diff = Math.round((r - p) * 100) / 100;
  return diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
}

const LIMITE_HORAS_FERIADO = 8;

function calcularExtraFeriada(dia, entry) {
  const esDomingo = dia === "Domingo";
  const esDiaFeriado = esDomingo || entry.esFestivo;
  if (!esDiaFeriado) return 0;
  const realesNum = parseFloat(entry.horasReales) || 0;
  const excedente = realesNum - LIMITE_HORAS_FERIADO;
  return excedente > 0 ? excedente : 0;
}

const MIN_HORAS_PARA_BREAK = 3;

// ─── Cálculo de horas reales CON tolerancias de fichaje ───
// - Entrada: si llegó tarde pero dentro de TOLERANCIA_ENTRADA_MIN, se usa la hora programada.
// - Salida:  si salió después pero dentro de TOLERANCIA_SALIDA_MIN, se usa la hora programada.
function calcularHorasRealesDesdeLlegadaSalida(llegadaReal, salidaReal, llegadaProg, salidaProg) {
  if (!llegadaReal || !salidaReal) return "";

  const toMin = (hora) => {
    const [h, m] = hora.split(":").map(Number);
    return isNaN(h) || isNaN(m) ? null : h * 60 + m;
  };

  let llegadaMin = toMin(llegadaReal);
  let salidaMin  = toMin(salidaReal);
  if (llegadaMin === null || salidaMin === null) return "";
  if (salidaMin < llegadaMin) salidaMin += 24 * 60;

  // Tolerancia de ENTRADA
  if (llegadaProg) {
    const llegadaProgMin = toMin(llegadaProg);
    if (
      llegadaProgMin !== null &&
      llegadaMin > llegadaProgMin &&
      llegadaMin <= llegadaProgMin + TOLERANCIA_ENTRADA_MIN
    ) {
      llegadaMin = llegadaProgMin;
    }
  }

  // Tolerancia de SALIDA
  if (salidaProg) {
    const salidaProgMin = toMin(salidaProg);
    if (salidaProgMin !== null) {
      let salidaProgAdj = salidaProgMin;
      // Ajuste por cruce de medianoche en la salida programada
      if (salidaProgAdj < toMin(llegadaReal)) salidaProgAdj += 24 * 60;
      if (
        salidaMin > salidaProgAdj &&
        salidaMin <= salidaProgAdj + TOLERANCIA_SALIDA_MIN
      ) {
        salidaMin = salidaProgAdj;
      }
    }
  }

  const minutosBrutos = salidaMin - llegadaMin;
  const minutosTotales = minutosBrutos >= MIN_HORAS_PARA_BREAK * 60 ? minutosBrutos - 60 : minutosBrutos;
  if (minutosTotales <= 0) return "0";
  const horas = minutosTotales / 60;
  return horas % 1 === 0 ? String(horas) : horas.toFixed(1);
}

function esNoLaborable(estado) {
  return ["descanso", "incapacitado", "licencia_maternidad", "luto", "vacaciones"].includes(estado);
}

function esNovedadRRHH(estado) {
  return ["incapacitado", "licencia_maternidad", "luto"].includes(estado);
}

const DIAS_LIMITE_ENVIO_RRHH = 3;

function diasVencidosRRHH(entry) {
  if (!esNovedadRRHH(entry.estado) || entry.enviadoRRHH || !entry.fechaRegistroNovedad) return null;
  const fechaRegistro = new Date(entry.fechaRegistroNovedad + "T00:00:00");
  const hoy = new Date();
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diffMs = hoySinHora - fechaRegistro;
  const diffDias = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDias;
}

const TURNOS_FIJOS = {
  jornada_44: { llegada: "07:30", salida: "15:00", horasProgramadas: "6.5", breakEditable: true },
  jornada_44_tarde: { llegada: "14:30", salida: "22:00", horasProgramadas: "6.5", breakEditable: true },
  t_inventario_manana: { llegada: "06:00", salida: "14:30", horasProgramadas: "7.5" },
  domingo_t_manana: { llegada: "07:30", salida: "15:00", horasProgramadas: "6.5", breakEditable: true },
  domingo_t_tarde: { llegada: "12:30", salida: "20:00", horasProgramadas: "6.5", breakEditable: true },
  feriado_manana: { llegada: "07:30", salida: "15:30", horasProgramadas: "6.5", breakEditable: true, esFestivoAuto: true },
  feriado_tarde: { llegada: "12:30", salida: "20:00", horasProgramadas: "6.5", breakEditable: true, esFestivoAuto: true },
};

function esTurnoFijo(estado) {
  return Object.prototype.hasOwnProperty.call(TURNOS_FIJOS, estado);
}

function calcularDuracionHoras(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return null;
  const [ih, im] = horaInicio.split(":").map(Number);
  const [fh, fm] = horaFin.split(":").map(Number);
  if (isNaN(ih) || isNaN(im) || isNaN(fh) || isNaN(fm)) return null;
  let inicioMin = ih * 60 + im;
  let finMin = fh * 60 + fm;
  if (finMin < inicioMin) finMin += 24 * 60;
  return (finMin - inicioMin) / 60;
}

function horaAMinutos(hora) {
  if (!hora) return null;
  const [h, m] = hora.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutosAHora(minutos) {
  const minNorm = ((minutos % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(minNorm / 60);
  const m = Math.round(minNorm % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function turnoMuyCortoParaBreak(entry) {
  const horasProg = parseFloat(entry.horasProgramadas);
  if (!isNaN(horasProg)) return horasProg < MIN_HORAS_PARA_BREAK;
  const duracionProgramada = calcularDuracionHoras(entry.llegada, entry.salida);
  if (duracionProgramada !== null) return duracionProgramada < MIN_HORAS_PARA_BREAK;
  const duracionReal = calcularDuracionHoras(entry.llegadaReal, entry.salidaReal);
  if (duracionReal !== null) return duracionReal < MIN_HORAS_PARA_BREAK;
  return false;
}

function estaBloqueado(entry) {
  return entry.estado.trim() === "" || esNoLaborable(entry.estado) || esTurnoFijo(entry.estado) || entry.cedula.trim() === "";
}

function parcialBloqueado(entry) {
  if (turnoMuyCortoParaBreak(entry)) return true;
  if (esTurnoFijo(entry.estado) && TURNOS_FIJOS[entry.estado].breakEditable) {
    return esNoLaborable(entry.estado) || entry.cedula.trim() === "";
  }
  return estaBloqueado(entry);
}

const HORARIOS_PREDETERMINADOS = {
  "06:00": "14:30",
  "07:00": "15:30",
  "07:30": "16:00",
  "12:30": "20:00",
  "13:30": "22:00",
};

const TURNO_MANANA_SALIDAS = ["14:30", "15:30", "16:00"];
const TURNO_TARDE_SALIDAS = ["22:00"];
const TURNO_MANANA_LLEGADAS = ["06:00", "07:00", "07:30"];
const TURNO_TARDE_LLEGADAS = ["13:30"];

function getTurnoDesdeSalida(salida) {
  if (TURNO_MANANA_SALIDAS.includes(salida)) return "manana";
  if (TURNO_TARDE_SALIDAS.includes(salida)) return "tarde";
  return null;
}

function getLlegadasValidasDesdeTurno(turno) {
  if (turno === "manana") return TURNO_MANANA_LLEGADAS;
  if (turno === "tarde") return TURNO_TARDE_LLEGADAS;
  return [];
}

function sumarUnaHora(hora) {
  if (!hora) return null;
  const [h, m] = hora.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const totalMin = (h * 60 + m + 60) % (24 * 60);
  const nuevaH = Math.floor(totalMin / 60);
  const nuevaM = totalMin % 60;
  return `${String(nuevaH).padStart(2, "0")}:${String(nuevaM).padStart(2, "0")}`;
}

const MAX_HORAS_PARA_BREAK = 5;
const PASO_AJUSTE_COLISION_MIN = 15;

function calcularBreakPredeterminado(llegada, entriesMismoTurno, entryIdActual) {
  const llegadaMin = horaAMinutos(llegada);
  if (llegadaMin === null) return null;

  const minimoMin = llegadaMin + MIN_HORAS_PARA_BREAK * 60;
  const maximoMin = llegadaMin + MAX_HORAS_PARA_BREAK * 60;
  const DURACION_BREAK_MIN = 60;

  const rangosOcupados = entriesMismoTurno
    .filter((e) => e.id !== entryIdActual && e.breakInicio)
    .map((e) => {
      const inicio = horaAMinutos(e.breakInicio);
      return inicio === null ? null : { inicio, fin: inicio + DURACION_BREAK_MIN };
    })
    .filter((r) => r !== null);

  const seCruza = (candidatoInicio) => {
    const candidatoFin = candidatoInicio + DURACION_BREAK_MIN;
    return rangosOcupados.some((r) => candidatoInicio < r.fin && candidatoFin > r.inicio);
  };

  for (let candidato = maximoMin; candidato >= minimoMin; candidato -= PASO_AJUSTE_COLISION_MIN) {
    if (!seCruza(candidato)) {
      return minutosAHora(candidato);
    }
  }
  return minutosAHora(maximoMin);
}

function resolverCrucesBreak(entries) {
  const grupos = {};
  entries.forEach((e) => {
    if (e.nombre.trim() === "" || !e.llegada || !e.salida || !e.breakInicio) return;
    const clave = `${e.llegada}|${e.salida}`;
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(e);
  });

  const idsAjustados = {};
  Object.values(grupos).forEach((grupo) => {
    if (grupo.length < 2) return;
    const ordenado = [...grupo].sort((a, b) => a.id - b.id);
    const fijos = [ordenado[0]];
    for (let i = 1; i < ordenado.length; i++) {
      const actual = ordenado[i];
      const inicioActual = horaAMinutos(actual.breakInicio);
      const finActual = inicioActual !== null ? inicioActual + 60 : null;
      const seCruzaConFijos = fijos.some((f) => {
        const inicioF = horaAMinutos(f.breakInicio);
        const finF = inicioF !== null ? inicioF + 60 : null;
        if (inicioActual === null || finActual === null || inicioF === null || finF === null) return false;
        return inicioActual < finF && finActual > inicioF;
      });
      if (seCruzaConFijos) {
        const nuevoBreak = calcularBreakPredeterminado(actual.llegada, fijos, actual.id);
        if (nuevoBreak && nuevoBreak !== actual.breakInicio) {
          idsAjustados[actual.id] = { breakInicio: nuevoBreak, breakFin: sumarUnaHora(nuevoBreak) || "" };
        }
        fijos.push(idsAjustados[actual.id] ? { ...actual, breakInicio: nuevoBreak } : actual);
      } else {
        fijos.push(actual);
      }
    }
  });

  if (Object.keys(idsAjustados).length === 0) return entries;
  return entries.map((e) =>
    idsAjustados[e.id] ? { ...e, breakInicio: idsAjustados[e.id].breakInicio, breakFin: idsAjustados[e.id].breakFin } : e
  );
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

function getPeriodoActual(fechaRef) {
  const ref = fechaRef || new Date();
  const dia = ref.getDate();
  let anio = ref.getFullYear();
  let mes = ref.getMonth() + 1;

  if (dia >= 21) {
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }

  const semanas = getSemanasDelPeriodo(anio, mes);
  const refSinHora = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let semanaIdx = 0;
  for (let i = 0; i < semanas.length; i++) {
    const tieneFecha = semanas[i].some((d) => d && d.getTime() === refSinHora.getTime());
    if (tieneFecha) { semanaIdx = i; break; }
  }

  return { anio, mes, semanaIdx };
}

function limpiarEstadoFilasVacias(days) {
  return days.map((d) => ({
    ...d,
    entries: d.entries.map((e) =>
      e.nombre.trim() === "" && e.estado !== "" ? { ...e, estado: "" } : e
    ),
  }));
}

function diasVacios(semanaFechas) {
  let id = 1;
  return DIAS.map((d, idx) => {
    const fechaDate = semanaFechas ? semanaFechas[idx] : null;
    const day = emptyDay(d, id, fechaDate);
    id += ROWS_PER_DAY;
    return day;
  });
}

async function buscarEstadoGuardado(codigoTienda, fechaCalendario, cedula) {
  try {
    const domingoDeEsaSemana = getDomingoDeSemana(fechaCalendario);
    const semanaKeyBuscada = formatFechaISO(domingoDeEsaSemana);
    const { data, error } = await supabase
      .from("horarios_semana")
      .select("datos")
      .eq("tienda_codigo", codigoTienda)
      .eq("semana_fecha", semanaKeyBuscada)
      .maybeSingle();
    if (error || !data || !data.datos || !data.datos.days) return null;

    const fechaISO = formatFechaISO(fechaCalendario);
    for (const d of data.datos.days) {
      if (d.fechaDate === fechaISO) {
        const entry = d.entries.find((e) => e.cedula.trim() === cedula);
        if (entry) return entry.estado;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default function HorariosTienda({ codigoTienda, onSalir }) {
  const [tienda, setTienda] = useState("");
  const [codigo, setCodigo] = useState(codigoTienda);
  const [fecha, setFecha] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [completado, setCompletado] = useState(false);
  const [modoImpresion, setModoImpresion] = useState("planilla");
  const [fechaCompletado, setFechaCompletado] = useState("");
  const [days, setDays] = useState(diasVacios);
  const [nextId, setNextId] = useState(DIAS.length * ROWS_PER_DAY + 1);
  const [saveState, setSaveState] = useState("idle");
  const [loaded, setLoaded] = useState(false);
  const [showConsolidado, setShowConsolidado] = useState(false);
  const [diasAcumuladosPeriodo, setDiasAcumuladosPeriodo] = useState(null);
  const [cargandoConsolidado, setCargandoConsolidado] = useState(false);

  const hoy = new Date();
  const domingoInicial = getDomingoDeSemana(hoy);
  const [domingoSemanaActual, setDomingoSemanaActual] = useState(domingoInicial);

  const semanaFechasCompleta = getDiasDeSemana(domingoSemanaActual);
  const semanaFechas = semanaFechasCompleta;
  const semanaKey = formatFechaISO(domingoSemanaActual);
  const fechaInicioSemana = formatFechaISO(domingoSemanaActual);

  const periodoVisual = getPeriodoActual(domingoSemanaActual);
  const anioPeriodo = periodoVisual.anio;
  const mesPeriodo = periodoVisual.mes;

  const [empleados, setEmpleados] = useState([]);
  const [aprobaciones, setAprobaciones] = useState({});
  const [ocupacionOtrasTiendas, setOcupacionOtrasTiendas] = useState({});
  const [showEmpleados, setShowEmpleados] = useState(false);
  const [modoSupervisor, setModoSupervisor] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const SUPERVISOR_PASSWORD = "spv1234";

  const handleSupervisorClick = () => {
    if (modoSupervisor) {
      setModoSupervisor(false);
      return;
    }
    setPasswordInput("");
    setPasswordError("");
    setShowPasswordPrompt(true);
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === SUPERVISOR_PASSWORD) {
      setModoSupervisor(true);
      setShowPasswordPrompt(false);
      setPasswordInput("");
      setPasswordError("");
    } else {
      setPasswordError("Contraseña incorrecta. Intenta de nuevo.");
    }
  };

  const cargarAprobaciones = useCallback(async (semana) => {
    try {
      const { data } = await supabase
        .from("aprobaciones")
        .select("entry_id, estado")
        .eq("tienda_codigo", codigoTienda)
        .eq("semana_fecha", semana);
      const mapa = {};
      (data || []).forEach((a) => { mapa[a.entry_id] = a.estado; });
      setAprobaciones(mapa);
    } catch (e) {}
  }, [codigoTienda]);

  const cargarEmpleados = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("empleados")
        .select("id, nombre, cedula")
        .eq("tienda_codigo", codigoTienda)
        .order("nombre", { ascending: true });
      if (!error && data) setEmpleados(data);
    } catch (e) {}
  }, [codigoTienda]);

  useEffect(() => { cargarEmpleados(); }, [cargarEmpleados]);

  useEffect(() => {
    let activo = true;
    setLoaded(false);
    (async () => {
      try {
        const { data: tiendaData } = await supabase
          .from("tiendas").select("nombre").eq("codigo", codigoTienda).maybeSingle();
        if (activo && tiendaData) setTienda(tiendaData.nombre || "");

        const { data, error } = await supabase
          .from("horarios_semana").select("datos")
          .eq("tienda_codigo", codigoTienda).eq("semana_fecha", semanaKey).maybeSingle();

        if (!activo) return;

        if (!error && data && data.datos) {
          const saved = data.datos;
          if (saved.tienda) setTienda(saved.tienda);
          setFecha(saved.fecha || fechaInicioSemana);
          setSupervisor(saved.supervisor || "");
          setCompletado(!!saved.completado);
          setFechaCompletado(saved.fechaCompletado || "");
          const diasLimpios = saved.days && saved.days.length ? limpiarEstadoFilasVacias(saved.days) : diasVacios(semanaFechas);
          const diasSinCruces = diasLimpios.map((d) => ({ ...d, entries: resolverCrucesBreak(d.entries) }));
          setDays(diasSinCruces);
          setNextId(saved.nextId || DIAS.length * ROWS_PER_DAY + 1);
        } else {
          setFecha(fechaInicioSemana); setSupervisor(""); setDays(diasVacios(semanaFechas));
          setCompletado(false);
          setFechaCompletado("");
          setNextId(DIAS.length * ROWS_PER_DAY + 1);
        }
      } catch (e) {}
      finally {
        if (activo) setLoaded(true);
        if (activo) cargarAprobaciones(semanaKey);
      }
    })();
    return () => { activo = false; };
  }, [codigoTienda, semanaKey, cargarAprobaciones, fechaInicioSemana]);

  // Mapa de días que cada operario ya tiene trabajados en OTRAS tiendas
  // (clave: cedula__fechaDate → nombre de la tienda). Sirve para detectar que
  // un operario quede programado el mismo día en dos tiendas (doble conteo).
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [{ data: horarios }, { data: tiendas }] = await Promise.all([
          supabase.from("horarios_semana").select("tienda_codigo, datos"),
          supabase.from("tiendas").select("codigo, nombre"),
        ]);
        if (!activo) return;
        const nombreTienda = {};
        (tiendas || []).forEach((t) => { nombreTienda[t.codigo] = t.nombre; });
        const noLab = ["descanso", "incapacitado", "licencia_maternidad", "luto", "vacaciones"];
        const mapa = {};
        (horarios || []).forEach((h) => {
          if (h.tienda_codigo === codigoTienda) return; // excluir la tienda actual
          ((h.datos && h.datos.days) || []).forEach((d) => {
            const fecha = d.fechaDate || d.fecha;
            if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
            (d.entries || []).forEach((e) => {
              const cedula = (e.cedula || "").trim();
              if (!cedula || !(e.nombre || "").trim()) return;
              if (noLab.includes(e.estado) || !(e.estado || "").trim()) return; // solo días laborables
              mapa[`${cedula}__${fecha}`] = nombreTienda[h.tienda_codigo] || h.tienda_codigo;
            });
          });
        });
        if (activo) setOcupacionOtrasTiendas(mapa);
      } catch (e) { /* silencioso */ }
    })();
    return () => { activo = false; };
  }, [codigoTienda, semanaKey]);

  const persist = useCallback(async (state, semanaKey) => {
    setSaveState("saving");
    try {
      const { error } = await supabase.from("horarios_semana").upsert(
        { tienda_codigo: codigoTienda, semana_fecha: semanaKey, datos: state, updated_at: new Date().toISOString() },
        { onConflict: "tienda_codigo,semana_fecha" }
      );
      if (error) throw error;
      setSaveState("saved");
    } catch (e) { setSaveState("error"); }
  }, [codigoTienda]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      persist({ tienda, codigo, fecha, supervisor, days, nextId, completado, fechaCompletado }, semanaKey);
    }, 600);
    return () => clearTimeout(t);
  }, [tienda, codigo, fecha, supervisor, days, nextId, completado, fechaCompletado, loaded, persist, semanaKey]);

  const updateEntry = async (dia, entryId, field, value) => {
    if (field === "estado" && value === "descanso" && (dia === "Sábado" || dia === "Domingo")) {
      const diaActual = days.find((d) => d.dia === dia);
      const entryActual = diaActual?.entries.find((e) => e.id === entryId);
      if (entryActual && entryActual.cedula.trim() && diaActual.fechaDate) {
        const cedula = entryActual.cedula.trim();
        const fechaBase = new Date(diaActual.fechaDate + "T00:00:00");
        const fechaAdyacente = new Date(fechaBase);
        let nombreDiaAdyacente;
        if (dia === "Sábado") {
          fechaAdyacente.setDate(fechaAdyacente.getDate() + 1);
          nombreDiaAdyacente = "Domingo";
        } else {
          fechaAdyacente.setDate(fechaAdyacente.getDate() - 1);
          nombreDiaAdyacente = "Sábado";
        }

        let estadoAdyacente = null;
        const diaAdyacenteEnPantalla = days.find(
          (d) => d.fechaDate === formatFechaISO(fechaAdyacente)
        );
        if (diaAdyacenteEnPantalla) {
          const entryAdy = diaAdyacenteEnPantalla.entries.find((e) => e.cedula.trim() === cedula);
          if (entryAdy) estadoAdyacente = entryAdy.estado;
        } else {
          await persist({ tienda, codigo, fecha, supervisor, days, nextId, completado, fechaCompletado }, semanaKey);
          estadoAdyacente = await buscarEstadoGuardado(codigoTienda, fechaAdyacente, cedula);
        }

        if (estadoAdyacente === "descanso") {
          alert(`⚠️ No se puede asignar descanso este ${dia}.\n\nEste colaborador ya tiene descanso programado el ${nombreDiaAdyacente} (${formatFechaCorta(fechaAdyacente)}). No está permitido descansar el Sábado saliente y el Domingo entrante de forma continua.`);
          return;
        }
      }
    }

    const entryParaChequeo = days.find((d) => d.dia === dia)?.entries.find((e) => e.id === entryId);
    const estadoEfectivo = field === "estado" ? value : entryParaChequeo?.estado;
    const esCambioATrabajar =
      (field === "estado" && (value === "trabaja" || esTurnoFijo(value))) ||
      (field === "llegada" && (estadoEfectivo === "trabaja" || esTurnoFijo(estadoEfectivo)));

    if (esCambioATrabajar) {
      const diaActualIdx = DIAS.indexOf(dia);
      const entryActual = entryParaChequeo;

      if (entryActual && entryActual.cedula.trim() && diaActualIdx > 0) {
        const cedula = entryActual.cedula.trim();
        const diaAnteriorIdx = diaActualIdx - 1;
        const diaAnterior = days[diaAnteriorIdx];
        const entryDiaAnterior = diaAnterior.entries.find((e) => e.cedula.trim() === cedula);

        if (entryDiaAnterior && entryDiaAnterior.estado === "descanso") {
          let ultimaSalidaMin = null;
          let ultimoDiaNombre = "";
          for (let i = diaAnteriorIdx - 1; i >= 0; i--) {
            const diaPrevio = days[i];
            const entryPrevio = diaPrevio.entries.find((e) => e.cedula.trim() === cedula);
            if (entryPrevio && entryPrevio.salida) {
              const [h, m] = entryPrevio.salida.split(":").map(Number);
              if (!isNaN(h) && !isNaN(m)) {
                ultimaSalidaMin = i * 24 * 60 + h * 60 + m;
                ultimoDiaNombre = diaPrevio.dia;
              }
              break;
            }
          }

          let llegadaNueva;
          if (field === "estado" && esTurnoFijo(value)) {
            llegadaNueva = TURNOS_FIJOS[value].llegada;
          } else if (field === "llegada") {
            llegadaNueva = value;
          } else {
            llegadaNueva = entryActual.llegada;
          }

          if (ultimaSalidaMin !== null && llegadaNueva) {
            const [lh, lm] = llegadaNueva.split(":").map(Number);
            if (!isNaN(lh) && !isNaN(lm)) {
              const llegadaMin = diaActualIdx * 24 * 60 + lh * 60 + lm;
              const horasDescanso = (llegadaMin - ultimaSalidaMin) / 60;
              if (horasDescanso < 36) {
                alert(`⚠️ No se puede programar a este operario el día ${dia}.\n\nDescansó el ${diaAnterior.dia}, pero desde su última salida el ${ultimoDiaNombre} solo habría ${horasDescanso.toFixed(1)} horas de descanso. Se requieren mínimo 36 horas continuas.`);
                return;
              }
            }
          }
        }
      }
    }

    if ((field === "breakInicio" || field === "llegadaReal" || field === "salidaReal") && value) {
      if (turnoMuyCortoParaBreak(entryParaChequeo)) {
        alert(`⚠️ No se puede registrar break para este colaborador.\n\nEl turno programado es de menos de 3 horas, por lo que no le corresponde tomar break.`);
        return;
      }
    }

    if (field === "breakInicio" && value) {
      const breakMin = horaAMinutos(value);
      const llegadaProgMin = horaAMinutos(entryParaChequeo.llegada);
      const llegadaRealMin = horaAMinutos(entryParaChequeo.llegadaReal);

      if (llegadaProgMin !== null && breakMin !== null) {
        const minimoPermitido = llegadaProgMin + MIN_HORAS_PARA_BREAK * 60;
        if (breakMin < minimoPermitido) {
          alert(`⚠️ Hora de break no permitida.\n\nEl colaborador llega a las ${entryParaChequeo.llegada}. El break solo puede iniciar después de 3 horas trabajadas, es decir, no antes de ${minutosAHora(minimoPermitido)}.`);
          return;
        }
      }
      if (llegadaRealMin !== null && breakMin !== null) {
        const minimoPermitidoReal = llegadaRealMin + MIN_HORAS_PARA_BREAK * 60;
        if (breakMin < minimoPermitidoReal) {
          alert(`⚠️ Hora de break no permitida.\n\nLa llegada real fue a las ${entryParaChequeo.llegadaReal}. El break solo puede iniciar después de 3 horas trabajadas, es decir, no antes de ${minutosAHora(minimoPermitidoReal)}.`);
          return;
        }
      }
    }

    if (field === "breakInicio" && value) {
      const diaActual = days.find((d) => d.dia === dia);
      const entryActual = entryParaChequeo;
      if (diaActual && entryActual && entryActual.llegada && entryActual.salida) {
        const inicioNuevoMin = horaAMinutos(value);
        const finNuevoMin = inicioNuevoMin !== null ? inicioNuevoMin + 60 : null;
        const conflicto = diaActual.entries.find((e) => {
          if (e.id === entryId || e.nombre.trim() === "" || !e.breakInicio) return false;
          if (e.llegada !== entryActual.llegada || e.salida !== entryActual.salida) return false;
          const inicioOtroMin = horaAMinutos(e.breakInicio);
          if (inicioOtroMin === null || finNuevoMin === null) return false;
          const finOtroMin = inicioOtroMin + 60;
          return inicioNuevoMin < finOtroMin && finNuevoMin > inicioOtroMin;
        });
        if (conflicto) {
          alert(`⚠️ No se puede asignar este horario de break.\n\n${conflicto.nombre} tiene el mismo turno (${entryActual.llegada}–${entryActual.salida}) el día ${dia} y su break (${conflicto.breakInicio}–${sumarUnaHora(conflicto.breakInicio)}) se cruza con este horario. Debe asignarse un horario que no se solape, para mantener cobertura en la tienda.`);
          return;
        }
      }
    }

    setDays((prev) =>
      prev.map((d) => {
        if (d.dia !== dia) return d;
        const entries = d.entries.map((e) => {
          if (e.id !== entryId) return e;
          let updated = { ...e, [field]: value };

          if (field === "nombre") {
            if (value.trim() === "") {
              const idOriginal = updated.id;
              updated = { ...emptyEntry(idOriginal), fecha: e.fecha };
            } else {
              const match = empleados.find((emp) => emp.nombre === value);
              if (match) updated.cedula = match.cedula;
            }
          }
          if (field === "cedula") {
            const match = empleados.find((emp) => emp.cedula === value);
            if (match) updated.nombre = match.nombre;
          }
          if (field === "estado" && esNoLaborable(value)) {
            updated = { ...updated, horasProgramadas: "", llegadaReal: "", salidaReal: "", horasReales: "", llegada: "", salida: "", breakInicio: "", breakFin: "", horasNocturnas: "" };
          }
          // Al pasar a "Trabaja", limpiar el horario del turno anterior para que el
          // supervisor lo programe desde cero (la salida no debe quedarse pegada).
          if (field === "estado" && value === "trabaja" && e.estado !== "trabaja") {
            updated = { ...updated, llegada: "", salida: "", horasProgramadas: "", breakInicio: "", breakFin: "", llegadaReal: "", salidaReal: "", horasReales: "", horasNocturnas: "" };
          }
          if (field === "estado") {
            if (esNovedadRRHH(value) && !esNovedadRRHH(e.estado)) {
              updated.fechaRegistroNovedad = formatFechaISO(new Date());
              updated.enviadoRRHH = false;
            } else if (!esNovedadRRHH(value)) {
              updated.fechaRegistroNovedad = "";
              updated.enviadoRRHH = false;
            }
          }
          if (field === "enviadoRRHH" && value === true) {
            updated = {
              ...updated,
              enviadoRRHH: false,
              fechaRegistroNovedad: "",
            };
          }
          if (field === "estado" && esTurnoFijo(value)) {
            const turno = TURNOS_FIJOS[value];
            updated = { ...updated, llegada: turno.llegada, salida: turno.salida, horasProgramadas: turno.horasProgramadas, llegadaReal: "", salidaReal: "", horasReales: "", breakInicio: "", breakFin: "" };
            if (turno.esFestivoAuto) updated.esFestivo = true;
            if (!turnoMuyCortoParaBreak(updated)) {
              const diaActualBreak = prev.find((dd) => dd.dia === dia);
              const entriesMismoTurno = diaActualBreak
                ? diaActualBreak.entries.filter((ee) => ee.llegada === turno.llegada && ee.salida === turno.salida)
                : [];
              const breakAuto = calcularBreakPredeterminado(turno.llegada, entriesMismoTurno, e.id);
              if (breakAuto) {
                updated.breakInicio = breakAuto;
                updated.breakFin = sumarUnaHora(breakAuto) || "";
              }
            }
          }
          if (field === "llegada") {
            const salidaAuto = HORARIOS_PREDETERMINADOS[value];
            updated.salida = salidaAuto || "";
            updated.horasProgramadas = salidaAuto ? "7.5" : "";
            updated.breakInicio = "";
            updated.breakFin = "";
            updated.llegadaReal = "";
            updated.salidaReal = "";
            updated.horasReales = "";
            if (value && salidaAuto && !turnoMuyCortoParaBreak({ ...updated, horasProgramadas: "7.5" })) {
              const diaActualBreak = prev.find((dd) => dd.dia === dia);
              const entriesMismoTurno = diaActualBreak
                ? diaActualBreak.entries.filter((ee) => ee.llegada === value && ee.salida === salidaAuto)
                : [];
              const breakAuto = calcularBreakPredeterminado(value, entriesMismoTurno, e.id);
              if (breakAuto) {
                updated.breakInicio = breakAuto;
                updated.breakFin = sumarUnaHora(breakAuto) || "";
              }
            }
          }
          if (field === "breakInicio") {
            const breakFinAuto = sumarUnaHora(value);
            if (breakFinAuto) updated.breakFin = breakFinAuto;
          }

          if (field === "llegadaReal" || field === "salidaReal") {
            updated.horasReales = calcularHorasRealesDesdeLlegadaSalida(
              updated.llegadaReal,
              updated.salidaReal,
              updated.llegada,
              updated.salida
            );
          }

          if (field === "llegadaReal" && value && !updated.breakInicio && !turnoMuyCortoParaBreak(updated)) {
            const diaActualBreak = prev.find((dd) => dd.dia === dia);
            const entriesMismoTurno = diaActualBreak
              ? diaActualBreak.entries.filter((ee) => ee.llegadaReal === value)
              : [];
            const breakAuto = calcularBreakPredeterminado(value, entriesMismoTurno, e.id);
            if (breakAuto) {
              updated.breakInicio = breakAuto;
              updated.breakFin = sumarUnaHora(breakAuto) || "";
            }
          }
          if (["horasProgramadas", "horasReales", "estado", "llegada", "llegadaReal", "salidaReal"].includes(field)) {
            updated.saldo = calcSaldo(updated.horasProgramadas, updated.horasReales);
          }
          if (["salida", "llegada", "estado", "horasProgramadas", "horasReales", "llegadaReal", "salidaReal"].includes(field)) {
            updated.horasNocturnas = calcularHorasNocturnas(updated.salidaReal || updated.salida);
          }
          return updated;
        });
        return { ...d, entries: resolverCrucesBreak(entries) };
      })
    );
  };

  const addEntry = (dia) => {
    setDays((prev) =>
      prev.map((d) => (d.dia === dia ? { ...d, entries: [...d.entries, emptyEntry(nextId)] } : d))
    );
    setNextId((n) => n + 1);
  };

  const removeEntry = (dia, entryId) => {
    setDays((prev) =>
      prev.map((d) =>
        d.dia === dia
          ? { ...d, entries: d.entries.length > 1 ? d.entries.filter((e) => e.id !== entryId) : d.entries }
          : d
      )
    );
  };

  const totalProgramadas = days.reduce((sum, d) => sum + d.entries.reduce((s, e) => s + (parseFloat(e.horasProgramadas) || 0), 0), 0);
  const totalReales = days.reduce((sum, d) => sum + d.entries.reduce((s, e) => s + (parseFloat(e.horasReales) || 0), 0), 0);

  const novedadesVencidas = days.reduce(
    (sum, d) =>
      sum +
      d.entries.filter((e) => {
        const dias = diasVencidosRRHH(e);
        return dias !== null && dias >= DIAS_LIMITE_ENVIO_RRHH;
      }).length,
    0
  );

  const handlePrintPlanilla = () => {
    setModoImpresion("planilla");
    setTimeout(() => window.print(), 50);
  };
  const handlePrintResumen = () => {
    setModoImpresion("resumen");
    setTimeout(() => window.print(), 50);
  };

  const cargarConsolidadoPeriodo = useCallback(async () => {
    setCargandoConsolidado(true);
    try {
      const { inicio, fin } = getRangoPeriodo(anioPeriodo, mesPeriodo);
      const clavesSemanas = [];
      let cursor = getDomingoDeSemana(inicio);
      while (cursor <= fin) {
        clavesSemanas.push(formatFechaISO(cursor));
        cursor = desplazarSemana(cursor, 1);
      }

      const todasLasSemanas = [];
      for (const keyDeEsaSemana of clavesSemanas) {
        if (keyDeEsaSemana === semanaKey) {
          todasLasSemanas.push(...days);
          continue;
        }
        const { data, error } = await supabase
          .from("horarios_semana")
          .select("datos")
          .eq("tienda_codigo", codigoTienda)
          .eq("semana_fecha", keyDeEsaSemana)
          .maybeSingle();
        if (!error && data && data.datos && data.datos.days) {
          data.datos.days.forEach((d) => {
            if (!d.fechaDate) return;
            const fechaDia = new Date(d.fechaDate + "T00:00:00");
            if (fechaDia >= inicio && fechaDia <= fin) {
              todasLasSemanas.push(d);
            }
          });
        }
      }
      setDiasAcumuladosPeriodo(todasLasSemanas);
    } catch (e) {
      setDiasAcumuladosPeriodo(days);
    } finally {
      setCargandoConsolidado(false);
    }
  }, [anioPeriodo, mesPeriodo, semanaKey, days, codigoTienda]);

  const consolidadoPorOperario = (() => {
    const mapa = {};
    const fuenteDeDatos = diasAcumuladosPeriodo || days;
    fuenteDeDatos.forEach((d) => {
      d.entries.forEach((e) => {
        const nombre = e.nombre.trim();
        const cedula = e.cedula.trim();
        if (!nombre || !cedula) return;
        if (!mapa[cedula]) mapa[cedula] = { nombre, cedula, festivas: 0, nocturnas: 0, extrasFestivas: 0, extrasNormales: 0 };
        const reales = parseFloat(e.horasReales) || 0;
        const nocturnas = parseFloat(e.horasNocturnas) || 0;
        const saldo = parseFloat(e.saldo) || 0;
        const esDiaFeriado = d.dia === "Domingo" || e.esFestivo;
        const extraFeriada = calcularExtraFeriada(d.dia, e);
        mapa[cedula].nocturnas += nocturnas;
        if (esDiaFeriado) mapa[cedula].festivas += reales;
        if (esDiaFeriado) {
          if (extraFeriada > 0) mapa[cedula].extrasFestivas += extraFeriada;
        } else if (saldo > 0) {
          mapa[cedula].extrasNormales += saldo;
        }
      });
    });
    return Object.values(mapa).sort((a, b) => a.nombre.localeCompare(b.nombre));
  })();

  const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r);
  };

  const exportarConsolidadoExcel = () => {
    const filas = consolidadoPorOperario.map((op) => ({
      Operario: op.nombre || "(Sin nombre)",
      Cédula: op.cedula || "",
      "Hrs Festivas": Number(fmt(op.festivas)),
      "Hrs Nocturnas": Number(fmt(op.nocturnas)),
      "Hrs Extras Feriadas o Dominicales": Number(fmt(op.extrasFestivas)),
      "Hrs Extras Normales": Number(fmt(op.extrasNormales)),
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Consolidado");
    const nombreArchivo = `Consolidado_${tienda || "Tienda"}_${anioPeriodo}-${String(mesPeriodo).padStart(2, "0")}.xlsx`.replace(/\s+/g, "_");
    XLSX.writeFile(libro, nombreArchivo);
  };

  return (
    <div className={`root-wrap print-mode-${modoImpresion}`} style={{ fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", background: "#FFF6EE", minHeight: "100vh", color: "#241C14" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }
          @page { size: landscape; margin: 3mm; }
          html, body { zoom: 0.68; width: 100%; overflow: visible; min-height: 0 !important; height: auto !important; }
          body > div, #root, #root > div { min-height: 0 !important; height: auto !important; background: white !important; }
          .print-wrapper { padding: 0 !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; min-height: 0 !important; height: auto !important; }
          .sheet { box-shadow: none !important; padding: 4px 6px !important; margin: 0 !important; border-radius: 0 !important; }
          table { font-size: 8.5px !important; border-collapse: collapse !important; width: 100% !important; }
          th, td { padding: 2px 4px !important; line-height: 1.3 !important; }
          .cell-input { font-size: 8.5px !important; padding: 0 !important; height: auto !important; width: 100% !important; }
          .day-title { font-size: 9px !important; }
          .day-block { margin-bottom: 3px !important; padding: 0 !important; border-radius: 0 !important; }
          .print-table { min-width: 0 !important; width: 100% !important; }
          .day-header { padding: 3px 5px !important; }
          .print-nota { margin-bottom: 4px !important; padding-bottom: 3px !important; }
          .store-info-grid { margin-bottom: 5px !important; }
          tr { height: auto !important; }
          input, select { height: auto !important; line-height: 1.3 !important; }
          .empty-row { display: none !important; }
          thead { display: table-row-group !important; }
          tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .day-block { page-break-inside: avoid !important; break-inside: avoid !important; }
          input, select { border: none !important; background: transparent !important; font-size: 8px !important; -webkit-appearance: none !important; appearance: none !important; }
          .col-llegada, .col-salida, .col-break-inicio, .col-break-fin, .col-hrs-prog, .col-llegada-real, .col-salida-real, .col-hrs-reales, .col-nocturnas, .col-saldo, .col-saldo-festiva, .col-validado, .col-rrhh, .col-obs, .col-acciones { display: none !important; }
          .print-mode-planilla .col-llegada, .print-mode-planilla .col-salida, .print-mode-planilla .col-break-inicio, .print-mode-planilla .col-break-fin, .print-mode-planilla .col-hrs-prog { display: table-cell !important; }
          .print-mode-resumen .col-llegada-real, .print-mode-resumen .col-salida-real, .print-mode-resumen .col-hrs-reales, .print-mode-resumen .col-nocturnas, .print-mode-resumen .col-saldo, .print-mode-resumen .col-saldo-festiva { display: table-cell !important; }
          .print-nota { font-size: 7px !important; padding-bottom: 3px !important; margin-bottom: 4px !important; line-height: 1.3 !important; }
          .store-info-grid { margin-bottom: 5px !important; gap: 6px !important; }
          .footer-supervisor { padding-top: 5px !important; }
          .firma-line { margin-top: 12px !important; }
          .col-firma-screen { display: table-cell !important; }
          .firma-line-print { display: block !important; border-bottom: 1px solid #C9C6BC !important; min-height: 14px !important; width: 100% !important; }
          .top-bar { display: none !important; }
          .root-wrap { min-height: 0 !important; height: auto !important; background: white !important; }
        }
        .col-firma-screen { display: none; }
        input[type="time"]::-webkit-calendar-picker-indicator { opacity: 0.5; }
        .cell-input { width: 100%; border: none; background: transparent; font-size: 12.5px; font-family: inherit; color: #241C14; padding: 4px 2px; outline: none; }
        .cell-input:focus { background: #FFF1DC; border-radius: 3px; }
        .entry-row:hover { background: #FFFBF5; }
      `}</style>

      {/* Barra superior */}
      <div className="top-bar no-print" style={{ background: "#E85D1F", color: "#FFFFFF", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <img src={logoRitmo} alt="Tiendas RITMO" style={{ height: 32, marginBottom: 4 }} />
            <div style={{ fontSize: 20, fontWeight: 700 }}>Programación de Horarios Semanales</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#FFFFFF", borderRadius: 7, padding: "4px 4px 4px 10px" }}>
              <button onClick={() => setDomingoSemanaActual((prev) => desplazarSemana(prev, -1))} title="Semana anterior" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#E85D1F", display: "flex", alignItems: "center", padding: 4 }}>
                <ChevronLeft size={17} />
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#E85D1F", whiteSpace: "nowrap" }}>
                {formatFechaCorta(semanaFechas[0])}–{formatFechaCorta(semanaFechas[6])}
              </span>
              <button onClick={() => setDomingoSemanaActual((prev) => desplazarSemana(prev, 1))} title="Semana siguiente" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#E85D1F", display: "flex", alignItems: "center", padding: 4 }}>
                <ChevronRight size={17} />
              </button>
              <button onClick={() => setDomingoSemanaActual(getDomingoDeSemana(new Date()))} title="Ir a la semana actual" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#1B8388", fontSize: 12, fontWeight: 600, padding: "4px 8px" }}>
                Hoy
              </button>
            </div>
            <SaveIndicator state={saveState} />
            <button onClick={handleSupervisorClick} style={btnStyle(modoSupervisor ? "#3FBFC4" : "#FFFFFF", modoSupervisor ? "#FFFFFF" : "#E85D1F")} title={modoSupervisor ? "Modo Supervisor activo — clic para salir" : "Activar Modo Supervisor"}>
              {modoSupervisor ? <Unlock size={15} /> : <Lock size={15} />} {modoSupervisor ? "Supervisor activo" : "Modo Supervisor"}
            </button>
            <button onClick={() => setShowEmpleados(true)} style={btnStyle("#FFFFFF", "#E85D1F")}><Users size={15} /> Empleados</button>
            <button onClick={() => { setShowConsolidado(true); cargarConsolidadoPeriodo(); }} style={{ ...btnStyle("#FFFFFF", "#E85D1F"), position: "relative" }}>
              <Clock size={15} /> Consolidado
              {novedadesVencidas > 0 && (
                <span title={`${novedadesVencidas} novedad(es) sin enviar a RRHH hace 2+ días`} style={{ position: "absolute", top: -7, right: -7, background: "#B3261E", color: "#FFFFFF", borderRadius: "50%", width: 19, height: 19, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #FFFFFF" }}>
                  {novedadesVencidas}
                </span>
              )}
            </button>
            <button onClick={handlePrintPlanilla} style={btnStyle("#3FBFC4", "#FFFFFF")}><Printer size={15} /> Imprimir Planilla</button>
            <button onClick={handlePrintResumen} style={btnStyle("#3FBFC4", "#FFFFFF")}><Printer size={15} /> Imprimir Resumen</button>
            <button onClick={onSalir} title="Salir" style={{ ...btnStyle("transparent", "#FFFFFF"), padding: 8 }}><LogOut size={16} /></button>
          </div>
        </div>
        <div style={{ maxWidth: 1400, margin: "8px auto 0", fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>Periodo de nómina: <strong>{getPeriodoLabel(anioPeriodo, mesPeriodo)}</strong> (21 de {NOMBRES_MESES[(mesPeriodo - 2 + 12) % 12]} – 20 de {NOMBRES_MESES[mesPeriodo - 1]})</span>
          {completado && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(46,125,50,0.25)", padding: "2px 9px", borderRadius: 999, fontWeight: 600 }}>
              <CheckCircle2 size={12} /> Semana completada
            </span>
          )}
        </div>
      </div>

      {/* Contenido principal */}
      <div className="print-wrapper" style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div className="sheet" style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 28 }}>

          <div className="print-nota" style={{ fontSize: 11.5, color: "#6B5A4A", borderBottom: "2px solid #E85D1F", paddingBottom: 14, marginBottom: 18, lineHeight: 1.6 }}>
            <strong style={{ color: "#E85D1F" }}>NOTA:</strong> Cada colaborador debe disfrutar de 36 horas continuas de descanso semanal. El turno de inventario de la mañana entra a las 6:00 a.m. y sale a la 1:30 p.m. Toda hora extra requiere observación y aprobación del Jefe de Zona.
            {" "}<em style={{ color: "#1B8388" }}>Tolerancia de fichaje: entrada ±{TOLERANCIA_ENTRADA_MIN} min · salida ±{TOLERANCIA_SALIDA_MIN} min.</em>
          </div>

          <div className="store-info-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
            <Field label="Nombre Tienda">
              <input disabled={completado} value={tienda} onChange={(e) => setTienda(e.target.value)} style={completado ? { ...fieldInputStyle, background: "#F2EFE9", color: "#5C5F5A", cursor: "not-allowed" } : fieldInputStyle} placeholder="Ej. Santiago Centro" />
            </Field>
            <Field label="Código">
              <input value={codigo} disabled style={{ ...fieldInputStyle, background: "#F2EFE9", color: "#5C5F5A", cursor: "not-allowed" }} />
            </Field>
            <Field label="Fecha">
              <input disabled={completado} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={completado ? { ...fieldInputStyle, background: "#F2EFE9", color: "#5C5F5A", cursor: "not-allowed" } : fieldInputStyle} />
            </Field>
          </div>

          {/* Horas por operario en la semana (máx. 44h) — aviso en vivo */}
          {(() => {
            const totales = {};
            days.forEach((d) => {
              (d.entries || []).forEach((e) => {
                const nombre = (e.nombre || "").trim();
                if (!nombre) return;
                const key = (e.cedula || "").trim() || nombre;
                if (!totales[key]) totales[key] = { nombre, horas: 0 };
                totales[key].horas += parseFloat(e.horasProgramadas) || 0;
              });
            });
            const lista = Object.values(totales)
              .map((o) => ({ ...o, horas: Math.round(o.horas * 100) / 100 }))
              .filter((o) => o.horas > 0)
              .sort((a, b) => b.horas - a.horas);
            if (lista.length === 0) return null;
            const fmtH = (n) => (n % 1 === 0 ? String(n) : n.toFixed(1));
            const algunoExcede = lista.some((o) => o.horas > 44);
            return (
              <div className="no-print" style={{ marginBottom: 22, border: `1.5px solid ${algunoExcede ? "#E53935" : "#E5E3DC"}`, borderRadius: 8, padding: "14px 16px", background: algunoExcede ? "#FFF6F5" : "#FAFAF7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#241C14" }}>Horas por operario — esta semana</span>
                  <span style={{ fontSize: 12, color: "#5C5F5A" }}>(máximo 44h)</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {lista.map((o) => {
                    const excede = o.horas > 44;
                    return (
                      <div key={o.nombre} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: excede ? "#FCEBEB" : "#FFFFFF", border: `1px solid ${excede ? "#E53935" : "#E5E3DC"}`, borderRadius: 7, padding: "6px 12px", fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600, color: "#241C14" }}>{o.nombre}</span>
                        <span style={{ fontWeight: 700, color: excede ? "#E53935" : "#1B8388" }}>{fmtH(o.horas)}h</span>
                        {excede && <span style={{ fontSize: 11, color: "#E53935", fontWeight: 700 }}>baja {fmtH(o.horas - 44)}h</span>}
                      </div>
                    );
                  })}
                </div>
                {algunoExcede && (
                  <div style={{ fontSize: 12, color: "#E53935", fontWeight: 600, marginTop: 10 }}>
                    ⚠ Hay operarios que superan las 44h. Asigna una &quot;Jornada 44&quot; (mañana o tarde) en un día para que cierren en 44h.
                  </div>
                )}
              </div>
            );
          })()}

          {days.map((d) => {
            if (d.fechaDate === null && semanaFechas.length) return null;
            const fechaLabel = d.fechaDate ? formatFechaCorta(new Date(d.fechaDate + "T00:00:00")) : "";
            return (
              <div key={d.dia} className="day-block" style={{ marginBottom: 22, border: "1px solid #E5E3DC", borderRadius: 8, overflow: "hidden" }}>
                <div className="day-header" style={{ background: "#E6F7F8", padding: "10px 14px" }}>
                  <span className="day-title" style={{ fontWeight: 700, color: "#1B8388", fontSize: 17 }}>
                    {d.dia}{fechaLabel ? ` — ${fechaLabel}` : ""}
                  </span>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table className="print-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                    <thead>
                      <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                        <th style={thStyle}>Mes/Día</th>
                        <th style={thStyle}>Nombre</th>
                        <th style={thStyle}>Cédula</th>
                        <th style={{ ...thStyle, minWidth: 170 }}>Estado</th>
                        <th className="col-llegada" style={thStyle}>Hora Llegada</th>
                        <th className="col-salida" style={thStyle}>Hora Salida</th>
                        <th className="col-break-inicio" style={thStyle}>Break Inicio</th>
                        <th className="col-break-fin" style={thStyle}>Break Fin</th>
                        <th className="col-hrs-prog" style={thStyle}>Hrs Prog.</th>
                        <th className="col-llegada-real" style={thStyle}>Llegada Real</th>
                        <th className="col-salida-real" style={thStyle}>Salida Real</th>
                        <th className="col-hrs-reales" style={{ ...thStyle, minWidth: 90 }}>Hrs Reales</th>
                        <th className="col-validado no-print" style={thStyle}>Validado por SPV</th>
                        <th className="col-nocturnas" style={thStyle}>Hrs Noct.</th>
                        <th className="col-saldo" style={thStyle}>Extra</th>
                        <th className="col-saldo-festiva" style={thStyle}>Extra Feriada o Dominical</th>
                        <th className="col-rrhh no-print" style={thStyle}>Enviado a RRHH</th>
                        <th className="col-firma-screen" style={thStyle}>Firma</th>
                        <th className="col-obs no-print" style={thStyle}>Observación</th>
                        <th className="col-acciones no-print" style={thStyle}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`entry-row ${entry.nombre.trim() === "" ? "empty-row" : ""}`}
                          style={{
                            background: aprobaciones[entry.id] === "aprobado" ? "#43A047" : aprobaciones[entry.id] === "rechazado" ? "#E53935" : undefined,
                            borderLeft: aprobaciones[entry.id] === "aprobado" ? "5px solid #1B5E20" : aprobaciones[entry.id] === "rechazado" ? "5px solid #B71C1C" : undefined,
                            color: aprobaciones[entry.id] ? "white" : undefined,
                          }}
                        >
                          <td style={tdStyle}>
                            <input className="cell-input" value={entry.fecha} readOnly placeholder="06/16" style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td style={tdStyle}>
                            {(() => {
                              const cedula = (entry.cedula || "").trim();
                              const otra = cedula && (entry.nombre || "").trim() && !esNoLaborable(entry.estado) && (entry.estado || "").trim()
                                ? ocupacionOtrasTiendas[`${cedula}__${d.fechaDate}`] : null;
                              return (
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <select disabled={completado} className="cell-input" value={entry.nombre} onChange={(e) => updateEntry(d.dia, entry.id, "nombre", e.target.value)} style={{ fontWeight: 600, minWidth: 140, cursor: completado ? "not-allowed" : "pointer", border: otra ? "1.5px solid #E53935" : undefined }}>
                                      <option value="">Seleccionar...</option>
                                      {empleados.map((emp) => (<option key={emp.id} value={emp.nombre}>{emp.nombre}</option>))}
                                      {entry.nombre.trim() !== "" && !empleados.some((emp) => emp.nombre === entry.nombre) && (
                                        <option value={entry.nombre}>{entry.nombre} (ya no está en el directorio)</option>
                                      )}
                                    </select>
                                    {otra && (
                                      <span title={`Ya está fichado en ${otra} este día — no lo programes aquí (se contaría doble).`} style={{ flexShrink: 0, cursor: "help", display: "inline-flex" }}>
                                        <AlertTriangle size={15} color="#E53935" />
                                      </span>
                                    )}
                                  </div>
                                  {otra && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 11, fontWeight: 600, color: "#E53935", maxWidth: 220, lineHeight: 1.3 }}>
                                      <AlertTriangle size={12} color="#E53935" style={{ flexShrink: 0 }} />
                                      <span>Ya está en {otra} este día — no lo pongas aquí (doble conteo)</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={tdStyle}>
                            <input className="cell-input" value={entry.cedula} readOnly placeholder="Selecciona un nombre"
                              style={{ minWidth: 100, background: entry.cedula.trim() === "" ? "#FCEBEB" : "#F2EFE9", borderRadius: 4, color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td style={{ ...tdStyle, minWidth: 170 }}>
                            <select disabled={completado} className="cell-input" value={entry.estado} onChange={(e) => updateEntry(d.dia, entry.id, "estado", e.target.value)}
                              style={{ cursor: completado ? "not-allowed" : "pointer", width: "100%", minWidth: 160, whiteSpace: "nowrap", fontWeight: estaBloqueado(entry) ? 700 : 400, color: esNoLaborable(entry.estado) ? "#946800" : esTurnoFijo(entry.estado) ? "#1B8388" : "#241C14" }}>
                              <option value="">Seleccionar...</option>
                              <option value="trabaja">Trabaja</option>
                              <option value="jornada_44">Sale una hora antes T. Mañana</option>
                              <option value="jornada_44_tarde">Entra una hora después T. Tarde</option>
                              <option value="t_inventario_manana">T.Inventario mañana</option>
                              <option value="domingo_t_manana">Domingo T. mañana</option>
                              <option value="domingo_t_tarde">Domingo T. tarde</option>
                              <option value="feriado_manana">Feriado mañana</option>
                              <option value="feriado_tarde">Feriado tarde</option>
                              <option value="descanso">Descanso</option>
                              <option value="vacaciones">Vacaciones</option>
                              <option value="incapacitado">Incapacitado</option>
                              <option value="licencia_maternidad">Licencia de maternidad</option>
                              <option value="luto">Luto</option>
                            </select>
                          </td>
                          <td className="col-llegada" style={tdStyle}>
                            <select key={`${entry.id}-${entry.estado}`} disabled={estaBloqueado(entry) || completado} className="cell-input" value={entry.llegada} onChange={(e) => updateEntry(d.dia, entry.id, "llegada", e.target.value)}
                              style={{ cursor: "pointer", ...(estaBloqueado(entry) ? disabledCellStyle : {}) }}>
                              <option value="">--:-- --</option>
                              <option value="06:00">6:00 AM</option>
                              <option value="07:00">7:00 AM</option>
                              <option value="07:30">7:30 AM</option>
                              <option value="12:30">12:30 PM</option>
                              <option value="13:30">1:30 PM</option>
                              <option value="14:30">2:30 PM</option>
                            </select>
                          </td>
                          <td className="col-salida" style={tdStyle}>
                            <input disabled readOnly type="time" className="cell-input" value={entry.salida} style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td className="col-break-inicio" style={tdStyle}>
                            <input disabled readOnly type="time" className="cell-input" value={entry.breakInicio} style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td className="col-break-fin" style={tdStyle}>
                            <input disabled readOnly type="time" className="cell-input" value={entry.breakFin} style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td className="col-hrs-prog" style={tdStyle}>
                            <input disabled readOnly className="cell-input" value={entry.horasProgramadas} placeholder="0" style={{ textAlign: "center", background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                          </td>
                          <td className="col-llegada-real" style={tdStyle}>
                            <input disabled={parcialBloqueado(entry) || completado || !modoSupervisor} type="time" className="cell-input" value={entry.llegadaReal}
                              onChange={(e) => updateEntry(d.dia, entry.id, "llegadaReal", e.target.value)}
                              title={!modoSupervisor ? "Activa el Modo Supervisor para editar la hora real" : ""}
                              style={(parcialBloqueado(entry) || completado || !modoSupervisor) ? disabledCellStyle : undefined} />
                          </td>
                          <td className="col-salida-real" style={tdStyle}>
                            <input disabled={parcialBloqueado(entry) || completado || !modoSupervisor} type="time" className="cell-input" value={entry.salidaReal}
                              onChange={(e) => updateEntry(d.dia, entry.id, "salidaReal", e.target.value)}
                              title={!modoSupervisor ? "Activa el Modo Supervisor para editar la hora real" : ""}
                              style={(parcialBloqueado(entry) || completado || !modoSupervisor) ? disabledCellStyle : undefined} />
                          </td>
                          <td className="col-hrs-reales" style={{ ...tdStyle, minWidth: 90 }}>
                            {/* Día festivo se determina solo por domingo (auto) o turno "Feriado mañana/tarde".
                                Se quitó la casilla manual para que no se confunda con la validación de horas. */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: entry.esFestivo ? "#3FBFC4" : "transparent", borderRadius: 4 }}>
                              <input disabled readOnly className="cell-input" value={entry.horasReales} placeholder="0"
                                style={{ textAlign: "center", minWidth: 40, width: 40, flexShrink: 0, background: entry.esFestivo ? "transparent" : "#F2EFE9", color: entry.esFestivo ? "#04342C" : "#5C5F5A", fontWeight: entry.esFestivo ? 600 : 400, cursor: "default" }} />
                            </div>
                          </td>
                          <td className="col-validado no-print" style={{ ...tdStyle, textAlign: "center" }}>
                            {entry.nombre.trim() !== "" && (
                              <input type="checkbox" checked={entry.validado} disabled={!modoSupervisor || completado}
                                onChange={(e) => updateEntry(d.dia, entry.id, "validado", e.target.checked)}
                                title={completado ? "Planilla completada" : modoSupervisor ? "Marcar horas reales como validadas" : "Solo el supervisor puede validar"}
                                style={{ width: 18, height: 18, cursor: (!modoSupervisor || completado) ? "not-allowed" : "pointer", accentColor: "#3FBFC4" }} />
                            )}
                          </td>
                          <td className="col-nocturnas" style={tdStyle}>
                            <span style={{ fontSize: 12, color: "#5C5F5A", display: "block", textAlign: "center" }}>{entry.horasNocturnas || "0"}</span>
                          </td>
                          <td className="col-saldo" style={tdStyle}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: entry.saldo.startsWith("+") ? "#B3261E" : entry.saldo.startsWith("-") ? "#946800" : "#5C5F5A" }}>
                              {(() => {
                                const esDiaFeriado = d.dia === "Domingo" || entry.esFestivo;
                                if (esDiaFeriado) {
                                  const extraFeriada = calcularExtraFeriada(d.dia, entry);
                                  if (extraFeriada > 0) return entry.saldo.startsWith("-") ? entry.saldo : "0";
                                }
                                return entry.saldo;
                              })()}
                            </span>
                          </td>
                          <td className="col-saldo-festiva" style={tdStyle}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#B3261E" }}>
                              {(() => {
                                const extraFeriada = calcularExtraFeriada(d.dia, entry);
                                return extraFeriada > 0 ? `+${extraFeriada}` : "0";
                              })()}
                            </span>
                          </td>
                          <td className="col-rrhh no-print" style={{ ...tdStyle, textAlign: "center" }}>
                            {esNovedadRRHH(entry.estado) && (() => {
                              const dias = diasVencidosRRHH(entry);
                              const vencido = dias !== null && dias >= DIAS_LIMITE_ENVIO_RRHH;
                              const bloqueado = completado;
                              return (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                  <label className="no-print"
                                    title={bloqueado ? "Planilla completada" : "Marcar como enviado a Recursos Humanos"}
                                    style={{ display: "flex", alignItems: "center", cursor: bloqueado ? "not-allowed" : "pointer" }}>
                                    <input type="checkbox" disabled={bloqueado} checked={!!entry.enviadoRRHH}
                                      onChange={(ev) => updateEntry(d.dia, entry.id, "enviadoRRHH", ev.target.checked)}
                                      style={{ width: 17, height: 17, cursor: bloqueado ? "not-allowed" : "pointer", accentColor: "#3FBFC4" }} />
                                  </label>
                                  {vencido && (
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#B3261E", background: "#FCEBEB", padding: "2px 6px", borderRadius: 4 }}>
                                      ⚠ {dias}d
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="col-firma-screen" style={tdStyle}>
                            {entry.nombre.trim() !== "" && <span className="firma-line-print" />}
                          </td>
                          <td className="col-obs no-print" style={tdStyle}>
                            <input disabled={entry.cedula.trim() === "" || completado} className="cell-input" value={entry.observacion}
                              onChange={(e) => updateEntry(d.dia, entry.id, "observacion", e.target.value)}
                              placeholder="—" style={(entry.cedula.trim() === "" || completado) ? disabledCellStyle : undefined} />
                          </td>
                          <td className="col-acciones no-print" style={tdStyle}>
                            {d.entries.length > 1 && !completado && !entry.validado && modoSupervisor && (
                              <button onClick={() => removeEntry(d.dia, entry.id)} style={iconBtnStyle}>
                                <Trash2 size={14} color="#B3261E" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!completado && (
                  <div style={{ padding: "8px 14px", background: "#FAFAF7" }}>
                    <button className="no-print" onClick={() => addEntry(d.dia)} style={{ ...btnStyle("transparent", "#E85D1F"), border: "1px dashed #E85D1F", padding: "5px 10px", fontSize: 12 }}>
                      <Plus size={13} /> Agregar colaborador a {d.dia}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pie: supervisor */}
          <div className="footer-supervisor" style={{ paddingTop: 20, borderTop: "2px solid #E85D1F", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 20 }}>
            <div style={{ maxWidth: 420 }}>
              <Field label="Nombre Supervisor">
                <input disabled={completado} value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={completado ? { ...fieldInputStyle, background: "#F2EFE9", color: "#5C5F5A", cursor: "not-allowed" } : fieldInputStyle} placeholder="Nombre del supervisor" />
              </Field>
              <div className="firma-line" style={{ marginTop: 36, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>Firma Supervisor</div>
              <div className="firma-line" style={{ marginTop: 28, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>Aprobado por JDZ</div>
            </div>
            <div className="no-print" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              {(() => {
                // Días laborables con operario asignado que aún no tienen "Validado por SPV".
                const pendientesValidar = days.reduce((acc, d) =>
                  acc + (d.entries || []).filter((e) => (e.nombre || "").trim() && !esNoLaborable(e.estado) && !e.validado).length, 0);
                // Operarios programados el mismo día en otra tienda (doble conteo).
                const conflictos = [];
                days.forEach((d) => {
                  (d.entries || []).forEach((e) => {
                    const cedula = (e.cedula || "").trim();
                    if (!cedula || !(e.nombre || "").trim() || esNoLaborable(e.estado) || !(e.estado || "").trim()) return;
                    const otra = ocupacionOtrasTiendas[`${cedula}__${d.fechaDate}`];
                    if (otra) conflictos.push({ nombre: e.nombre.trim(), dia: d.dia, otra });
                  });
                });
                const hayConflicto = conflictos.length > 0;
                const bloqueado = !completado && (pendientesValidar > 0 || hayConflicto);
                return (
                  <>
                    <button
                      onClick={() => {
                        if (completado) {
                          if (window.confirm("Esta planilla ya está marcada como completada.\n\n¿Quieres desmarcarla?")) {
                            setCompletado(false);
                            setFechaCompletado("");
                          }
                          return;
                        }
                        if (hayConflicto) {
                          const lista = conflictos.slice(0, 6).map((c) => `• ${c.nombre} (${c.dia}) ya está en ${c.otra}`).join("\n");
                          alert(`No puedes completar la planilla.\n\nHay operarios programados el mismo día en otra tienda (se contarían dos veces):\n\n${lista}${conflictos.length > 6 ? "\n…" : ""}\n\nQuita esos días de esta tienda — el operario ya los tiene fichados en la otra.`);
                          return;
                        }
                        if (bloqueado) {
                          alert(`No puedes completar la planilla todavía.\n\nFaltan ${pendientesValidar} validación(es) por hacer (un operario por día). Activa el Modo Supervisor y marca "Validado por SPV" en todos los días laborables de tus operarios.`);
                          return;
                        }
                        if (window.confirm("¿Confirmas que ya terminaste de programar los horarios de esta semana?\n\nEsto le indicará al Jefe de Zona que la planilla está lista.")) {
                          setCompletado(true);
                          setFechaCompletado(formatFechaISO(new Date()));
                        }
                      }}
                      title={hayConflicto ? "Hay operarios programados el mismo día en otra tienda" : bloqueado ? `Faltan ${pendientesValidar} validación(es) por hacer (Validado por SPV)` : ""}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: completado ? "#2E7D32" : bloqueado ? "#B8B5AC" : "#3FBFC4", color: "#FFFFFF", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: bloqueado ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: bloqueado ? 0.85 : 1 }}
                    >
                      <CheckCircle2 size={17} />
                      {completado ? "Planilla completada — Marcar de nuevo" : "Marcar planilla como completada"}
                    </button>
                    {hayConflicto && (
                      <span style={{ fontSize: 12, color: "#B3261E", fontWeight: 600, textAlign: "right", maxWidth: 300 }}>
                        ⚠ {conflictos.length} operario(s) programado(s) el mismo día en otra tienda. Quita esos días antes de completar.
                      </span>
                    )}
                    {!hayConflicto && bloqueado && (
                      <span style={{ fontSize: 12, color: "#B3261E", fontWeight: 600, textAlign: "right", maxWidth: 280 }}>
                        Faltan {pendientesValidar} validación(es) por hacer (Validado por SPV) antes de completar.
                      </span>
                    )}
                    {completado && fechaCompletado && (
                      <span style={{ fontSize: 12, color: "#5C5F5A" }}>Completada el {formatFechaCorta(new Date(fechaCompletado + "T00:00:00"))}</span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Consolidado */}
      {showConsolidado && (
        <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={() => setShowConsolidado(false)}>
          <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#E85D1F" }}>Consolidado Acumulado del Periodo</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={exportarConsolidadoExcel} style={btnStyle("#3FBFC4", "#FFFFFF")}><FileSpreadsheet size={15} /> Exportar a Excel</button>
                <button onClick={() => setShowConsolidado(false)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "#5C5F5A" }}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#5C5F5A", marginBottom: 16 }}>
              {getPeriodoLabel(anioPeriodo, mesPeriodo)} (21 de {NOMBRES_MESES[(mesPeriodo - 2 + 12) % 12]} – 20 de {NOMBRES_MESES[mesPeriodo - 1]})
            </div>
            {cargandoConsolidado ? (
              <div style={{ fontSize: 13, color: "#5C5F5A", display: "flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Calculando acumulado del periodo...
              </div>
            ) : consolidadoPorOperario.length === 0 ? (
              <div style={{ fontSize: 13, color: "#5C5F5A" }}>No hay colaboradores con datos registrados todavía.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                    <th style={thStyle}>Operario</th><th style={thStyle}>Cédula</th>
                    <th style={thStyle}>Hrs Festivas</th><th style={thStyle}>Hrs Nocturnas</th>
                    <th style={thStyle}>Extras Feriadas o Dominicales</th><th style={thStyle}>Extras Normales</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidadoPorOperario.map((op) => (
                    <tr key={op.cedula || op.nombre} style={{ borderTop: "1px solid #EDEBE4" }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{op.nombre || "(Sin nombre)"}</td>
                      <td style={tdStyle}>{op.cedula || "—"}</td>
                      <td style={tdStyle}>{fmt(op.festivas)}</td>
                      <td style={tdStyle}>{fmt(op.nocturnas)}</td>
                      <td style={tdStyle}>{fmt(op.extrasFestivas)}</td>
                      <td style={tdStyle}>{fmt(op.extrasNormales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal Empleados */}
      {showEmpleados && (
        <ModalEmpleados codigoTienda={codigoTienda} empleados={empleados} onClose={() => setShowEmpleados(false)} onRecargar={cargarEmpleados} />
      )}

      {/* Modal contraseña Modo Supervisor */}
      {showPasswordPrompt && (
        <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={() => setShowPasswordPrompt(false)}>
          <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 360, width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#E85D1F", display: "flex", alignItems: "center", gap: 8 }}>
                <Lock size={17} /> Modo Supervisor
              </div>
              <button onClick={() => setShowPasswordPrompt(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#5C5F5A" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12.5, color: "#5C5F5A", marginBottom: 14 }}>
              Ingresa la contraseña de supervisor para habilitar la validación de horas reales.
            </div>
            <form onSubmit={handlePasswordSubmit}>
              <input type="password" autoFocus value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="Contraseña" style={fieldInputStyle} />
              {passwordError && (
                <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, marginTop: 10 }}>{passwordError}</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="submit" style={{ ...btnStyle("#3FBFC4", "#FFFFFF"), flex: 1, justifyContent: "center" }}>Ingresar</button>
                <button type="button" onClick={() => setShowPasswordPrompt(false)} style={{ ...btnStyle("#FAFAF7", "#5C5F5A"), flex: 1, justifyContent: "center" }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Modal Empleados ─── */
function ModalEmpleados({ codigoTienda, empleados, onClose, onRecargar }) {
  const [nombre, setNombre] = useState("");
  const [cedula, setCedula] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const limpiarFormulario = () => { setNombre(""); setCedula(""); setEditandoId(null); setError(""); };
  const handleEditar = (emp) => { setNombre(emp.nombre); setCedula(emp.cedula); setEditandoId(emp.id); setError(""); };

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!nombre.trim() || !cedula.trim()) { setError("Completa nombre y cédula."); return; }
    setGuardando(true); setError("");
    try {
      if (editandoId) {
        const { error: err } = await supabase.from("empleados").update({ nombre: nombre.trim(), cedula: cedula.trim() }).eq("id", editandoId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("empleados").insert({ tienda_codigo: codigoTienda, nombre: nombre.trim(), cedula: cedula.trim() });
        if (err) throw err;
      }
      await onRecargar(); limpiarFormulario();
    } catch (err) { setError("Esa cédula ya existe en esta tienda, o ocurrió un error. Intenta de nuevo."); }
    finally { setGuardando(false); }
  };

  const [confirmEliminar, setConfirmEliminar] = useState(null); // { id, nombre }
  const [motivoEliminar, setMotivoEliminar] = useState("");

  const handleEliminar = (emp) => {
    setConfirmEliminar(emp);
    setMotivoEliminar("");
  };

  const handleConfirmarEliminar = async () => {
    if (!motivoEliminar) return;
    try {
      await supabase.from("empleados").delete().eq("id", confirmEliminar.id);
      await onRecargar();
      if (editandoId === confirmEliminar.id) limpiarFormulario();
      setConfirmEliminar(null);
    } catch (err) { setError("No se pudo eliminar. Intenta de nuevo."); }
  };

  return (
    <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#E85D1F" }}>Empleados de la tienda</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#5C5F5A" }}><X size={18} /></button>
        </div>
        <form onSubmit={handleGuardar} style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" style={{ ...fieldInputStyle, flex: "1 1 180px" }} />
          <input value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="Cédula" style={{ ...fieldInputStyle, flex: "1 1 140px" }} />
          <button type="submit" disabled={guardando} style={{ ...btnStyle("#E85D1F", "#FFFFFF"), opacity: guardando ? 0.7 : 1 }}>
            {editandoId ? "Guardar" : <><Plus size={14} /> Agregar</>}
          </button>
          {editandoId && (<button type="button" onClick={limpiarFormulario} style={btnStyle("#FAFAF7", "#5C5F5A")}>Cancelar</button>)}
        </form>
        {error && (<div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, marginBottom: 14 }}>{error}</div>)}
        {empleados.length === 0 ? (
          <div style={{ fontSize: 13, color: "#5C5F5A" }}>Todavía no hay empleados registrados para esta tienda.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                <th style={thStyle}>Nombre</th><th style={thStyle}>Cédula</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {empleados.map((emp) => (
                <tr key={emp.id} style={{ borderTop: "1px solid #EDEBE4" }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{emp.nombre}</td>
                  <td style={tdStyle}>{emp.cedula}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => handleEditar(emp)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#1B8388", fontSize: 12, fontWeight: 600 }}>Editar</button>
                      <button onClick={() => handleEliminar(emp)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#791F1F", fontSize: 12, fontWeight: 600 }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Modal confirmación de eliminación */}
        {confirmEliminar && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
            <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 380, width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#791F1F", marginBottom: 8 }}>Eliminar empleado</div>
              <div style={{ fontSize: 13, color: "#241C14", marginBottom: 16 }}>
                Vas a eliminar a <strong>{confirmEliminar.nombre}</strong>. Selecciona el motivo:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                {["Cambio de tienda", "Ya no trabaja en Ritmo"].map((motivo) => (
                  <label key={motivo} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: motivoEliminar === motivo ? 700 : 400, color: motivoEliminar === motivo ? "#791F1F" : "#241C14", background: motivoEliminar === motivo ? "#FCEBEB" : "#FAFAF7", border: motivoEliminar === motivo ? "1.5px solid #791F1F" : "1px solid #EDEBE4", borderRadius: 7, padding: "10px 14px" }}>
                    <input type="radio" name="motivo" value={motivo} checked={motivoEliminar === motivo} onChange={() => setMotivoEliminar(motivo)} style={{ accentColor: "#791F1F" }} />
                    {motivo}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={handleConfirmarEliminar} disabled={!motivoEliminar}
                  style={{ flex: 1, background: motivoEliminar ? "#791F1F" : "#EDEBE4", color: motivoEliminar ? "white" : "#5C5F5A", border: "none", borderRadius: 7, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: motivoEliminar ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                  Confirmar eliminación
                </button>
                <button onClick={() => setConfirmEliminar(null)}
                  style={{ flex: 1, background: "#FAFAF7", color: "#5C5F5A", border: "1px solid #EDEBE4", borderRadius: 7, padding: "9px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Componentes auxiliares ─── */
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#5C5F5A", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </div>
  );
}

function SaveIndicator({ state }) {
  const map = {
    idle: { icon: null, text: "" },
    saving: { icon: <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />, text: "Guardando..." },
    saved: { icon: <CheckCircle2 size={13} />, text: "Guardado" },
    error: { icon: <AlertCircle size={13} />, text: "Error al guardar" },
  };
  const { icon, text } = map[state] || map.idle;
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, opacity: 0.9 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {icon} {text}
    </div>
  );
}

/* ─── Estilos compartidos ─── */
const disabledCellStyle = { background: "#F2EFE9", color: "#A6A199", cursor: "not-allowed" };

const fieldInputStyle = {
  width: "100%", border: "1px solid #DEDBD2", borderRadius: 6,
  padding: "7px 10px", fontSize: 13, fontFamily: "inherit",
  background: "#FAFAF8", outline: "none", color: "#241C14",
};

const thStyle = { padding: "9px 8px", textAlign: "left", fontWeight: 600 };
const tdStyle = { padding: "4px 8px", fontSize: 12.5, verticalAlign: "middle", borderTop: "1px solid #EDEBE4" };

function btnStyle(bg, color) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: bg, color, border: "none", borderRadius: 7,
    padding: "8px 14px", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };
}

const iconBtnStyle = {
  background: "transparent", border: "none", cursor: "pointer",
  padding: 4, borderRadius: 6, display: "flex", alignItems: "center",
};
