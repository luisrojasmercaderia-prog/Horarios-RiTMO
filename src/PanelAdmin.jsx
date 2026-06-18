import React, { useState, useEffect } from "react";
import { ShieldCheck, RefreshCw, FileSpreadsheet, Loader2, Store, BarChart3, CheckCircle, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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
      if (!nombre || !cedula) return;
      const clave = cedula;
      if (!mapa[clave]) {
        mapa[clave] = { nombre, cedula, festivas: 0, nocturnas: 0, extrasFestivas: 0, extrasNormales: 0 };
      }
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

function extraerFilasConExtras(datos, tiendaCodigo, semanaFecha) {
  const resultado = [];
  const days = (datos && datos.days) || [];
  days.forEach((d) => {
    (d.entries || []).forEach((e) => {
      const nombre = (e.nombre || "").trim();
      const cedula = (e.cedula || "").trim();
      if (!nombre || !cedula) return;
      const saldo = parseFloat(e.saldo) || 0;
      if (saldo <= 0) return;
      resultado.push({
        entryId: e.id,
        tiendaCodigo,
        semanaFecha,
        dia: d.dia,
        nombre,
        cedula,
        llegada: e.llegada || "",
        salida: e.salida || "",
        horasProgramadas: e.horasProgramadas || "",
        horasReales: e.horasReales || "",
        saldo: e.saldo || "",
        esFestivo: d.dia === "Domingo" || e.esFestivo,
        aprobacionEstado: null,
      });
    });
  });
  return resultado;
}

export default function PanelAdmin() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filas, setFilas] = useState([]);
  const [listaTiendas, setListaTiendas] = useState([]);
  const [tiendaSeleccionada, setTiendaSeleccionada] = useState("");
  const [filasExtras, setFilasExtras] = useState([]);
  const [aprobaciones, setAprobaciones] = useState({});

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

      const todasFilasExtras = [];
      (horarios || []).forEach((h) => {
        const filas = extraerFilasConExtras(h.datos, h.tienda_codigo, h.semana_fecha);
        todasFilasExtras.push(...filas);
      });

      const { data: aprobacionesData } = await supabase
        .from("aprobaciones")
        .select("tienda_codigo, semana_fecha, entry_id, estado");

      const mapaAprobaciones = {};
      (aprobacionesData || []).forEach((a) => {
        const key = `${a.tienda_codigo}__${a.semana_fecha}__${a.entry_id}`;
        mapaAprobaciones[key] = a.estado;
      });

      todasFilasExtras.forEach((f) => {
        const key = `${f.tiendaCodigo}__${f.semanaFecha}__${f.entryId}`;
        f.aprobacionEstado = mapaAprobaciones[key] || null;
      });

      setFilasExtras(todasFilasExtras);
      setAprobaciones(mapaAprobaciones);
    } catch (e) {
      setError("No se pudieron cargar los datos. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const handleAprobacion = async (fila, nuevoEstado) => {
    const key = `${fila.tiendaCodigo}__${fila.semanaFecha}__${fila.entryId}`;
    try {
      const { error } = await supabase
        .from("aprobaciones")
        .upsert(
          {
            tienda_codigo: fila.tiendaCodigo,
            semana_fecha: fila.semanaFecha,
            entry_id: fila.entryId,
            estado: nuevoEstado,
          },
          { onConflict: "tienda_codigo,semana_fecha,entry_id" }
        );
      if (error) throw error;

      setAprobaciones((prev) => ({ ...prev, [key]: nuevoEstado }));
      setFilasExtras((prev) =>
        prev.map((f) =>
          f.tiendaCodigo === fila.tiendaCodigo &&
          f.semanaFecha === fila.semanaFecha &&
          f.entryId === fila.entryId
            ? { ...f, aprobacionEstado: nuevoEstado }
            : f
        )
      );
    } catch (e) {
      alert("Error al guardar la aprobación. Intenta de nuevo.");
    }
  };

  const totalesPorTienda = (() => {
    const mapa = {};
    filas.forEach((f) => {
      if (!mapa[f.tiendaCodigo]) {
        mapa[f.tiendaCodigo] = { tienda: f.tiendaNombre, extrasNormales: 0, extrasFestivas: 0, nocturnas: 0 };
      }
      mapa[f.tiendaCodigo].extrasNormales += f.extrasNormales;
      mapa[f.tiendaCodigo].extrasFestivas += f.extrasFestivas;
      mapa[f.tiendaCodigo].nocturnas += f.nocturnas;
    });
    return Object.values(mapa);
  })();

  const totalTiendaSeleccionada = (() => {
    if (!tiendaSeleccionada) return [];
    const nombreTienda = listaTiendas.find((t) => t.codigo === tiendaSeleccionada)?.nombre || tiendaSeleccionada;
    const total = { tienda: nombreTienda, extrasNormales: 0, extrasFestivas: 0, nocturnas: 0 };
    filas
      .filter((f) => f.tiendaCodigo === tiendaSeleccionada)
      .forEach((f) => {
        total.extrasNormales += f.extrasNormales;
        total.extrasFestivas += f.extrasFestivas;
        total.nocturnas += f.nocturnas;
      });
    return [total];
  })();

  const totalesParaGraficas = tiendaSeleccionada ? totalTiendaSeleccionada : totalesPorTienda;

  const datosExtrasNormales = [...totalesParaGraficas]
    .sort((a, b) => b.extrasNormales - a.extrasNormales)
    .map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.extrasNormales)) }));

  const datosExtrasFestivas = [...totalesParaGraficas]
    .sort((a, b) => b.extrasFestivas - a.extrasFestivas)
    .map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.extrasFestivas)) }));

  const datosNocturnas = [...totalesParaGraficas]
    .sort((a, b) => b.nocturnas - a.nocturnas)
    .map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.nocturnas)) }));

  const exportarExcel = () => {
    if (tiendaSeleccionada) {
      const nombreTienda = listaTiendas.find((t) => t.codigo === tiendaSeleccionada)?.nombre || tiendaSeleccionada;
      const filasTienda = filas.filter((f) => f.tiendaCodigo === tiendaSeleccionada);
      const data = filasTienda.map((f) => ({
        Semana: f.semana,
        Operario: f.operario,
        Cédula: f.cedula,
        "Hrs Festivas": Number(fmt(f.festivas)),
        "Hrs Nocturnas": Number(fmt(f.nocturnas)),
        "Hrs Extras Festivas": Number(fmt(f.extrasFestivas)),
        "Hrs Extras Normales": Number(fmt(f.extrasNormales)),
      }));
      const hoja = XLSX.utils.json_to_sheet(data);
      hoja["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Consolidado");
      const nombreArchivo = `Consolidado_${nombreTienda}.xlsx`.replace(/\s+/g, "_");
      XLSX.writeFile(libro, nombreArchivo);
      return;
    }

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
              <FileSpreadsheet size={14} /> {tiendaSeleccionada ? "Exportar tienda" : "Exportar a Excel"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#E85D1F", marginBottom: 16 }}>Consolidado por tienda</div>

          {cargando && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5C5F5A", fontSize: 13 }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Cargando datos...
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!cargando && error && (
            <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 13, padding: "10px 12px", borderRadius: 6 }}>{error}</div>
          )}

          {!cargando && !error && listaTiendas.length === 0 && (
            <div style={{ fontSize: 13, color: "#5C5F5A" }}>Todavía no hay tiendas registradas.</div>
          )}

          {!cargando && !error && listaTiendas.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {listaTiendas.map((t) => {
                const activo = tiendaSeleccionada === t.codigo;
                return (
                  <button
                    key={t.codigo}
                    onClick={() => setTiendaSeleccionada(activo ? "" : t.codigo)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: activo ? "#E85D1F" : "#FFF6EE",
                      color: activo ? "#FFFFFF" : "#E85D1F",
                      border: "1px solid #E85D1F",
                      borderRadius: 7,
                      padding: "9px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <Store size={14} /> {t.nombre} ({t.codigo})
                  </button>
                );
              })}
            </div>
          )}

          {tiendaSeleccionada && (() => {
            const filasTienda = filas.filter((f) => f.tiendaCodigo === tiendaSeleccionada);
            const nombreTienda = listaTiendas.find((t) => t.codigo === tiendaSeleccionada)?.nombre || tiendaSeleccionada;
            const filasExtrasTienda = filasExtras.filter((f) => f.tiendaCodigo === tiendaSeleccionada);
            return (
              <div style={{ marginTop: 18, borderTop: "1px solid #EDEBE4", paddingTop: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>{nombreTienda}</div>
                {filasTienda.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#5C5F5A" }}>Sin datos registrados todavía.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
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
                      {filasTienda.map((f, i) => (
                        <tr key={`${f.semana}-${f.cedula || f.operario}-${i}`} style={{ borderTop: "1px solid #EDEBE4" }}>
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

                {filasExtrasTienda.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E85D1F", marginBottom: 10 }}>
                      Aprobación de horas extras
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                          <th style={thStyle}>Semana</th>
                          <th style={thStyle}>Día</th>
                          <th style={thStyle}>Operario</th>
                          <th style={thStyle}>Cédula</th>
                          <th style={thStyle}>Entrada</th>
                          <th style={thStyle}>Salida</th>
                          <th style={thStyle}>Saldo</th>
                          <th style={thStyle}>Tipo</th>
                          <th style={thStyle}>Estado</th>
                          <th style={thStyle}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasExtrasTienda.map((f, i) => {
                          const SEMANA_LABEL = { semana_1: "Semana 1", semana_2: "Semana 2", semana_3: "Semana 3", semana_4: "Semana 4" };
                          const aprobado = f.aprobacionEstado === "aprobado";
                          const rechazado = f.aprobacionEstado === "rechazado";
                          return (
                            <tr
                              key={`${f.tiendaCodigo}-${f.semanaFecha}-${f.entryId}-${i}`}
                              style={{
                                borderTop: "1px solid #EDEBE4",
                                background: aprobado ? "#E8F5E9" : rechazado ? "#FDECEA" : "white",
                              }}
                            >
                              <td style={tdStyle}>{SEMANA_LABEL[f.semanaFecha] || f.semanaFecha}</td>
                              <td style={tdStyle}>{f.dia}</td>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{f.nombre}</td>
                              <td style={tdStyle}>{f.cedula}</td>
                              <td style={tdStyle}>{f.llegada}</td>
                              <td style={tdStyle}>{f.salida}</td>
                              <td style={{ ...tdStyle, color: "#E85D1F", fontWeight: 700 }}>{f.saldo}</td>
                              <td style={tdStyle}>{f.esFestivo ? "Festivo" : "Normal"}</td>
                              <td style={tdStyle}>
                                {aprobado && <span style={{ color: "#2E7D32", fontWeight: 600 }}>✓ Aprobado</span>}
                                {rechazado && <span style={{ color: "#C62828", fontWeight: 600 }}>✗ Rechazado</span>}
                                {!f.aprobacionEstado && <span style={{ color: "#5C5F5A" }}>Pendiente</span>}
                              </td>
                              <td style={tdStyle}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    onClick={() => handleAprobacion(f, "aprobado")}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 4,
                                      background: aprobado ? "#2E7D32" : "#E8F5E9",
                                      color: aprobado ? "white" : "#2E7D32",
                                      border: "1px solid #2E7D32", borderRadius: 5,
                                      padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                    }}
                                  >
                                    <CheckCircle size={12} /> Aprobar
                                  </button>
                                  <button
                                    onClick={() => handleAprobacion(f, "rechazado")}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 4,
                                      background: rechazado ? "#C62828" : "#FDECEA",
                                      color: rechazado ? "white" : "#C62828",
                                      border: "1px solid #C62828", borderRadius: 5,
                                      padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                    }}
                                  >
                                    <XCircle size={12} /> Rechazar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {!cargando && !error && totalesParaGraficas.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 24 }}>
            <GraficaBarras
              titulo={tiendaSeleccionada ? "Horas extras normales (total de la tienda)" : "Mayor horas extras normales"}
              datos={datosExtrasNormales}
              color="#3FBFC4"
            />
            <GraficaBarras
              titulo={tiendaSeleccionada ? "Horas festivas / dominicales (total de la tienda)" : "Mayor horas festivas / dominicales"}
              datos={datosExtrasFestivas}
              color="#E85D1F"
            />
            <GraficaBarras
              titulo={tiendaSeleccionada ? "Horas nocturnas (total de la tienda)" : "Mayor horas nocturnas"}
              datos={datosNocturnas}
              color="#7C5CFF"
            />
          </div>
        )}
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

function GraficaBarras({ titulo, datos, color }) {
  return (
    <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: "#241C14", fontWeight: 700, fontSize: 13 }}>
        <BarChart3 size={15} color={color} /> {titulo}
      </div>
      {datos.every((d) => d.valor === 0) ? (
        <div style={{ fontSize: 12.5, color: "#5C5F5A" }}>Todavía no hay horas registradas para graficar.</div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 34)}>
          <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EDEBE4" />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#5C5F5A" }} />
            <YAxis type="category" dataKey="tienda" width={110} tick={{ fontSize: 11, fill: "#241C14" }} />
            <Tooltip formatter={(value) => [`${value} h`, "Horas"]} />
            <Bar dataKey="valor" fill={color} radius={[0, 4, 4, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

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
