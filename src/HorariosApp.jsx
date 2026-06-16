import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Printer, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import logoRitmo from "./logo-ritmo.png";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const emptyEntry = (id) => ({
  id,
  estado: "trabaja",
  fecha: "",
  nombre: "",
  llegada: "",
  salida: "",
  breakInicio: "",
  breakFin: "",
  horasProgramadas: "",
  horasReales: "",
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
          const updated = { ...e, [field]: value };
          if (field === "horasProgramadas" || field === "horasReales") {
            updated.saldo = calcSaldo(
              field === "horasProgramadas" ? value : e.horasProgramadas,
              field === "horasReales" ? value : e.horasReales
            );
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

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#FFF6EE", minHeight: "100vh", color: "#241C14" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; }
          body { background: white !important; }
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
            <button onClick={handlePrint} style={btnStyle("#3FBFC4", "#FFFFFF")}>
              <Printer size={15} /> Imprimir
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 60px" }}>
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
            <div key={d.dia} style={{ marginBottom: 22, border: "1px solid #E5E3DC", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#E6F7F8", padding: "10px 14px" }}>
                <span style={{ fontWeight: 700, color: "#1B8388", fontSize: 13.5 }}>{d.dia}</span>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                      <Th>Mes/Día</Th>
                      <Th>Nombre</Th>
                      <Th>Estado</Th>
                      <Th>Hora Llegada</Th>
                      <Th>Hora Salida</Th>
                      <Th>Break Inicio</Th>
                      <Th>Break Fin</Th>
                      <Th>Hrs Programadas</Th>
                      <Th>Hrs Reales</Th>
                      <Th>Saldo</Th>
                      <Th>Firma</Th>
                      <Th>Observación</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.entries.map((entry) => (
                      <tr key={entry.id} className="entry-row">
                        <Td>
                          <input className="cell-input" value={entry.fecha} onChange={(e) => updateEntry(d.dia, entry.id, "fecha", e.target.value)} placeholder="06/16" />
                        </Td>
                        <Td>
                          <input className="cell-input" value={entry.nombre} onChange={(e) => updateEntry(d.dia, entry.id, "nombre", e.target.value)} placeholder="Nombre del colaborador" style={{ fontWeight: 600, minWidth: 140 }} />
                        </Td>
                        <Td>
                          <select
                            className="cell-input"
                            value={entry.estado}
                            onChange={(e) => updateEntry(d.dia, entry.id, "estado", e.target.value)}
                            style={{
                              cursor: "pointer",
                              fontWeight: entry.estado === "descanso" ? 700 : 400,
                              color: entry.estado === "descanso" ? "#946800" : "#241C14",
                            }}
                          >
                            <option value="trabaja">Trabaja</option>
                            <option value="descanso">Descanso</option>
                          </select>
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} type="time" className="cell-input" value={entry.llegada} onChange={(e) => updateEntry(d.dia, entry.id, "llegada", e.target.value)} style={entry.estado === "descanso" ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} type="time" className="cell-input" value={entry.salida} onChange={(e) => updateEntry(d.dia, entry.id, "salida", e.target.value)} style={entry.estado === "descanso" ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} type="time" className="cell-input" value={entry.breakInicio} onChange={(e) => updateEntry(d.dia, entry.id, "breakInicio", e.target.value)} style={entry.estado === "descanso" ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} type="time" className="cell-input" value={entry.breakFin} onChange={(e) => updateEntry(d.dia, entry.id, "breakFin", e.target.value)} style={entry.estado === "descanso" ? disabledCellStyle : undefined} />
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} className="cell-input" value={entry.horasProgramadas} onChange={(e) => updateEntry(d.dia, entry.id, "horasProgramadas", e.target.value)} placeholder="0" style={{ textAlign: "center", ...(entry.estado === "descanso" ? disabledCellStyle : {}) }} />
                        </Td>
                        <Td>
                          <input disabled={entry.estado === "descanso"} className="cell-input" value={entry.horasReales} onChange={(e) => updateEntry(d.dia, entry.id, "horasReales", e.target.value)} placeholder="0" style={{ textAlign: "center", ...(entry.estado === "descanso" ? disabledCellStyle : {}) }} />
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
                          <input className="cell-input" value={entry.observacion} onChange={(e) => updateEntry(d.dia, entry.id, "observacion", e.target.value)} placeholder={entry.estado === "descanso" ? "Descanso" : "—"} />
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
