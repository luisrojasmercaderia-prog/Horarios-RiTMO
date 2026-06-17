import React, { useState, useEffect } from "react";
import { ShieldCheck, RefreshCw, FileSpreadsheet, Loader2, Store } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import HorariosTienda from "./HorariosTienda";

function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

function calcularConsolidadoTienda(datos) {
  const mapa = {};
  const days = (datos && datos.days) || [];
  days.forEach((d) => {
    (d.entries || []).forEach((e) => {
      const nombre = (e.nombre || "").trim();
      const cedula = (e.cedula || "").trim();
      if (!nombre && !cedula) return;
      const clave = cedula || `__sin_cedula__${nombre}`;
      if (!mapa[clave]) {
        mapa[clave] = { nombre, cedula, festivas: 0, nocturnas: 0, extrasFestivas: 0, extrasNormales: 0 };
      }
      if (!mapa[clave].nombre && nombre) mapa[clave].nombre = nombre;
      const reales = parseFloat(e.horasReales) || 0;
      const nocturnas = parseFloat(e.horasNocturnas) || 0;
      const saldo = parseFloat(e.saldo) || 0;
      const esDiaFestivo = d.dia === "Domingo" || e.esFestivo;
      mapa[clave].nocturnas += nocturnas;
      if (esDiaFestivo) {
        mapa[clave].festivas += reales;
      }
      if (saldo > 0) {
        if (esDiaFestivo) {
          mapa[clave].extrasFestivas += saldo;
        } else {
          mapa[clave].extrasNormales += saldo;
        }
      }
    });
  });
  return Object.values(mapa);
}

