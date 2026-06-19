import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Printer, Clock, AlertCircle, CheckCircle2, Loader2, FileSpreadsheet, LogOut, Users, X } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import logoRitmo from "./logo-ritmo.png";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ─── Lógica de periodos de nómina (corte del día 20) ───
// Un periodo de nómina va del 21 del mes anterior al 20 del mes actual.
// Ej: periodo "Junio 2026" = 21 mayo 2026 → 20 junio 2026

function getRangoPeriodo(anio, mes) {
  // mes: 1-12, representa el mes de CORTE (el mes cuyo día 20 cierra el periodo)
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

// Genera la lista de semanas (Domingo-Sábado) dentro de un periodo de nómina.
// Cada semana es un array de 7 fechas (Date), puede tener días fuera del periodo
// en la primera/última semana - esos se marcan como null.
function getSemanasDelPeriodo(anio, mes) {
  const { inicio, fin } = getRangoPeriodo(anio, mes);
  const semanas = [];

  // Retrocedemos al domingo de la semana que contiene "inicio"
  const cursor = new Date(inicio);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  while (cursor <= fin) {
    const semana = [];
    for (let i = 0; i < 7; i++) {
      const dia = new Date(cursor);
      dia.setDate(cursor.getDate() + i);
      // Solo incluir el día si cae dentro del rango del periodo
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
  const diff = r - p;
  return diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
}

function calcularHorasRealesDesdeLlegadaSalida(llegadaReal, salidaReal) {
  if (!llegadaReal || !salidaReal) return "";
  const [lh, lm] = llegadaReal.split(":").map(Number);
  const [sh, sm] = salidaReal.split(":").map(Number);
  if (isNaN(lh) || isNaN(lm) || isNaN(sh) || isNaN(sm)) return "";
  let llegadaMin = lh * 60 + lm;
  let salidaMin = sh * 60 + sm;
  if (salidaMin < llegadaMin) salidaMin += 24 * 60;
  const minutosTotales = salidaMin - llegadaMin - 60;
  if (minutosTotales <= 0) return "0";
  const horas = minutosTotales / 60;
  return horas % 1 === 0 ? String(horas) : horas.toFixed(1);
}

function esNoLaborable(estado) {
  return ["descanso", "incapacitado", "licencia_maternidad", "luto"].includes(estado);
}

const TURNOS_FIJOS = {
  t_inventario_manana: { llegada: "06:00", salida: "14:30", horasProgramadas: "7.5" },
  domingo_t_manana: { llegada: "07:30", salida: "15:00", horasProgramadas: "6.5", breakEditable: true },
  domingo_t_tarde: { llegada: "12:30", salida: "20:00", horasProgramadas: "6.5", breakEditable: true },
};

function esTurnoFijo(estado) {
  return Object.prototype.hasOwnProperty.call(TURNOS_FIJOS, estado);
}

function estaBloqueado(entry) {
  return esNoLaborable(entry.estado) || esTurnoFijo(entry.estado) || entry.cedula.trim() === "";
}

function parcialBloqueado(entry) {
  if (esTurnoFijo(entry.estado) && TURNOS_FIJOS[entry.estado].breakEditable) {
    return esNoLaborable(entry.estado) || entry.cedula.trim() === "";
  }
  return estaBloqueado(entry);
}

const HORARIOS_PREDETERMINADOS = {
  "06:00": "14:30",
  "07:00": "15:30",
  "07:30": "16:00",
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

// Dada una fecha (por defecto hoy), determina a qué periodo de nómina pertenece
// y qué semana del periodo le corresponde. El periodo de corte 20 funciona así:
// si el día es 21 o posterior, el periodo pertenece al MES SIGUIENTE (cierra el 20 de ese mes).
// si el día es 20 o anterior, el periodo pertenece al MES ACTUAL.
function getPeriodoActual(fechaRef) {
  const ref = fechaRef || new Date();
  const dia = ref.getDate();
  let anio = ref.getFullYear();
  let mes = ref.getMonth() + 1; // mes calendario 1-12

  if (dia >= 21) {
    // Pertenece al periodo que cierra el 20 del mes siguiente
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  // Si dia <= 20, pertenece al periodo que cierra el 20 de este mismo mes

  const semanas = getSemanasDelPeriodo(anio, mes);
  // Buscamos en qué semana cae la fecha de referencia
  const refSinHora = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let semanaIdx = 0;
  for (let i = 0; i < semanas.length; i++) {
    const tieneFecha = semanas[i].some((d) => d && d.getTime() === refSinHora.getTime());
    if (tieneFecha) { semanaIdx = i; break; }
  }

  return { anio, mes, semanaIdx };
}

// Limpia el campo "estado" de filas que no tienen nombre asignado.
// Sirve para corregir datos antiguos guardados con "trabaja" predeterminado
// en filas que en realidad están vacías (sin colaborador seleccionado).
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

export default function HorariosTienda({ codigoTienda, onSalir }) {
  const [tienda, setTienda] = useState("");
  const [codigo, setCodigo] = useState(codigoTienda);
  const [fecha, setFecha] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [days, setDays] = useState(diasVacios);
  const [nextId, setNextId] = useState(DIAS.length * ROWS_PER_DAY + 1);
  const [saveState, setSaveState] = useState("idle");
  const [loaded, setLoaded] = useState(false);
  const [showConsolidado, setShowConsolidado] = useState(false);

  // Periodo de nómina: corte el día 20. Se detecta automáticamente según la fecha de hoy,
  // así la tienda no tiene que seleccionar nada manualmente al entrar.
  const hoy = new Date();
  const periodoInicial = getPeriodoActual(hoy);
  const [anioPeriodo, setAnioPeriodo] = useState(periodoInicial.anio);
  const [mesPeriodo, setMesPeriodo] = useState(periodoInicial.mes);
  const [semanaIdx, setSemanaIdx] = useState(periodoInicial.semanaIdx);

  const semanasDelPeriodo = getSemanasDelPeriodo(anioPeriodo, mesPeriodo);
  // Si el índice quedó fuera de rango (ej. al cambiar de periodo), lo corregimos
  const semanaIdxSegura = Math.min(semanaIdx, semanasDelPeriodo.length - 1);
  const semanaFechas = semanasDelPeriodo[semanaIdxSegura] || [];
  const semanaKey = `${anioPeriodo}-${String(mesPeriodo).padStart(2, "0")}_semana_${semanaIdxSegura + 1}`;
  // Fecha del primer día válido de la semana actual, usada para autocompletar el campo "Fecha"
  const primerDiaSemana = semanaFechas.find((d) => d !== null);
  const fechaInicioSemana = primerDiaSemana ? formatFechaISO(primerDiaSemana) : "";

  const [empleados, setEmpleados] = useState([]);
  const [aprobaciones, setAprobaciones] = useState({});
  const [showEmpleados, setShowEmpleados] = useState(false);

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
          setDays(saved.days && saved.days.length ? limpiarEstadoFilasVacias(saved.days) : diasVacios(semanaFechas));
          setNextId(saved.nextId || DIAS.length * ROWS_PER_DAY + 1);
        } else {
          setFecha(fechaInicioSemana); setSupervisor(""); setDays(diasVacios(semanaFechas));
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
      persist({ tienda, codigo, fecha, supervisor, days, nextId }, semanaKey);
    }, 600);
    return () => clearTimeout(t);
  }, [tienda, codigo, fecha, supervisor, days, nextId, loaded, persist, semanaKey]);

  const updateEntry = (dia, entryId, field, value) => {
    if (field === "estado" && value === "trabaja") {
      const diaActualIdx = DIAS.indexOf(dia);
      const entryActual = days.find((d) => d.dia === dia)?.entries.find((e) => e.id === entryId);
      if (entryActual && entryActual.cedula.trim()) {
        const cedula = entryActual.cedula.trim();
        let ultimaSalidaMin = null;
        let ultimoDiaNombre = "";
        for (let i = 0; i < diaActualIdx; i++) {
          const diaAnterior = days[i];
          diaAnterior.entries.forEach((e) => {
            if (e.cedula.trim() === cedula && e.salida) {
              const [h, m] = e.salida.split(":").map(Number);
              if (!isNaN(h) && !isNaN(m)) {
                const minutos = i * 24 * 60 + h * 60 + m;
                if (ultimaSalidaMin === null || minutos > ultimaSalidaMin) {
                  ultimaSalidaMin = minutos;
                  ultimoDiaNombre = diaAnterior.dia;
                }
              }
            }
          });
        }
        if (ultimaSalidaMin !== null && entryActual.llegada) {
          const [lh, lm] = entryActual.llegada.split(":").map(Number);
          if (!isNaN(lh) && !isNaN(lm)) {
            const llegadaMin = diaActualIdx * 24 * 60 + lh * 60 + lm;
            const horasDescanso = (llegadaMin - ultimaSalidaMin) / 60;
            if (horasDescanso < 36) {
              alert(`⚠️ No se puede programar a este operario el día ${dia}.\n\nDesde su última salida el ${ultimoDiaNombre} solo habría ${horasDescanso.toFixed(1)} horas de descanso, y se requieren mínimo 36 horas continuas.`);
              return;
            }
          }
        }
      }
    }

    if (field === "llegada" && value) {
      const diaActualIdx = DIAS.indexOf(dia);
      const entryActual = days.find((d) => d.dia === dia)?.entries.find((e) => e.id === entryId);
      if (entryActual && entryActual.cedula.trim()) {
        const cedula = entryActual.cedula.trim();
        let ultimaSalida = null;
        let ultimoDiaNombre = "";
        for (let i = 0; i < diaActualIdx; i++) {
          const diaAnterior = days[i];
          diaAnterior.entries.forEach((e) => {
            if (e.cedula.trim() === cedula && e.salida && !esNoLaborable(e.estado)) {
              const [h, m] = e.salida.split(":").map(Number);
              if (!isNaN(h) && !isNaN(m)) {
                const minutos = i * 24 * 60 + h * 60 + m;
                if (ultimaSalida === null || minutos > ultimaSalida.minutos) {
                  ultimaSalida = { minutos, salida: e.salida };
                  ultimoDiaNombre = diaAnterior.dia;
                }
              }
            }
          });
        }
        if (ultimaSalida) {
          const turnoAnterior = getTurnoDesdeSalida(ultimaSalida.salida);
          const llegadasValidas = getLlegadasValidasDesdeTurno(turnoAnterior);
          if (turnoAnterior && llegadasValidas.length > 0 && !llegadasValidas.includes(value)) {
            const turnoNombre = turnoAnterior === "manana" ? "mañana" : "tarde";
            const llegadasTexto = llegadasValidas.map((h) => {
              const [hh, mm] = h.split(":");
              const hora = parseInt(hh);
              return `${hora > 12 ? hora - 12 : hora}:${mm} ${hora >= 12 ? "PM" : "AM"}`;
            }).join(" o ");
            alert(`⚠️ Este operario debe regresar al turno de ${turnoNombre}.\n\nSu última salida el ${ultimoDiaNombre} fue a las ${ultimaSalida.salida}. Debe volver con entrada: ${llegadasTexto}.`);
            return;
          }
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
            const match = empleados.find((emp) => emp.nombre === value);
            if (match) updated.cedula = match.cedula;
          }
          if (field === "cedula") {
            const match = empleados.find((emp) => emp.cedula === value);
            if (match) updated.nombre = match.nombre;
          }
          if (field === "estado" && esNoLaborable(value)) {
            updated = { ...updated, horasProgramadas: "", llegadaReal: "", salidaReal: "", horasReales: "", llegada: "", salida: "", breakInicio: "", breakFin: "", horasNocturnas: "" };
          }
          if (field === "estado" && esTurnoFijo(value)) {
            const turno = TURNOS_FIJOS[value];
            updated = { ...updated, llegada: turno.llegada, salida: turno.salida, horasProgramadas: turno.horasProgramadas, llegadaReal: "", salidaReal: "", horasReales: "", breakInicio: "", breakFin: "" };
          }
          if (field === "llegada") {
            const salidaAuto = HORARIOS_PREDETERMINADOS[value];
            updated.salida = salidaAuto || "";
            updated.horasProgramadas = salidaAuto ? "7.5" : "";
          }
          if (field === "breakInicio") {
            const breakFinAuto = sumarUnaHora(value);
            if (breakFinAuto) updated.breakFin = breakFinAuto;
          }
          if (field === "llegadaReal" || field === "salidaReal") {
            updated.horasReales = calcularHorasRealesDesdeLlegadaSalida(updated.llegadaReal, updated.salidaReal);
          }
          if (["horasProgramadas", "horasReales", "estado", "llegada", "llegadaReal", "salidaReal"].includes(field)) {
            updated.saldo = calcSaldo(updated.horasProgramadas, updated.horasReales);
          }
          if (["salida", "llegada", "estado", "horasProgramadas", "horasReales", "llegadaReal", "salidaReal"].includes(field)) {
            updated.horasNocturnas = calcularHorasNocturnas(updated.salidaReal || updated.salida);
          }
          return updated;
        });
        return { ...d, entries };
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

  const handlePrint = () => window.print();

  const consolidadoPorOperario = (() => {
    const mapa = {};
    days.forEach((d) => {
      d.entries.forEach((e) => {
        const nombre = e.nombre.trim();
        const cedula = e.cedula.trim();
        if (!nombre || !cedula) return;
        if (!mapa[cedula]) mapa[cedula] = { nombre, cedula, festivas: 0, nocturnas: 0, extrasFestivas: 0, extrasNormales: 0 };
        const reales = parseFloat(e.horasReales) || 0;
        const nocturnas = parseFloat(e.horasNocturnas) || 0;
        const saldo = parseFloat(e.saldo) || 0;
        const esDiaFestivo = d.dia === "Domingo" || e.esFestivo;
        mapa[cedula].nocturnas += nocturnas;
        if (esDiaFestivo) mapa[cedula].festivas += reales;
        if (saldo > 0) {
          if (esDiaFestivo) mapa[cedula].extrasFestivas += saldo;
          else mapa[cedula].extrasNormales += saldo;
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
      "Hrs Extras Festivas": Number(fmt(op.extrasFestivas)),
      "Hrs Extras Normales": Number(fmt(op.extrasNormales)),
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Consolidado");
    const nombreArchivo = `Consolidado_${tienda || "Tienda"}_${semanaKey}_${fecha || "sin_fecha"}.xlsx`.replace(/\s+/g, "_");
    XLSX.writeFile(libro, nombreArchivo);
  };

  return (
    <div className="root-wrap" style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#FFF6EE", minHeight: "100vh", color: "#241C14" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; }

          /* Página landscape con márgenes mínimos */
          @page { size: landscape; margin: 3mm; }

          /* Zoom para llenar toda la hoja */
          html, body {
            zoom: 0.68;
            width: 100%;
            overflow: visible;
            min-height: 0 !important;
            height: auto !important;
          }

          /* Eliminar minHeight: 100vh que genera el espacio vacío */
          body > div, #root, #root > div {
            min-height: 0 !important;
            height: auto !important;
            background: white !important;
          }

          .print-wrapper {
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            min-height: 0 !important;
            height: auto !important;
          }

          .sheet {
            box-shadow: none !important;
            padding: 4px 6px !important;
            margin: 0 !important;
            border-radius: 0 !important;
          }

          /* Tipografía compacta pero legible */
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

          /* Filas vacías ocultas */
          .empty-row { display: none !important; }

          /* Inputs y selects sin bordes */
          input, select {
            border: none !important;
            background: transparent !important;
            font-size: 8px !important;
            -webkit-appearance: none !important;
            appearance: none !important;
          }

          /* Ocultar columnas no esenciales en impresión */
          .col-break-inicio,
          .col-break-fin,
          .col-llegada-real,
          .col-salida-real,
          .col-nocturnas,
          .col-saldo,
          .col-saldo-festiva,
          .col-obs,
          .col-acciones { display: none !important; }

          /* Notas del encabezado compactas */
          .print-nota { font-size: 7px !important; padding-bottom: 3px !important; margin-bottom: 4px !important; line-height: 1.3 !important; }
          .store-info-grid { margin-bottom: 5px !important; gap: 6px !important; }
          .footer-supervisor { padding-top: 5px !important; }
          .firma-line { margin-top: 12px !important; }

          /* Header de pantalla oculto */
          .top-bar { display: none !important; }

          /* Eliminar altura mínima del contenedor raíz */
          .root-wrap {
            min-height: 0 !important;
            height: auto !important;
            background: white !important;
          }
        }

        input[type="time"]::-webkit-calendar-picker-indicator { opacity: 0.5; }
        .cell-input {
          width: 100%;
          border: none;
          background: transparent;
          font-size: 12.5px;
          font-family: inherit;
          color: #241C14;
          padding: 4px 2px;
          outline: none;
        }
        .cell-input:focus { background: #FFF1DC; border-radius: 3px; }
        .entry-row:hover { background: #FFFBF5; }
      `}</style>

      {/* Barra superior (oculta al imprimir) */}
      <div className="top-bar no-print" style={{ background: "#E85D1F", color: "#FFFFFF", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <img src={logoRitmo} alt="Tiendas RITMO" style={{ height: 32, marginBottom: 4 }} />
            <div style={{ fontSize: 20, fontWeight: 700 }}>Programación de Horarios Semanales</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={semanaIdxSegura}
              onChange={(e) => setSemanaIdx(Number(e.target.value))}
              title="Semana dentro del periodo de nómina actual"
              style={{ border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", background: "#FFFFFF", color: "#E85D1F", cursor: "pointer" }}
            >
              {semanasDelPeriodo.map((semana, i) => {
                const primerDia = semana.find((d) => d !== null);
                const ultimoDia = [...semana].reverse().find((d) => d !== null);
                const rango = primerDia && ultimoDia ? ` (${formatFechaCorta(primerDia)}–${formatFechaCorta(ultimoDia)})` : "";
                return <option key={i} value={i}>Semana {i + 1}{rango}</option>;
              })}
            </select>
            <SaveIndicator state={saveState} />
            <button onClick={() => setShowEmpleados(true)} style={btnStyle("#FFFFFF", "#E85D1F")}><Users size={15} /> Empleados</button>
            <button onClick={() => setShowConsolidado(true)} style={btnStyle("#FFFFFF", "#E85D1F")}><Clock size={15} /> Consolidado</button>
            <button onClick={handlePrint} style={btnStyle("#3FBFC4", "#FFFFFF")}><Printer size={15} /> Imprimir</button>
            <button onClick={onSalir} title="Salir" style={{ ...btnStyle("transparent", "#FFFFFF"), padding: 8 }}><LogOut size={16} /></button>
          </div>
        </div>
        <div style={{ maxWidth: 1400, margin: "8px auto 0", fontSize: 12, opacity: 0.9 }}>
          Periodo de nómina: <strong>{getPeriodoLabel(anioPeriodo, mesPeriodo)}</strong> (21 de {NOMBRES_MESES[(mesPeriodo - 2 + 12) % 12]} – 20 de {NOMBRES_MESES[mesPeriodo - 1]})
        </div>
      </div>

      {/* Contenido principal — este div se escala al imprimir */}
      <div className="print-wrapper" style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div className="sheet" style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 28 }}>

          {/* Nota de encabezado */}
          <div className="print-nota" style={{ fontSize: 11.5, color: "#6B5A4A", borderBottom: "2px solid #E85D1F", paddingBottom: 14, marginBottom: 18, lineHeight: 1.6 }}>
            <strong style={{ color: "#E85D1F" }}>NOTA:</strong> Cada colaborador debe disfrutar de 36 horas continuas de descanso semanal. Las horas extras por inventario deben ser mínimas; solo el turno de la tarde debe generarlas. El turno de inventario de la mañana entra a las 6:00 a.m. y sale a la 1:30 p.m. No se pagarán horas extras no justificadas: toda hora extra requiere observación y aprobación del Jefe de Zona.
          </div>

          {/* Info de tienda */}
          <div className="store-info-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
            <Field label="Nombre Tienda">
              <input value={tienda} onChange={(e) => setTienda(e.target.value)} style={fieldInputStyle} placeholder="Ej. Santiago Centro" />
            </Field>
            <Field label="Código">
              <input value={codigo} disabled style={{ ...fieldInputStyle, background: "#F2EFE9", color: "#5C5F5A", cursor: "not-allowed" }} />
            </Field>
            <Field label="Fecha">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={fieldInputStyle} />
            </Field>
          </div>

          {/* Días */}
          {days.map((d) => {
            if (d.fechaDate === null && semanaFechas.length) {
              // Día fuera del rango del periodo de nómina (primera/última semana parcial)
              return null;
            }
            const fechaLabel = d.fechaDate
              ? formatFechaCorta(new Date(d.fechaDate + "T00:00:00"))
              : "";
            return (
            <div key={d.dia} className="day-block" style={{ marginBottom: 22, border: "1px solid #E5E3DC", borderRadius: 8, overflow: "hidden" }}>
              <div className="day-header" style={{ background: "#E6F7F8", padding: "10px 14px" }}>
                <span className="day-title" style={{ fontWeight: 700, color: "#1B8388", fontSize: 13.5 }}>
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
                      <th style={thStyle}>Hora Llegada</th>
                      <th style={thStyle}>Hora Salida</th>
                      <th className="col-break-inicio no-print" style={thStyle}>Break Inicio</th>
                      <th className="col-break-fin no-print" style={thStyle}>Break Fin</th>
                      <th style={thStyle}>Hrs Prog.</th>
                      <th className="col-llegada-real no-print" style={thStyle}>Llegada Real</th>
                      <th className="col-salida-real no-print" style={thStyle}>Salida Real</th>
                      <th style={{ ...thStyle, minWidth: 90 }}>Hrs Reales</th>
                      <th className="col-nocturnas no-print" style={thStyle}>Hrs Noct.</th>
                      <th className="col-saldo no-print" style={thStyle}>Extra</th>
                      <th className="col-saldo-festiva no-print" style={thStyle}>Extra Festiva</th>
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
                          <input className="cell-input" value={entry.fecha} onChange={(e) => updateEntry(d.dia, entry.id, "fecha", e.target.value)} placeholder="06/16" />
                        </td>
                        <td style={tdStyle}>
                          <select className="cell-input" value={entry.nombre} onChange={(e) => updateEntry(d.dia, entry.id, "nombre", e.target.value)} style={{ fontWeight: 600, minWidth: 140, cursor: "pointer" }}>
                            <option value="">Seleccionar...</option>
                            {empleados.map((emp) => (<option key={emp.id} value={emp.nombre}>{emp.nombre}</option>))}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input className="cell-input" value={entry.cedula} readOnly placeholder="Selecciona un nombre"
                            style={{ minWidth: 100, background: entry.cedula.trim() === "" ? "#FCEBEB" : "#F2EFE9", borderRadius: 4, color: "#5C5F5A", cursor: "default" }} />
                        </td>
                        <td style={{ ...tdStyle, minWidth: 170 }}>
                          <select className="cell-input" value={entry.estado} onChange={(e) => updateEntry(d.dia, entry.id, "estado", e.target.value)}
                            style={{ cursor: "pointer", width: "100%", minWidth: 160, whiteSpace: "nowrap", fontWeight: estaBloqueado(entry) ? 700 : 400, color: esNoLaborable(entry.estado) ? "#946800" : esTurnoFijo(entry.estado) ? "#1B8388" : "#241C14" }}>
                            <option value="">Seleccionar...</option>
                            <option value="trabaja">Trabaja</option>
                            <option value="t_inventario_manana">T.Inventario mañana</option>
                            <option value="domingo_t_manana">Domingo T. mañana</option>
                            <option value="domingo_t_tarde">Domingo T. tarde</option>
                            <option value="descanso">Descanso</option>
                            <option value="incapacitado">Incapacitado</option>
                            <option value="licencia_maternidad">Licencia de maternidad</option>
                            <option value="luto">Luto</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <select key={`${entry.id}-${entry.estado}`} disabled={estaBloqueado(entry)} className="cell-input" value={entry.llegada} onChange={(e) => updateEntry(d.dia, entry.id, "llegada", e.target.value)}
                            style={{ cursor: "pointer", ...(estaBloqueado(entry) ? disabledCellStyle : {}) }}>
                            <option value="">--:-- --</option>
                            <option value="06:00">6:00 AM</option>
                            <option value="07:00">7:00 AM</option>
                            <option value="07:30">7:30 AM</option>
                            <option value="12:30">12:30 PM</option>
                            <option value="13:30">1:30 PM</option>
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input disabled readOnly type="time" className="cell-input" value={entry.salida}
                            style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                        </td>
                        <td className="col-break-inicio no-print" style={tdStyle}>
                          <input disabled={parcialBloqueado(entry)} type="time" className="cell-input" value={entry.breakInicio}
                            onChange={(e) => updateEntry(d.dia, entry.id, "breakInicio", e.target.value)}
                            style={parcialBloqueado(entry) ? disabledCellStyle : undefined} />
                        </td>
                        <td className="col-break-fin no-print" style={tdStyle}>
                          <input disabled readOnly type="time" className="cell-input" value={entry.breakFin}
                            style={{ background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                        </td>
                        <td style={tdStyle}>
                          <input disabled readOnly className="cell-input" value={entry.horasProgramadas} placeholder="0"
                            style={{ textAlign: "center", background: "#F2EFE9", color: "#5C5F5A", cursor: "default" }} />
                        </td>
                        <td className="col-llegada-real no-print" style={tdStyle}>
                          <input disabled={parcialBloqueado(entry)} type="time" className="cell-input" value={entry.llegadaReal}
                            onChange={(e) => updateEntry(d.dia, entry.id, "llegadaReal", e.target.value)}
                            style={parcialBloqueado(entry) ? disabledCellStyle : undefined} />
                        </td>
                        <td className="col-salida-real no-print" style={tdStyle}>
                          <input disabled={parcialBloqueado(entry)} type="time" className="cell-input" value={entry.salidaReal}
                            onChange={(e) => updateEntry(d.dia, entry.id, "salidaReal", e.target.value)}
                            style={parcialBloqueado(entry) ? disabledCellStyle : undefined} />
                        </td>
                        <td style={{ ...tdStyle, minWidth: 90 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, background: entry.esFestivo ? "#3FBFC4" : "transparent", borderRadius: 4 }}>
                            <input disabled readOnly className="cell-input" value={entry.horasReales} placeholder="0"
                              style={{ textAlign: "center", minWidth: 40, width: 40, flexShrink: 0, background: entry.esFestivo ? "transparent" : "#F2EFE9", color: entry.esFestivo ? "#04342C" : "#5C5F5A", fontWeight: entry.esFestivo ? 600 : 400, cursor: "default" }} />
                            <label className="no-print" title="Marcar como festivo"
                              style={{ display: "flex", alignItems: "center", cursor: estaBloqueado(entry) ? "not-allowed" : "pointer", paddingRight: 3 }}>
                              <input type="checkbox" disabled={estaBloqueado(entry)} checked={entry.esFestivo}
                                onChange={(e) => updateEntry(d.dia, entry.id, "esFestivo", e.target.checked)}
                                style={{ cursor: estaBloqueado(entry) ? "not-allowed" : "pointer" }} />
                            </label>
                          </div>
                        </td>
                        <td className="col-nocturnas no-print" style={tdStyle}>
                          <span style={{ fontSize: 12, color: "#5C5F5A", display: "block", textAlign: "center" }}>{entry.horasNocturnas || "0"}</span>
                        </td>
                        <td className="col-saldo no-print" style={tdStyle}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: entry.saldo.startsWith("+") ? "#B3261E" : entry.saldo.startsWith("-") ? "#946800" : "#5C5F5A" }}>
                            {(() => {
                              const esDiaFestivo = d.dia === "Domingo" || entry.esFestivo;
                              const saldoNum = parseFloat(entry.saldo) || 0;
                              if (esDiaFestivo && saldoNum > 0) return entry.saldo.startsWith("-") ? entry.saldo : "0";
                              return entry.saldo;
                            })()}
                          </span>
                        </td>
                        <td className="col-saldo-festiva no-print" style={tdStyle}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#B3261E" }}>
                            {(() => {
                              const esDiaFestivo = d.dia === "Domingo" || entry.esFestivo;
                              const saldoNum = parseFloat(entry.saldo) || 0;
                              if (esDiaFestivo && saldoNum > 0) return `+${saldoNum}`;
                              return "0";
                            })()}
                          </span>
                        </td>
                        <td className="col-firma-screen" style={tdStyle}>
                          <input disabled={estaBloqueado(entry)} className="cell-input" value={entry.firma}
                            onChange={(e) => updateEntry(d.dia, entry.id, "firma", e.target.value)}
                            style={estaBloqueado(entry) ? disabledCellStyle : undefined} />
                        </td>
                        <td className="col-obs no-print" style={tdStyle}>
                          <input disabled={estaBloqueado(entry)} className="cell-input" value={entry.observacion}
                            onChange={(e) => updateEntry(d.dia, entry.id, "observacion", e.target.value)}
                            placeholder="—" style={estaBloqueado(entry) ? disabledCellStyle : undefined} />
                        </td>
                        <td className="col-acciones no-print" style={tdStyle}>
                          {d.entries.length > 1 && (
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

              <div style={{ padding: "8px 14px", background: "#FAFAF7" }}>
                <button className="no-print" onClick={() => addEntry(d.dia)} style={{ ...btnStyle("transparent", "#E85D1F"), border: "1px dashed #E85D1F", padding: "5px 10px", fontSize: 12 }}>
                  <Plus size={13} /> Agregar colaborador a {d.dia}
                </button>
              </div>
            </div>
            );
          })}

          {/* Pie: supervisor */}
          <div className="footer-supervisor" style={{ paddingTop: 20, borderTop: "2px solid #E85D1F" }}>
            <div style={{ maxWidth: 420 }}>
              <Field label="Nombre Supervisor">
                <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={fieldInputStyle} placeholder="Nombre del supervisor" />
              </Field>
              <div className="firma-line" style={{ marginTop: 36, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>
                Firma Supervisor
              </div>
              <div className="firma-line" style={{ marginTop: 28, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>
                Aprobado por JDZ
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Consolidado */}
      {showConsolidado && (
        <div className="no-print"
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
          onClick={() => setShowConsolidado(false)}>
          <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#E85D1F" }}>Consolidado Semanal por Operario</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={exportarConsolidadoExcel} style={btnStyle("#3FBFC4", "#FFFFFF")}><FileSpreadsheet size={15} /> Exportar a Excel</button>
                <button onClick={() => setShowConsolidado(false)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "#5C5F5A" }}>✕</button>
              </div>
            </div>
            {consolidadoPorOperario.length === 0 ? (
              <div style={{ fontSize: 13, color: "#5C5F5A" }}>No hay colaboradores con datos registrados todavía.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                    <th style={thStyle}>Operario</th><th style={thStyle}>Cédula</th>
                    <th style={thStyle}>Hrs Festivas</th><th style={thStyle}>Hrs Nocturnas</th>
                    <th style={thStyle}>Extras Festivas</th><th style={thStyle}>Extras Normales</th>
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

  const handleEliminar = async (id) => {
    try {
      await supabase.from("empleados").delete().eq("id", id);
      await onRecargar();
      if (editandoId === id) limpiarFormulario();
    } catch (err) { setError("No se pudo eliminar. Intenta de nuevo."); }
  };

  return (
    <div className="no-print"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
      onClick={onClose}>
      <div style={{ background: "white", borderRadius: 10, padding: 24, maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}>
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
                      <button onClick={() => handleEliminar(emp.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#791F1F", fontSize: 12, fontWeight: 600 }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
