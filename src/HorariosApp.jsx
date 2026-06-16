import React, { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, Printer, Users, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const emptyRow = (dia) => ({
  dia,
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

const emptyEmployee = (id) => ({
  id,
  nombre: "",
  rows: DIAS.map((d) => emptyRow(d)),
});

const STORAGE_KEY = "ritmo-horarios-v1";

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
  const [employees, setEmployees] = useState([emptyEmployee(1)]);
  const [nextId, setNextId] = useState(2);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [loaded, setLoaded] = useState(false);

  // Load on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setTienda(data.tienda || "");
        setCodigo(data.codigo || "");
        setFecha(data.fecha || "");
        setSupervisor(data.supervisor || "");
        setEmployees(data.employees && data.employees.length ? data.employees : [emptyEmployee(1)]);
        setNextId(data.nextId || 2);
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
      persist({ tienda, codigo, fecha, supervisor, employees, nextId });
    }, 600);
    return () => clearTimeout(t);
  }, [tienda, codigo, fecha, supervisor, employees, nextId, loaded, persist]);

  const updateRow = (empId, dia, field, value) => {
    setEmployees((prev) =>
      prev.map((emp) => {
        if (emp.id !== empId) return emp;
        const rows = emp.rows.map((r) => {
          if (r.dia !== dia) return r;
          const updated = { ...r, [field]: value };
          if (field === "horasProgramadas" || field === "horasReales") {
            updated.saldo = calcSaldo(
              field === "horasProgramadas" ? value : r.horasProgramadas,
              field === "horasReales" ? value : r.horasReales
            );
          }
          return updated;
        });
        return { ...emp, rows };
      })
    );
  };

  const updateEmpName = (empId, value) => {
    setEmployees((prev) =>
      prev.map((emp) =>
        emp.id === empId
          ? { ...emp, nombre: value, rows: emp.rows.map((r) => ({ ...r, nombre: value })) }
          : emp
      )
    );
  };

  const addEmployee = () => {
    setEmployees((prev) => [...prev, emptyEmployee(nextId)]);
    setNextId((n) => n + 1);
  };

  const removeEmployee = (empId) => {
    setEmployees((prev) => (prev.length > 1 ? prev.filter((e) => e.id !== empId) : prev));
  };

  const totalProgramadas = employees.reduce(
    (sum, emp) => sum + emp.rows.reduce((s, r) => s + (parseFloat(r.horasProgramadas) || 0), 0),
    0
  );
  const totalReales = employees.reduce(
    (sum, emp) => sum + emp.rows.reduce((s, r) => s + (parseFloat(r.horasReales) || 0), 0),
    0
  );
  const saldoTotal = totalReales - totalProgramadas;

  const handlePrint = () => window.print();

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#F6F5F2", minHeight: "100vh", color: "#1F2421" }}>
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
          color: #1F2421;
          padding: 4px 2px;
          outline: none;
        }
        .cell-input:focus {
          background: #FFF8E7;
          border-radius: 3px;
        }
        .day-row:hover { background: #FAFAF7; }
      `}</style>

      <div className="no-print" style={{ background: "#1F4D3D", color: "#F6F5F2", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>Tiendas RITMO</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Programación de Horarios Semanales</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SaveIndicator state={saveState} />
            <button onClick={handlePrint} style={btnStyle("#F6F5F2", "#1F4D3D")}>
              <Printer size={15} /> Imprimir
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div className="sheet" style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 28 }}>
          {/* Header notes */}
          <div style={{ fontSize: 11.5, color: "#5C5F5A", borderBottom: "2px solid #1F4D3D", paddingBottom: 14, marginBottom: 18, lineHeight: 1.6 }}>
            <strong style={{ color: "#1F4D3D" }}>Tiendas RITMO</strong> · "Precios bajos todos los días" — Cada colaborador debe disfrutar de 36 horas continuas de descanso semanal. Las horas extras por inventario deben ser mínimas; solo el turno de la tarde debe generarlas. El turno de la mañana entra a las 6:00 a.m. y sale a la 1:30 p.m. No se pagarán horas extras no justificadas: toda hora extra requiere observación y aprobación del Jefe de Zona.
          </div>

          {/* Store info */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
            <Field label="Nombre Tienda">
              <input className="field-input" value={tienda} onChange={(e) => setTienda(e.target.value)} style={fieldInputStyle} placeholder="Ej. Santiago Centro" />
            </Field>
            <Field label="Código">
              <input className="field-input" value={codigo} onChange={(e) => setCodigo(e.target.value)} style={fieldInputStyle} placeholder="Ej. RIT-014" />
            </Field>
            <Field label="Fecha">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={fieldInputStyle} />
            </Field>
          </div>

          {/* Employees */}
          {employees.map((emp, idx) => (
            <div key={emp.id} style={{ marginBottom: 26, border: "1px solid #E5E3DC", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#F0EEE7", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                  <Users size={15} color="#1F4D3D" />
                  <input
                    value={emp.nombre}
                    onChange={(e) => updateEmpName(emp.id, e.target.value)}
                    placeholder={`Nombre del colaborador ${idx + 1}`}
                    style={{ ...fieldInputStyle, background: "white", maxWidth: 320, fontWeight: 600 }}
                  />
                </div>
                {employees.length > 1 && (
                  <button className="no-print" onClick={() => removeEmployee(emp.id)} style={iconBtnStyle}>
                    <Trash2 size={15} color="#B3261E" />
                  </button>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                      <Th>Día</Th>
                      <Th>Mes/Día</Th>
                      <Th>Hora Llegada</Th>
                      <Th>Hora Salida</Th>
                      <Th>Break Inicio</Th>
                      <Th>Break Fin</Th>
                      <Th>Hrs Programadas</Th>
                      <Th>Hrs Reales</Th>
                      <Th>Saldo</Th>
                      <Th>Firma</Th>
                      <Th>Observación</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.rows.map((row) => (
                      <tr key={row.dia} className="day-row" style={{ borderTop: "1px solid #EDEBE4" }}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: "#1F4D3D", whiteSpace: "nowrap" }}>{row.dia}</td>
                        <Td>
                          <input className="cell-input" value={row.fecha} onChange={(e) => updateRow(emp.id, row.dia, "fecha", e.target.value)} placeholder="06/16" />
                        </Td>
                        <Td>
                          <input type="time" className="cell-input" value={row.llegada} onChange={(e) => updateRow(emp.id, row.dia, "llegada", e.target.value)} />
                        </Td>
                        <Td>
                          <input type="time" className="cell-input" value={row.salida} onChange={(e) => updateRow(emp.id, row.dia, "salida", e.target.value)} />
                        </Td>
                        <Td>
                          <input type="time" className="cell-input" value={row.breakInicio} onChange={(e) => updateRow(emp.id, row.dia, "breakInicio", e.target.value)} />
                        </Td>
                        <Td>
                          <input type="time" className="cell-input" value={row.breakFin} onChange={(e) => updateRow(emp.id, row.dia, "breakFin", e.target.value)} />
                        </Td>
                        <Td>
                          <input className="cell-input" value={row.horasProgramadas} onChange={(e) => updateRow(emp.id, row.dia, "horasProgramadas", e.target.value)} placeholder="0" style={{ textAlign: "center" }} />
                        </Td>
                        <Td>
                          <input className="cell-input" value={row.horasReales} onChange={(e) => updateRow(emp.id, row.dia, "horasReales", e.target.value)} placeholder="0" style={{ textAlign: "center" }} />
                        </Td>
                        <Td>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: row.saldo.startsWith("+") ? "#B3261E" : row.saldo.startsWith("-") ? "#946800" : "#5C5F5A",
                            }}
                          >
                            {row.saldo}
                          </span>
                        </Td>
                        <Td>
                          <input className="cell-input" value={row.firma} onChange={(e) => updateRow(emp.id, row.dia, "firma", e.target.value)} />
                        </Td>
                        <Td>
                          <input className="cell-input" value={row.observacion} onChange={(e) => updateRow(emp.id, row.dia, "observacion", e.target.value)} placeholder="—" />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <button className="no-print" onClick={addEmployee} style={{ ...btnStyle("#1F4D3D", "white"), marginBottom: 28 }}>
            <Plus size={15} /> Agregar colaborador
          </button>

          {/* Footer: supervisor + totals */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, paddingTop: 20, borderTop: "2px solid #1F4D3D" }}>
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

            <div style={{ background: "#F0EEE7", borderRadius: 8, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, color: "#1F4D3D", fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <Clock size={14} /> Resumen Semanal
              </div>
              <SummaryRow label="Total Horas Programadas" value={totalProgramadas} />
              <SummaryRow label="Total Horas Cumplidas" value={totalReales} />
              <div style={{ height: 1, background: "#C9C6BC", margin: "10px 0" }} />
              <SummaryRow
                label="SALDO"
                value={saldoTotal}
                bold
                color={saldoTotal > 0 ? "#B3261E" : saldoTotal < 0 ? "#946800" : "#1F4D3D"}
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
  return <td style={{ ...tdStyle, ...style }}>{children}</td>;
}

function SummaryRow({ label, value, bold, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 700 : 500, padding: "4px 0", color: color || "#1F2421" }}>
      <span>{label}</span>
      <span>{Number.isFinite(value) ? value : 0} h</span>
    </div>
  );
}

function SaveIndicator({ state }) {
  const map = {
    idle: { icon: null, text: "" },
    saving: { icon: <Loader2 size={13} className="spin" style={{ animation: "spin 1s linear infinite" }} />, text: "Guardando..." },
    saved: { icon: <CheckCircle2 size={13} />, text: "Guardado" },
    error: { icon: <AlertCircle size={13} />, text: "Error al guardar" },
  };
  const { icon, text } = map[state] || map.idle;
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, opacity: 0.85 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {icon} {text}
    </div>
  );
}

const fieldInputStyle = {
  width: "100%",
  border: "1px solid #DEDBD2",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  background: "#FAFAF8",
  outline: "none",
  color: "#1F2421",
};

const tdStyle = {
  padding: "6px 8px",
  fontSize: 12.5,
  verticalAlign: "middle",
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
  padding: 6,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
};
