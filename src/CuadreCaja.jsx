import React, { useState, useEffect, useCallback, useMemo } from "react";
import { LogOut, Plus, Trash2, Save, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "./supabaseClient";
import logoRitmo from "./logo-ritmo.png";

// Columnas de dinero. La primera (Ventas Odoo) es lo que el sistema dice que se vendió.
// El resto (2..8) es lo que el cajero entregó/justificó.
const MONEY_COLS = [
  { key: "ventas_odoo", label: "1. Ventas Odoo" },
  { key: "efectivo_boveda", label: "2. Efectivo depósito Bóveda" },
  { key: "ventas_tcd", label: "3. Ventas TCD (Cierre Verifone)" },
  { key: "bonos_adess", label: "4. Ventas Bonos ADESS" },
  { key: "gastos", label: "5. Gastos e Imprevistos" },
  { key: "picos_consignados", label: "6. Picos Consignados" },
  { key: "picos_por_consignar", label: "7. Picos por Consignar" },
  { key: "otros", label: "8. Otros" },
];

// Descuadre = (todo lo justificado) - Ventas Odoo
function calcDescuadre(row) {
  const justificado =
    n(row.efectivo_boveda) +
    n(row.ventas_tcd) +
    n(row.bonos_adess) +
    n(row.gastos) +
    n(row.picos_consignados) +
    n(row.picos_por_consignar) +
    n(row.otros);
  return justificado - n(row.ventas_odoo);
}

function n(v) {
  const x = parseFloat(v);
  return isNaN(x) ? 0 : x;
}

function fmt(v) {
  return n(v).toLocaleString("es-DO", { maximumFractionDigits: 2 });
}

function nuevaFila() {
  return {
    uid: Math.random().toString(36).slice(2),
    cedula: "",
    nombre: "",
    pos: "",
    ventas_odoo: "",
    efectivo_boveda: "",
    ventas_tcd: "",
    bonos_adess: "",
    gastos: "",
    picos_consignados: "",
    picos_por_consignar: "",
    otros: "",
  };
}

function hoyISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export default function CuadreCaja({ codigoTienda, nombreTienda, onSalir }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [filas, setFilas] = useState([nuevaFila()]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState(""); // "guardado" | "error" | ""
  const [observaciones, setObservaciones] = useState("");

  // Cargar empleados de la tienda (compartido con app de horarios)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("empleados")
        .select("id, nombre, cedula")
        .eq("tienda_codigo", codigoTienda)
        .order("nombre", { ascending: true });
      if (data) setEmpleados(data);
    })();
  }, [codigoTienda]);

  // Cargar el cuadre existente al cambiar de fecha
  const cargarCuadre = useCallback(async () => {
    setCargando(true);
    setEstado("");
    try {
      const { data, error } = await supabase
        .from("cuadres_caja")
        .select("*")
        .eq("tienda_codigo", codigoTienda)
        .eq("fecha", fecha)
        .order("orden", { ascending: true });
      if (error) throw error;
      if (data && data.length > 0) {
        setObservaciones(data[0].observaciones ?? "");
        setFilas(
          data.map((r) => ({
            uid: Math.random().toString(36).slice(2),
            cedula: r.cedula ?? "",
            nombre: r.nombre ?? "",
            pos: r.pos ?? "",
            ventas_odoo: r.ventas_odoo ?? "",
            efectivo_boveda: r.efectivo_boveda ?? "",
            ventas_tcd: r.ventas_tcd ?? "",
            bonos_adess: r.bonos_adess ?? "",
            gastos: r.gastos ?? "",
            picos_consignados: r.picos_consignados ?? "",
            picos_por_consignar: r.picos_por_consignar ?? "",
            otros: r.otros ?? "",
          }))
        );
      } else {
        setFilas([nuevaFila()]);
        setObservaciones("");
      }
    } catch (e) {
      setFilas([nuevaFila()]);
      setObservaciones("");
    } finally {
      setCargando(false);
    }
  }, [codigoTienda, fecha]);

  useEffect(() => { cargarCuadre(); }, [cargarCuadre]);

  const setCelda = (uid, key, value) => {
    setEstado("");
    setFilas((prev) =>
      prev.map((f) => {
        if (f.uid !== uid) return f;
        const upd = { ...f, [key]: value };
        // Al elegir el nombre, autocompletar cédula
        if (key === "nombre") {
          const emp = empleados.find((e) => e.nombre === value);
          if (emp) upd.cedula = emp.cedula || "";
        }
        return upd;
      })
    );
  };

  const agregarFila = () => setFilas((p) => [...p, nuevaFila()]);
  const eliminarFila = (uid) =>
    setFilas((p) => (p.length === 1 ? [nuevaFila()] : p.filter((f) => f.uid !== uid)));

  const totales = useMemo(() => {
    const t = {};
    MONEY_COLS.forEach((c) => (t[c.key] = 0));
    let descuadre = 0;
    filas.forEach((f) => {
      MONEY_COLS.forEach((c) => (t[c.key] += n(f[c.key])));
      descuadre += calcDescuadre(f);
    });
    t.descuadre = descuadre;
    return t;
  }, [filas]);

  const guardar = async () => {
    setGuardando(true);
    setEstado("");
    try {
      const registros = filas
        .filter((f) => f.nombre.trim() !== "")
        .map((f, i) => ({
          tienda_codigo: codigoTienda,
          fecha,
          cedula: f.cedula || null,
          nombre: f.nombre.trim(),
          pos: f.pos === "" ? null : parseInt(f.pos, 10),
          ventas_odoo: n(f.ventas_odoo),
          efectivo_boveda: n(f.efectivo_boveda),
          ventas_tcd: n(f.ventas_tcd),
          bonos_adess: n(f.bonos_adess),
          gastos: n(f.gastos),
          picos_consignados: n(f.picos_consignados),
          picos_por_consignar: n(f.picos_por_consignar),
          otros: n(f.otros),
          observaciones: observaciones.trim() || null,
          orden: i,
        }));

      // Reemplazar el cuadre del día: borrar lo existente e insertar lo actual
      const { error: delErr } = await supabase
        .from("cuadres_caja")
        .delete()
        .eq("tienda_codigo", codigoTienda)
        .eq("fecha", fecha);
      if (delErr) throw delErr;

      if (registros.length > 0) {
        const { error: insErr } = await supabase.from("cuadres_caja").insert(registros);
        if (insErr) throw insErr;
      }
      setEstado("guardado");
    } catch (e) {
      setEstado("error");
    } finally {
      setGuardando(false);
    }
  };

  const exportarExcel = () => {
    exportarCuadreExcel({ codigoTienda, nombreTienda, fecha, filas, totales, observaciones });
  };

  const fechaLarga = new Date(fecha + "T00:00:00").toLocaleDateString("es-DO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F6", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", color: "#241C14" }}>
      {/* Barra superior */}
      <div style={{ background: "#3FBFC4", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={logoRitmo} alt="RITMO" style={{ height: 30, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "white", lineHeight: 1.1 }}>Cuadre Diario de Caja</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)" }}>{codigoTienda} — {nombreTienda}</div>
          </div>
        </div>
        <button onClick={onSalir} style={btnGhost}>
          <LogOut size={15} /> Menú
        </button>
      </div>

      <div style={{ padding: 20, maxWidth: 1300, margin: "0 auto" }}>
        {/* Controles */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Fecha del cuadre</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ ...inputStyle, width: 180 }} />
          </div>
          <div style={{ fontSize: 13, color: "#5C5F5A", paddingBottom: 9, textTransform: "capitalize" }}>{fechaLarga}</div>

          <div style={{ flex: 1 }} />

          <button onClick={exportarExcel} style={btnSecondary}>
            <FileSpreadsheet size={15} /> Exportar a Excel
          </button>
          <button onClick={guardar} disabled={guardando} style={{ ...btnPrimary, opacity: guardando ? 0.7 : 1 }}>
            <Save size={15} /> {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>

        {estado === "guardado" && (
          <div style={{ ...avisoBase, background: "#E6F6EC", color: "#1B5E33" }}>
            <CheckCircle2 size={15} /> Cuadre guardado correctamente.
          </div>
        )}
        {estado === "error" && (
          <div style={{ ...avisoBase, background: "#FCEBEB", color: "#791F1F" }}>
            <AlertTriangle size={15} /> No se pudo guardar. ¿Existe la tabla <code>cuadres_caja</code> en Supabase?
          </div>
        )}

        {/* Tabla */}
        <div style={{ overflowX: "auto", background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #E4E7E7" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1180, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Cédula</th>
                <th style={{ ...thStyle, minWidth: 160, textAlign: "left" }}>Nombre</th>
                <th style={{ ...thStyle, width: 50 }}>POS</th>
                {MONEY_COLS.map((c) => (
                  <th key={c.key} style={{ ...thStyle, minWidth: 96 }}>{c.label}</th>
                ))}
                <th style={{ ...thStyle, minWidth: 96, background: "#E85D1F" }}>Descuadre</th>
                <th style={{ ...thStyle, width: 40, background: "#3FBFC4" }}></th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={MONEY_COLS.length + 5} style={{ padding: 24, textAlign: "center", color: "#5C5F5A" }}>Cargando…</td></tr>
              ) : (
                filas.map((f) => {
                  const d = calcDescuadre(f);
                  const desc = Math.round(d * 100) / 100;
                  return (
                    <tr key={f.uid}>
                      <td style={tdStyle}>
                        <input value={f.cedula} onChange={(e) => setCelda(f.uid, "cedula", e.target.value)} style={cellInput} />
                      </td>
                      <td style={tdStyle}>
                        <input
                          list="lista-empleados"
                          value={f.nombre}
                          onChange={(e) => setCelda(f.uid, "nombre", e.target.value)}
                          placeholder="Cajero…"
                          style={{ ...cellInput, textAlign: "left", minWidth: 150 }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input value={f.pos} onChange={(e) => setCelda(f.uid, "pos", e.target.value)} style={{ ...cellInput, width: 40, textAlign: "center" }} inputMode="numeric" />
                      </td>
                      {MONEY_COLS.map((c) => (
                        <td key={c.key} style={tdStyle}>
                          <input
                            value={f[c.key]}
                            onChange={(e) => setCelda(f.uid, c.key, e.target.value)}
                            style={{ ...cellInput, textAlign: "right" }}
                            inputMode="decimal"
                          />
                        </td>
                      ))}
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: desc === 0 ? "#1B5E33" : "#B42318", background: desc === 0 ? "#F3FBF5" : "#FEF3F2" }}>
                        {desc === 0 ? "$0" : `$${fmt(desc)}`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button onClick={() => eliminarFila(f.uid)} title="Eliminar fila" style={btnIcon}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdTotal, textAlign: "left" }} colSpan={3}>TOTAL</td>
                {MONEY_COLS.map((c) => (
                  <td key={c.key} style={{ ...tdTotal, textAlign: "right" }}>${fmt(totales[c.key])}</td>
                ))}
                <td style={{ ...tdTotal, textAlign: "right", background: totales.descuadre === 0 ? "#1B5E33" : "#B42318" }}>
                  {totales.descuadre === 0 ? "$0" : `$${fmt(totales.descuadre)}`}
                </td>
                <td style={tdTotal}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <datalist id="lista-empleados">
          {empleados.map((e) => (
            <option key={e.id} value={e.nombre} />
          ))}
        </datalist>

        <button onClick={agregarFila} style={{ ...btnSecondary, marginTop: 14 }}>
          <Plus size={15} /> Agregar cajero
        </button>

        {/* Firma del supervisor + Observaciones */}
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 28, alignItems: "flex-end" }}>
          <div style={{ flex: "0 0 240px" }}>
            <div style={{ borderTop: "1.5px solid #241C14", paddingTop: 6, fontSize: 13, color: "#241C14" }}>
              Firma Supervisor
            </div>
          </div>
          <div style={{ flex: "1 1 320px" }}>
            <label style={labelStyle}>Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => { setEstado(""); setObservaciones(e.target.value); }}
              placeholder="Notas del día, descuadres a justificar, novedades…"
              rows={3}
              style={{ ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "#5C5F5A", lineHeight: 1.6 }}>
          <strong>Descuadre</strong> = (Efectivo Bóveda + Ventas TCD + Bonos ADESS + Gastos + Picos Consignados + Picos por Consignar + Otros) − Ventas Odoo.
          <br />En verde si cuadra ($0); en rojo si hay faltante o sobrante.
        </div>
      </div>
    </div>
  );
}

