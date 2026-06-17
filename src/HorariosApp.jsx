import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Printer, Clock, AlertCircle, CheckCircle2, Loader2, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import logoRitmo from "./logo-ritmo.png";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const emptyEntry = (id) => ({
  id,
  estado: "trabaja",
  fecha: "",
  nombre: "",
  cedula: "",
  llegada: "",
  salida: "",
  breakInicio: "",
  breakFin: "",
  horasProgramadas: "",
  horasReales: "",
  esFestivo: false,
  horasNocturnas: "",
  saldo: "",
  firma: "",
  observacion: "",
});

const ROWS_PER_DAY = 8;

const emptyDay = (dia, idStart) => ({
  dia,
  entries: Array.from({ length: ROWS_PER_DAY }, (_, i) => emptyEntry(idStart + i)),
});

const STORAGE_KEY = "ritmo-horarios-v2";

function calcSaldo(prog, real) {
  const p = parseFloat(prog);
  const r = parseFloat(real);
  if (isNaN(p) || isNaN(r)) return "";
  const diff = r - p;
  return diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
}

function esNoLaborable(estado) {
  return ["descanso", "incapacitado", "licencia_maternidad", "luto"].includes(estado);
}

const TURNOS_FIJOS = {
  t_inventario_manana: { llegada: "06:00", salida: "14:30", horasProgramadas: "7.5" },
};

function esTurnoFijo(estado) {
  return Object.prototype.hasOwnProperty.call(TURNOS_FIJOS, estado);
}

function estaBloqueado(estado) {
  return esNoLaborable(estado) || esTurnoFijo(estado);
}

const HORARIOS_PREDETERMINADOS = {
  "06:00": "14:30",
  "07:30": "16:00",
  "13:30": "22:00",
};