export default function PanelAdmin() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filas, setFilas] = useState([]);
  const [listaTiendas, setListaTiendas] = useState([]);
  const [tiendaSeleccionada, setTiendaSeleccionada] = useState("");

  const cargarDatos = async () => {
    setCargando(true);
    setError("");
    try {
      const { data: tiendas, error: errTiendas } = await supabase
        .from("tiendas")
        .select("codigo, nombre")
        .order("codigo", { ascending: true });
      if (errTiendas) throw errTiendas;

      setListaTiendas(tiendas || []);

      const { data: horarios, error: errHorarios } = await supabase
        .from("horarios_semana")
        .select("tienda_codigo, semana_fecha, datos, updated_at");
      if (errHorarios) throw errHorarios;

      const horariosPorTienda = {};
      (horarios || []).forEach((h) => {
        if (!horariosPorTienda[h.tienda_codigo]) horariosPorTienda[h.tienda_codigo] = [];
        horariosPorTienda[h.tienda_codigo].push(h);
      });

      const SEMANA_LABEL = { semana_1: "Semana 1", semana_2: "Semana 2", semana_3: "Semana 3", semana_4: "Semana 4" };

      const resultado = [];
      (tiendas || []).forEach((t) => {
        const registros = horariosPorTienda[t.codigo] || [];
        let huboDatos = false;
        registros.forEach((registro) => {
          const consolidado = calcularConsolidadoTienda(registro.datos);
          consolidado.forEach((op) => {
            huboDatos = true;
            resultado.push({
              tiendaCodigo: t.codigo,
              tiendaNombre: t.nombre,
              semana: SEMANA_LABEL[registro.semana_fecha] || registro.semana_fecha,
              operario: op.nombre || "(Sin nombre)",
              cedula: op.cedula || "",
              festivas: op.festivas,
              nocturnas: op.nocturnas,
              extrasFestivas: op.extrasFestivas,
              extrasNormales: op.extrasNormales,
            });
          });
        });
        if (!huboDatos) {
          resultado.push({
            tiendaCodigo: t.codigo,
            tiendaNombre: t.nombre,
            semana: "—",
            operario: "(Sin datos registrados)",
            cedula: "",
            festivas: 0,
            nocturnas: 0,
            extrasFestivas: 0,
            extrasNormales: 0,
          });
        }
      });

      setFilas(resultado);
    } catch (e) {
      setError("No se pudieron cargar los datos. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const exportarExcel = () => {
    const data = filas.map((f) => ({
      Tienda: f.tiendaNombre,
      "Código Tienda": f.tiendaCodigo,
      Semana: f.semana,
      Operario: f.operario,
      Cédula: f.cedula,
      "Hrs Festivas": Number(fmt(f.festivas)),
      "Hrs Nocturnas": Number(fmt(f.nocturnas)),
      "Hrs Extras Festivas": Number(fmt(f.extrasFestivas)),
      "Hrs Extras Normales": Number(fmt(f.extrasNormales)),
    }));
    const hoja = XLSX.utils.json_to_sheet(data);
    hoja["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Consolidado General");
    XLSX.writeFile(libro, "Consolidado_General_RITMO.xlsx");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FFF6EE", fontFamily: "'Inter', system-ui, sans-serif", color: "#241C14" }}>
      <div style={{ background: "#E85D1F", color: "white", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={20} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>Panel administrativo · Jefe de Zona</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={cargarDatos} style={btnStyle("transparent", "#FFFFFF")}>
              <RefreshCw size={14} /> Actualizar
            </button>
            <button onClick={exportarExcel} style={btnStyle("#3FBFC4", "#FFFFFF")}>
              <FileSpreadsheet size={14} /> Exportar a Excel
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D1F", marginBottom: 16 }}>Consolidado de todas las tiendas</div>

          {cargando && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5C5F5A", fontSize: 13 }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Cargando datos...
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!cargando && error && (
            <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 13, padding: "10px 12px", borderRadius: 6 }}>{error}</div>
          )}

          {!cargando && !error && filas.length === 0 && (
            <div style={{ fontSize: 13, color: "#5C5F5A" }}>Todavía no hay tiendas registradas.</div>
          )}

          {!cargando && !error && filas.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                  <th style={thStyle}>Tienda</th>
                  <th style={thStyle}>Código</th>
                  <th style={thStyle}>Semana</th>
                  <th style={thStyle}>Operario</th>
                  <th style={thStyle}>Cédula</th>
                  <th style={thStyle}>Hrs Festivas</th>
                  <th style={thStyle}>Hrs Nocturnas</th>
                  <th style={thStyle}>Extras Festivas</th>
                  <th style={thStyle}>Extras Normales</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.tiendaCodigo}-${f.semana}-${f.cedula || f.operario}-${i}`} style={{ borderTop: "1px solid #EDEBE4" }}>
                    <td style={tdStyle}>{f.tiendaNombre}</td>
                    <td style={tdStyle}>{f.tiendaCodigo}</td>
                    <td style={tdStyle}>{f.semana}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{f.operario}</td>
                    <td style={tdStyle}>{f.cedula || "—"}</td>
                    <td style={tdStyle}>{fmt(f.festivas)}</td>
                    <td style={tdStyle}>{fmt(f.nocturnas)}</td>
                    <td style={tdStyle}>{fmt(f.extrasFestivas)}</td>
                    <td style={tdStyle}>{fmt(f.extrasNormales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24, marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Store size={16} color="#E85D1F" />
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D1F" }}>Ver planilla de una tienda</div>
          </div>

          <select
            value={tiendaSeleccionada}
            onChange={(e) => setTiendaSeleccionada(e.target.value)}
            style={{
              border: "1px solid #DEDBD2",
              borderRadius: 6,
              padding: "9px 11px",
              fontSize: 13.5,
              fontFamily: "inherit",
              background: "#FAFAF8",
              outline: "none",
              color: "#241C14",
              minWidth: 260,
              cursor: "pointer",
            }}
          >
            <option value="">Selecciona una tienda...</option>
            {listaTiendas.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.nombre} ({t.codigo})
              </option>
            ))}
          </select>
        </div>
      </div>

      {tiendaSeleccionada && (
        <div style={{ borderTop: "4px solid #E85D1F", marginTop: 8 }}>
          <HorariosTienda codigoTienda={tiendaSeleccionada} onSalir={() => setTiendaSeleccionada("")} />
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: "9px 8px", textAlign: "left", fontWeight: 600 };
const tdStyle = { padding: "8px", fontSize: 12.5, verticalAlign: "middle" };

function btnStyle(bg, color) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: bg,
    color,
    border: bg === "transparent" ? "1px solid rgba(255,255,255,0.6)" : "none",
    borderRadius: 7,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