// ---------- Exportación a Excel (formato visual similar al actual) ----------
function exportarCuadreExcel({ codigoTienda, nombreTienda, fecha, filas, totales, observaciones }) {
  const TEAL = "3FBFC4";
  const TEAL_DARK = "2E9CA1";
  const WHITE = "FFFFFF";
  const ORANGE = "E85D1F";

  const headerCell = (v, fill = TEAL) => ({
    v,
    s: {
      font: { bold: true, color: { rgb: WHITE }, sz: 10, name: "Century Gothic" },
      fill: { fgColor: { rgb: fill } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: thinBorder(),
    },
  });
  const dataCell = (v, opts = {}) => ({
    v,
    t: typeof v === "number" ? "n" : "s",
    s: {
      font: { sz: 10, name: "Century Gothic", bold: !!opts.bold, color: { rgb: opts.color || "241C14" } },
      fill: opts.fill ? { fgColor: { rgb: opts.fill } } : undefined,
      alignment: { horizontal: opts.align || "left", vertical: "center" },
      numFmt: typeof v === "number" ? "$#,##0" : undefined,
      border: thinBorder(),
    },
  });

  const cols = ["Cédula", "Nombre", "POS", ...MONEY_COLS.map((c) => c.label), "Descuadre", "Firma"];

  const aoa = [];
  // Título
  aoa.push([{ v: "CUADRE DIARIO DE CAJA", s: { font: { bold: true, sz: 16, name: "Century Gothic" } } }]);
  aoa.push([]);
  // Bloque de info
  aoa.push([dataCell("Código", { bold: true, fill: "E8F6F7" }), dataCell(codigoTienda)]);
  aoa.push([dataCell("Tienda", { bold: true, fill: "E8F6F7" }), dataCell(`${codigoTienda}-${nombreTienda}`)]);
  aoa.push([dataCell("Fecha", { bold: true, fill: "E8F6F7" }), dataCell(fecha)]);
  aoa.push([]);
  // Encabezados de columnas
  aoa.push(cols.map((c, i) => headerCell(c, i === cols.length - 2 ? ORANGE : TEAL)));

  // Filas de datos
  filas
    .filter((f) => f.nombre.trim() !== "")
    .forEach((f) => {
      const d = Math.round(calcDescuadre(f) * 100) / 100;
      aoa.push([
        dataCell(f.cedula || "", { align: "left" }),
        dataCell(f.nombre, { align: "left" }),
        dataCell(f.pos === "" ? "" : Number(f.pos), { align: "center" }),
        ...MONEY_COLS.map((c) => dataCell(n(f[c.key]), { align: "right" })),
        dataCell(d, { align: "right", bold: true, color: d === 0 ? "1B5E33" : "B42318", fill: d === 0 ? "F3FBF5" : "FEF3F2" }),
        dataCell("", {}),
      ]);
    });

  // Total
  aoa.push([
    headerCell("Total", TEAL_DARK),
    headerCell("", TEAL_DARK),
    headerCell("", TEAL_DARK),
    ...MONEY_COLS.map((c) => ({ v: totales[c.key], t: "n", s: { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: { fgColor: { rgb: TEAL_DARK } }, alignment: { horizontal: "right" }, numFmt: "$#,##0", border: thinBorder() } })),
    { v: totales.descuadre, t: "n", s: { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: { fgColor: { rgb: ORANGE } }, alignment: { horizontal: "right" }, numFmt: "$#,##0", border: thinBorder() } },
    headerCell("", TEAL_DARK),
  ]);

  // ----- Pie: Firma del supervisor + Observaciones -----
  aoa.push([]);
  aoa.push([]);
  // Fila con la línea de firma (a la izquierda) y la etiqueta "Observaciones:" (a la derecha)
  const rLinea = aoa.length;
  const filaLinea = [];
  filaLinea[0] = { v: "", s: { border: { bottom: { style: "medium", color: { rgb: "241C14" } } } } };
  filaLinea[5] = { v: "Observaciones:", s: { font: { bold: true, sz: 10, name: "Century Gothic" } } };
  aoa.push(filaLinea);
  // Fila con "Firma Supervisor" y el cuadro de observaciones
  const rObs = aoa.length;
  const filaObs = [];
  filaObs[0] = { v: "Firma Supervisor", s: { font: { sz: 10, name: "Century Gothic" } } };
  filaObs[5] = { v: observaciones || "", s: { font: { sz: 10, name: "Century Gothic" }, alignment: { horizontal: "left", vertical: "top", wrapText: true }, border: thinBorder() } };
  aoa.push(filaObs);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 14 }, { wch: 20 }, { wch: 6 },
    ...MONEY_COLS.map(() => ({ wch: 13 })),
    { wch: 12 }, { wch: 14 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: rLinea, c: 0 }, e: { r: rLinea, c: 2 } },   // línea de firma
    { s: { r: rLinea, c: 5 }, e: { r: rLinea, c: 12 } },  // etiqueta Observaciones
    { s: { r: rObs, c: 5 }, e: { r: rObs, c: 12 } },      // cuadro de observaciones
  ];
  ws["!rows"] = [];
  ws["!rows"][rObs] = { hpt: 55 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cuadre");
  XLSX.writeFile(wb, `Cuadre_${codigoTienda}_${fecha}.xlsx`);
}