function calcularSalidaAutomatica(horaLlegada) {
  return HORARIOS_PREDETERMINADOS[horaLlegada] || null;
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

const INICIO_NOCTURNO_MIN = 21 * 60; // 9:00 p.m.

function calcularHorasNocturnas(horaSalida) {
  if (!horaSalida) return "";
  const [h, m] = horaSalida.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  let salidaMin = h * 60 + m;
  // Si la salida cae en la madrugada (ej. 00:30), se asume que es despues de medianoche
  if (salidaMin < INICIO_NOCTURNO_MIN && salidaMin < 6 * 60) {
    salidaMin += 24 * 60;
  }
  if (salidaMin <= INICIO_NOCTURNO_MIN) return "0";
  const minutosNocturnos = salidaMin - INICIO_NOCTURNO_MIN;
  const horas = minutosNocturnos / 60;
  return horas % 1 === 0 ? String(horas) : horas.toFixed(1);
}

export default function HorariosApp() {
  const [tienda, setTienda] = useState("");
  const [codigo, setCodigo] = useState("");
  const [fecha, setFecha] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [days, setDays] = useState(() => {
    let id = 1;
    return DIAS.map((d) => {
      const day = emptyDay(d, id);
      id += ROWS_PER_DAY;
      return day;
    });
  });
  const [nextId, setNextId] = useState(DIAS.length * ROWS_PER_DAY + 1);
  const [saveState, setSaveState] = useState("idle");
  const [loaded, setLoaded] = useState(false);
  const [showConsolidado, setShowConsolidado] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setTienda(data.tienda || "");
        setCodigo(data.codigo || "");
        setFecha(data.fecha || "");
        setSupervisor(data.supervisor || "");
        setDays(
          data.days && data.days.length
            ? data.days
            : (() => {
                let id = 1;
                return DIAS.map((d) => {
                  const day = emptyDay(d, id);
                  id += ROWS_PER_DAY;
                  return day;
                });
              })()
        );
        setNextId(data.nextId || DIAS.length * ROWS_PER_DAY + 1);
      }
    } catch (e) {
      // no existing data yet
    } finally {
      setLoaded(true);
    }
  }, []);

  const persist = useCallback(async (state) => {
    setSaveState("saving");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      persist({ tienda, codigo, fecha, supervisor, days, nextId });
    }, 600);
    return () => clearTimeout(t);
  }, [tienda, codigo, fecha, supervisor, days, nextId, loaded, persist]);

  const updateEntry = (dia, entryId, field, value) => {
    setDays((prev) =>
      prev.map((d) => {
        if (d.dia !== dia) return d;
        const entries = d.entries.map((e) => {
          if (e.id !== entryId) return e;
          let updated = { ...e, [field]: value };

          if (field === "estado" && esNoLaborable(value)) {
            updated.horasProgramadas = "";
            updated.horasReales = "";
            updated.llegada = "";
            updated.salida = "";
            updated.breakInicio = "";
            updated.breakFin = "";
            updated.horasNocturnas = "";
          }

          if (field === "estado" && esTurnoFijo(value)) {
            const turno = TURNOS_FIJOS[value];
            updated.llegada = turno.llegada;
            updated.salida = turno.salida;
            updated.horasProgramadas = turno.horasProgramadas;
            updated.horasReales = "";
            updated.breakInicio = "";
            updated.breakFin = "";
          }

          if (field === "llegada") {
            const salidaAuto = calcularSalidaAutomatica(value);
            if (salidaAuto) {
              updated.salida = salidaAuto;
              updated.horasProgramadas = "7.5";
            }
          }

          if (field === "breakInicio") {
            const breakFinAuto = sumarUnaHora(value);
            if (breakFinAuto) {
              updated.breakFin = breakFinAuto;
            }
          }

          if (field === "salida" || field === "llegada" || field === "estado") {
            updated.horasNocturnas = calcularHorasNocturnas(updated.salida);
          }

          if (field === "horasProgramadas" || field === "horasReales" || field === "estado" || field === "llegada") {
            updated.saldo = calcSaldo(updated.horasProgramadas, updated.horasReales);
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

  const totalProgramadas = days.reduce(
    (sum, d) => sum + d.entries.reduce((s, e) => s + (parseFloat(e.horasProgramadas) || 0), 0),
    0
  );
  const totalReales = days.reduce(
    (sum, d) => sum + d.entries.reduce((s, e) => s + (parseFloat(e.horasReales) || 0), 0),
    0
  );
  const saldoTotal = totalReales - totalProgramadas;

  const handlePrint = () => window.print();

  const consolidadoPorOperario = (() => {
    const mapa = {};
    days.forEach((d) => {
      d.entries.forEach((e) => {
        const nombre = e.nombre.trim();
        const cedula = e.cedula.trim();
        if (!nombre && !cedula) return;
        const clave = cedula || `__sin_cedula__${nombre}`;
        if (!mapa[clave]) {
          mapa[clave] = { nombre, cedula, dominicales: 0, festivas: 0, totalSemanal: 0, nocturnas: 0 };
        }
        if (!mapa[clave].nombre && nombre) mapa[clave].nombre = nombre;
        const reales = parseFloat(e.horasReales) || 0;
        const nocturnas = parseFloat(e.horasNocturnas) || 0;
        mapa[clave].totalSemanal += reales;
        mapa[clave].nocturnas += nocturnas;
        if (d.dia === "Domingo") {
          mapa[clave].dominicales += reales;
        }
        if (d.dia === "Domingo" || e.esFestivo) {
          mapa[clave].festivas += reales;
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
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Consolidado");
    const nombreArchivo = `Consolidado_${tienda || "Tienda"}_${fecha || "sin_fecha"}.xlsx`.replace(/\s+/g, "_");
    XLSX.writeFile(libro, nombreArchivo);
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#FFF6EE", minHeight: "100vh", color: "#241C14" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; padding: 6px !important; }
          body { background: white !important; }
          @page { size: landscape; margin: 4mm; }
          html, body { width: 100%; height: auto; }
          .print-scale {
            transform: scale(0.78);
            transform-origin: top left;
            width: 128.2%;
          }
          table { font-size: 9px !important; }
          th, td { padding: 1px 3px !important; }
          .cell-input { font-size: 9px !important; padding: 1px !important; }
          h1, .day-title { font-size: 11px !important; }
          .day-block { margin-bottom: 4px !important; }
          .print-table { min-width: 0 !important; }
          .empty-row { display: none !important; }
          .day-header { padding: 2px 8px !important; }
          .sheet { padding: 6px !important; }
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
        .cell-input:focus {
          background: #FFF1DC;
          border-radius: 3px;
        }
        .entry-row:hover { background: #FFFBF5; }
      `}</style>

      <div className="no-print" style={{ background: "#E85D1F", color: "#FFFFFF", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <img src={logoRitmo} alt="Tiendas RITMO" style={{ height: 32, marginBottom: 4 }} />
            <div style={{ fontSize: 20, fontWeight: 700 }}>Programación de Horarios Semanales</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SaveIndicator state={saveState} />
            <button onClick={() => setShowConsolidado(true)} className="no-print" style={btnStyle("#FFFFFF", "#E85D1F")}>
              <Clock size={15} /> Consolidado
            </button>
            <button onClick={handlePrint} style={btnStyle("#3FBFC4", "#FFFFFF")}>
              <Printer size={15} /> Imprimir
            </button>
          </div>
        </div>
      </div>

      <div className="print-scale" style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div className="sheet" style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 28 }}>
          {/* Header notes */}
          <div style={{ fontSize: 11.5, color: "#6B5A4A", borderBottom: "2px solid #E85D1F", paddingBottom: 14, marginBottom: 18, lineHeight: 1.6 }}>
            <strong style={{ color: "#E85D1F" }}>Tiendas RITMO</strong> · "Precios bajos todos los días" — Cada colaborador debe disfrutar de 36 horas continuas de descanso semanal. Las horas extras por inventario deben ser mínimas; solo el turno de la tarde debe generarlas. El turno de la mañana entra a las 6:00 a.m. y sale a la 1:30 p.m. No se pagarán horas extras no justificadas: toda hora extra requiere observación y aprobación del Jefe de Zona.
          </div>

          {/* Store info */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
            <Field label="Nombre Tienda">
              <input value={tienda} onChange={(e) => setTienda(e.target.value)} style={fieldInputStyle} placeholder="Ej. Santiago Centro" />
            </Field>
            <Field label="Código">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} style={fieldInputStyle} placeholder="Ej. RIT-014" />
            </Field>
            <Field label="Fecha">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={fieldInputStyle} />
            </Field>
          </div>

          {/* Days */}
          {days.map((d) => (
            <div key={d.dia} className="day-block" style={{ marginBottom: 22, border: "1px solid #E5E3DC", borderRadius: 8, overflow: "hidden" }}>
              <div className="day-header" style={{ background: "#E6F7F8", padding: "10px 14px" }}>
                <span className="day-title" style={{ fontWeight: 700, color: "#1B8388", fontSize: 13.5 }}>{d.dia}</span>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="print-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                      <Th>Mes/Día</Th>
                      <Th>Nombre</Th>
                      <Th>Cédula</Th>
                      <Th>Estado</Th>
                      <Th>Hora Llegada</Th>
                      <Th>Hora Salida</Th>
                      <Th>Break Inicio</Th>
                      <Th>Break Fin</Th>
                      <Th>Hrs Programadas</Th>
                      <Th>Hrs Reales</Th>
                      <Th>Hrs Nocturnas</Th>
                      <Th>Saldo</Th>
                      <Th>Firma</Th>
                      <Th>Observación</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.entries.map((entry) => (
                      <tr key={entry.id} className={`entry-row ${entry.nombre.trim() === "" ? "empty-row" : ""}`}>
                        <Td>
                          <input className="cell-input" value={entry.fecha} onChange={(e) => updateEntry(d.dia, entry.id, "fecha", e.target.value)} placeholder="06/16" />
                        </Td>
                        <Td>
                          <input className="cell-input" value={entry.nombre} onChange={(e) => updateEntry(d.dia, entry.id, "nombre", e.target.value)} placeholder="Nombre del colaborador" style={{ fontWeight: 600, minWidth: 140 }} />
                        </Td>
                        <Td>
                          <input className="cell-input" value={entry.cedula} onChange={(e) => updateEntry(d.dia, entry.id, "cedula", e.target.value)} placeholder="000-0000000-0" style={{ minWidth: 100 }} />
                        </Td>
                        <Td>
                          <select
                            className="cell-input"
                            value={entry.estado}
                            onChange={(e) => updateEntry(d.dia, entry.id, "estado", e.target.value)}
                            style={{
                              cursor: "pointer",
                              fontWeight: estaBloqueado(entry.estado) ? 700 : 400,
                              color: esNoLaborable(entry.estado) ? "#946800" : esTurnoFijo(entry.estado) ? "#1B8388" : "#241C14",
                            }}
                          >
                            <option value="trabaja">Trabaja</option>
                            <option value="t_inventario_manana">T.Inventario mañana</option>
                            <option value="descanso">Descanso</option>
                            <option value="incapacitado">Incapacitado</option>
                            <option value="licencia_maternidad">Licencia de maternidad</option>
                            <option value="luto">Luto</option>
                          </select>
                        </Td>
                        <Td>
                          <select
                            disabled={estaBloqueado(entry.estado)}
                            className="cell-input"
                            value={entry.llegada}
                            onChange={(e) => updateEntry(d.dia, entry.id, "llegada", e.target.value)}
                            style={{ cursor: "pointer", ...(estaBloqueado(entry.estado) ? disabledCellStyle : {}) }}
                          >
                            <option value="">--:-- --</option>
                            <option value="06:00">6:00 AM</option>
                            <option value="07:30">7:30 AM</option>
                            <option value="13:30">1:30 PM</option>
                          </select>
                        </Td>
                        <Td>
                          <input disabled={estaBloqueado(entry.estado)} type="time" className="cell-input" value={entry.salida} onChange={(e) => updateEntry(d.dia, entry.id, "salida", e.target.value)} style={estaBloqueado(entry.estado) ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={estaBloqueado(entry.estado)} type="time" className="cell-input" value={entry.breakInicio} onChange={(e) => updateEntry(d.dia, entry.id, "breakInicio", e.target.value)} style={estaBloqueado(entry.estado) ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={estaBloqueado(entry.estado)} type="time" className="cell-input" value={entry.breakFin} onChange={(e) => updateEntry(d.dia, entry.id, "breakFin", e.target.value)} style={estaBloqueado(entry.estado) ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={estaBloqueado(entry.estado)} className="cell-input" value={entry.horasProgramadas} onChange={(e) => updateEntry(d.dia, entry.id, "horasProgramadas", e.target.value)} placeholder="0" style={{ textAlign: "center", ...(estaBloqueado(entry.estado) ? disabledCellStyle : {}) }} />
                        </Td>
                        <Td>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, background: entry.esFestivo ? "#3FBFC4" : "transparent", borderRadius: 4 }}>
                            <input
                              disabled={estaBloqueado(entry.estado)}
                              className="cell-input"
                              value={entry.horasReales}
                              onChange={(e) => updateEntry(d.dia, entry.id, "horasReales", e.target.value)}
                              placeholder="0"
                              style={{
                                textAlign: "center",
                                ...(estaBloqueado(entry.estado) ? disabledCellStyle : {}),
                                ...(entry.esFestivo ? { background: "transparent", color: "#04342C", fontWeight: 600 } : {}),
                              }}
                            />
                            <label
                              className="no-print"
                              title="Marcar como festivo"
                              style={{ display: "flex", alignItems: "center", cursor: estaBloqueado(entry.estado) ? "not-allowed" : "pointer", paddingRight: 3 }}
                            >
                              <input
                                type="checkbox"
                                disabled={estaBloqueado(entry.estado)}
                                checked={entry.esFestivo}
                                onChange={(e) => updateEntry(d.dia, entry.id, "esFestivo", e.target.checked)}
                                style={{ cursor: estaBloqueado(entry.estado) ? "not-allowed" : "pointer" }}
                              />
                            </label>
                          </div>
                        </Td>
                        <Td>
                          <span style={{ fontSize: 12, color: "#5C5F5A", display: "block", textAlign: "center" }}>
                            {entry.horasNocturnas || "0"}
                          </span>
                        </Td>
                        <Td>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: entry.saldo.startsWith("+") ? "#B3261E" : entry.saldo.startsWith("-") ? "#946800" : "#5C5F5A",
                            }}
                          >
                            {entry.saldo}
                          </span>
                        </Td>
                        <Td>
                          <input className="cell-input" value={entry.firma} onChange={(e) => updateEntry(d.dia, entry.id, "firma", e.target.value)} />
                        </Td>
                        <Td>
                          <input className="cell-input" value={entry.observacion} onChange={(e) => updateEntry(d.dia, entry.id, "observacion", e.target.value)} placeholder="—" />
                        </Td>
                        <Td>
                          {d.entries.length > 1 && (
                            <button className="no-print" onClick={() => removeEntry(d.dia, entry.id)} style={iconBtnStyle}>
                              <Trash2 size={14} color="#B3261E" />
                            </button>
                          )}
                        </Td>
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
          ))}

          {/* Footer: supervisor + totals */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, paddingTop: 20, borderTop: "2px solid #E85D1F" }}>
            <div>
              <Field label="Nombre Supervisor">
                <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={fieldInputStyle} placeholder="Nombre del supervisor" />
              </Field>
              <div style={{ marginTop: 36, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>
                Firma Supervisor
              </div>
              <div style={{ marginTop: 28, borderTop: "1px solid #C9C6BC", paddingTop: 6, fontSize: 11.5, color: "#5C5F5A", maxWidth: 280 }}>
                Aprobado por JDZ
              </div>
            </div>

            <div style={{ background: "#E6F7F8", borderRadius: 8, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, color: "#1B8388", fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Clock size={14} /> Resumen Semanal
              </div>
              <SummaryRow label="Total Horas Programadas" value={totalProgramadas} />
              <SummaryRow label="Total Horas Cumplidas" value={totalReales} />
              <div style={{ height: 1, background: "#C9C6BC", margin: "10px 0" }} />
              <SummaryRow
                label="SALDO"
                value={saldoTotal}
                bold
                color={saldoTotal > 0 ? "#B3261E" : saldoTotal < 0 ? "#946800" : "#1B8388"}
              />
            </div>
          </div>
        </div>
      </div>

      {showConsolidado && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(36,28,20,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 20,
          }}
          onClick={() => setShowConsolidado(false)}
        >
          <div
            style={{
              background: "white",
              borderRadius: 10,
              padding: 24,
              maxWidth: 720,
              width: "100%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#E85D1F" }}>Consolidado Semanal por Operario</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={exportarConsolidadoExcel} style={btnStyle("#3FBFC4", "#FFFFFF")}>
                  <FileSpreadsheet size={15} /> Exportar a Excel
                </button>
                <button onClick={() => setShowConsolidado(false)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "#5C5F5A" }}>
                  ✕
                </button>
              </div>
            </div>

            {consolidadoPorOperario.length === 0 ? (
              <div style={{ fontSize: 13, color: "#5C5F5A" }}>No hay colaboradores con datos registrados todavía.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                    <Th>Operario</Th>
                    <Th>Cédula</Th>
                    <Th>Hrs Festivas</Th>
                    <Th>Hrs Nocturnas</Th>
                  </tr>
                </thead>
                <tbody>
                  {consolidadoPorOperario.map((op) => (
                    <tr key={op.cedula || op.nombre} style={{ borderTop: "1px solid #EDEBE4" }}>
                      <Td style={{ fontWeight: 600 }}>{op.nombre || "(Sin nombre)"}</Td>
                      <Td>{op.cedula || "—"}</Td>
                      <Td>{fmt(op.festivas)}</Td>
                      <Td>{fmt(op.nocturnas)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#5C5F5A", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: "9px 8px", textAlign: "left", fontWeight: 600 }}>{children}</th>;
}

function Td({ children, style }) {
  return <td style={{ padding: "4px 8px", fontSize: 12.5, verticalAlign: "middle", borderTop: "1px solid #EDEBE4", ...style }}>{children}</td>;
}

function SummaryRow({ label, value, bold, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 700 : 500, padding: "4px 0", color: color || "#241C14" }}>
      <span>{label}</span>
      <span>{Number.isFinite(value) ? value : 0} h</span>
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

const disabledCellStyle = {
  background: "#F2EFE9",
  color: "#A6A199",
  cursor: "not-allowed",
};

const fieldInputStyle = {  width: "100%",
  border: "1px solid #DEDBD2",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  background: "#FAFAF8",
  outline: "none",
  color: "#241C14",
};

function btnStyle(bg, color) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: bg,
    color,
    border: "none",
    borderRadius: 7,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const iconBtnStyle = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 4,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
};