function thinBorder() {
  const s = { style: "thin", color: { rgb: "C9D4D4" } };
  return { top: s, bottom: s, left: s, right: s };
}

// ---------- estilos ----------
const labelStyle = { fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 };
const inputStyle = { border: "1px solid #DEDBD2", borderRadius: 6, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", background: "white", outline: "none", color: "#241C14", boxSizing: "border-box" };
const thStyle = { background: "#3FBFC4", color: "white", fontWeight: 700, padding: "8px 6px", fontSize: 11, textAlign: "center", border: "1px solid #36AAAF", verticalAlign: "middle" };
const tdStyle = { border: "1px solid #E4E7E7", padding: 0 };
const tdTotal = { background: "#2E9CA1", color: "white", fontWeight: 700, padding: "8px 6px", border: "1px solid #36AAAF", fontSize: 12 };
const cellInput = { width: "100%", border: "none", padding: "8px 6px", fontSize: 12.5, fontFamily: "inherit", outline: "none", background: "transparent", color: "#241C14", boxSizing: "border-box" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.2)", color: "white", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnPrimary = { display: "inline-flex", alignItems: "center", gap: 6, background: "#E85D1F", color: "white", border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnSecondary = { display: "inline-flex", alignItems: "center", gap: 6, background: "white", color: "#2E9CA1", border: "1px solid #BfE3E5", borderRadius: 7, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnIcon = { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", color: "#B42318", border: "none", cursor: "pointer", padding: 6 };
const avisoBase = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "9px 12px", borderRadius: 7, marginBottom: 14 };
