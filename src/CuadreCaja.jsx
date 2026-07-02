import React, { useState, useEffect, useCallback, useMemo } from "react";
import { LogOut, Plus, Trash2, Save, FileSpreadsheet, AlertTriangle, CheckCircle2, Printer, Paperclip, X, Camera } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "./supabaseClient";
import logoRitmo from "./logo-ritmo.png";

const SOPORTES_BUCKET = "cuadres-soportes";
// Fila interna especial donde se guarda la "Observación General" del día (sin tocar el esquema)
const GENERAL_MARKER = "__GENERAL__";

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

// Descuadre = (Efectivo + TCD + Bonos + Gastos + Picos por Consignar + Otros)
//             − Ventas Odoo − Picos Consignados
// Picos Consignados se RESTA: son depósitos de ventas de días anteriores, no de hoy.
function calcDescuadre(row) {
  const justificado =
    n(row.efectivo_boveda) +
    n(row.ventas_tcd) +
    n(row.bonos_adess) +
    n(row.gastos) +
    n(row.picos_por_consignar) +
    n(row.otros);
  return justificado - n(row.picos_consignados) - n(row.ventas_odoo);
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
    observaciones: "",
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
  const [dirty, setDirty] = useState(false); // hay cambios sin guardar
  const [observacionGeneral, setObservacionGeneral] = useState(""); // nota general del día
  const [soportes, setSoportes] = useState([]); // [{path, url}] fotos de soporte de gastos
  const [showSoportes, setShowSoportes] = useState(false);
  const [subiendoSoporte, setSubiendoSoporte] = useState(false);

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
      const genRow = (data || []).find((r) => r.cedula === GENERAL_MARKER);
      setObservacionGeneral(genRow ? (genRow.observaciones ?? "") : "");
      const cajeros = (data || []).filter((r) => r.cedula !== GENERAL_MARKER);
      if (cajeros.length > 0) {
        setFilas(
          cajeros.map((r) => ({
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
            observaciones: r.observaciones ?? "",
          }))
        );
      } else {
        setFilas([nuevaFila()]);
      }
    } catch (e) {
      setFilas([nuevaFila()]);
      setObservacionGeneral("");
    } finally {
      setCargando(false);
      setDirty(false);
    }
  }, [codigoTienda, fecha]);

  useEffect(() => { cargarCuadre(); }, [cargarCuadre]);

  // ---- Soportes de gastos (fotos en Supabase Storage, por tienda + fecha) ----
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("cuadres_soportes")
          .select("archivos")
          .eq("tienda_codigo", codigoTienda)
          .eq("fecha", fecha)
          .maybeSingle();
        if (!activo) return;
        const paths = data && Array.isArray(data.archivos) ? data.archivos : [];
        setSoportes(paths.map((p) => ({ path: p, url: supabase.storage.from(SOPORTES_BUCKET).getPublicUrl(p).data.publicUrl })));
      } catch (e) {
        if (activo) setSoportes([]);
      }
    })();
    return () => { activo = false; };
  }, [codigoTienda, fecha]);

  const guardarSoportesDB = async (paths) => {
    await supabase.from("cuadres_soportes").upsert(
      { tienda_codigo: codigoTienda, fecha, archivos: paths, updated_at: new Date().toISOString() },
      { onConflict: "tienda_codigo,fecha" }
    );
  };

  const agregarSoportes = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setSubiendoSoporte(true);
    try {
      const nuevos = [];
      for (const file of files) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${codigoTienda}/${fecha}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
        const { error } = await supabase.storage.from(SOPORTES_BUCKET).upload(path, file, { upsert: false });
        if (error) throw error;
        nuevos.push(path);
      }
      const lista = [...soportes.map((s) => s.path), ...nuevos];
      await guardarSoportesDB(lista);
      setSoportes(lista.map((p) => ({ path: p, url: supabase.storage.from(SOPORTES_BUCKET).getPublicUrl(p).data.publicUrl })));
    } catch (e) {
      alert("No se pudo subir la foto.\n\nRevisa que en Supabase ya exista el bucket 'cuadres-soportes' y la tabla 'cuadres_soportes' (te pasé el SQL para crearlos).");
    } finally {
      setSubiendoSoporte(false);
    }
  };

  const quitarSoporte = async (path) => {
    if (!window.confirm("¿Quitar este soporte de gasto?")) return;
    try {
      await supabase.storage.from(SOPORTES_BUCKET).remove([path]);
      const lista = soportes.map((s) => s.path).filter((p) => p !== path);
      await guardarSoportesDB(lista);
      setSoportes(lista.map((p) => ({ path: p, url: supabase.storage.from(SOPORTES_BUCKET).getPublicUrl(p).data.publicUrl })));
    } catch (e) {
      alert("No se pudo quitar el soporte.");
    }
  };

  const setCelda = (uid, key, value) => {
    setEstado("");
    setDirty(true);
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

  const agregarFila = () => { setDirty(true); setFilas((p) => [...p, nuevaFila()]); };
  const eliminarFila = (uid) => {
    setDirty(true);
    setFilas((p) => (p.length === 1 ? [nuevaFila()] : p.filter((f) => f.uid !== uid)));
  };

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
          observaciones: (f.observaciones || "").trim() || null,
          orden: i,
        }));

      // Observación general del día: se guarda en una fila interna especial.
      if (observacionGeneral.trim() !== "") {
        registros.push({
          tienda_codigo: codigoTienda,
          fecha,
          cedula: GENERAL_MARKER,
          nombre: "Observación general",
          pos: null,
          ventas_odoo: 0, efectivo_boveda: 0, ventas_tcd: 0, bonos_adess: 0,
          gastos: 0, picos_consignados: 0, picos_por_consignar: 0, otros: 0,
          observaciones: observacionGeneral.trim(),
          orden: 9998,
        });
      }

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
      setDirty(false);
      return true;
    } catch (e) {
      setEstado("error");
      return false;
    } finally {
      setGuardando(false);
    }
  };

  // Cambiar de fecha sin perder lo no guardado: guarda la fecha actual primero
  const cambiarFecha = async (nuevaFecha) => {
    if (!nuevaFecha || nuevaFecha === fecha) return;
    if (dirty) {
      const ok = await guardar();
      if (!ok) return; // si el guardado falla, no cambiamos (no se pierde nada)
    }
    setFecha(nuevaFecha);
  };

  // Salir al menú guardando antes si hay cambios pendientes
  const salirSeguro = async () => {
    if (dirty) {
      const ok = await guardar();
      if (!ok) return;
    }
    onSalir();
  };

  const exportarExcel = () => {
    exportarCuadreExcel({ codigoTienda, nombreTienda, fecha, filas, totales });
  };

  const imprimir = () => window.print();

  // Hoja de autorización de descuento por nómina (para operarios con faltante)
  const imprimirAutorizacion = (f) => {
    const d = Math.round(calcDescuadre(f) * 100) / 100;
    const monto = Math.abs(d).toLocaleString("es-DO", { maximumFractionDigits: 2 });
    const logoUrl = new URL(logoRitmo, window.location.href).href;
    const tienda = `${codigoTienda}${nombreTienda ? " — " + nombreTienda : ""}`;
    const nombre = f.nombre ? f.nombre.trim() : "________________________";
    const cedula = f.cedula ? f.cedula.trim() : "________________";
    const w = window.open("", "_blank", "width=820,height=1040");
    if (!w) {
      alert("Permite las ventanas emergentes para poder imprimir la autorización.");
      return;
    }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Autorización de descuento - ${nombre}</title>
      <style>
        *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{font-family:Arial,Helvetica,sans-serif;color:#241C14;margin:0;padding:55px 70px;font-size:14px;line-height:1.8;}
        .head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #2E9CA1;padding-bottom:14px;margin-bottom:34px;}
        .logobox{background:#E85D1F;padding:8px 14px;border-radius:7px;display:inline-flex;}
        .head img{height:44px;}
        .head .meta{text-align:right;font-size:12px;line-height:1.5;}
        h1{font-size:19px;text-align:center;margin:0 0 34px;letter-spacing:.5px;}
        .cuerpo{text-align:justify;margin-bottom:30px;}
        .monto{font-weight:bold;}
        .firma{margin-top:90px;}
        .linea{border-top:1px solid #241C14;width:320px;padding-top:6px;font-size:13px;}
        .datos{margin-top:12px;font-size:13px;line-height:1.9;}
        @page{size:letter portrait;margin:0.6in;}
      </style></head><body>
      <div class="head">
        <span class="logobox"><img src="${logoUrl}" alt="RITMO"></span>
        <div class="meta"><div><strong>${tienda}</strong></div><div>Fecha: ${fechaLarga}</div></div>
      </div>
      <h1>AUTORIZACIÓN DE DESCUENTO POR NÓMINA</h1>
      <div class="cuerpo">
        Yo, <strong>${nombre}</strong>, portador(a) de la cédula de identidad No.
        <strong>${cedula}</strong>, quien labora como cajero(a) en la tienda
        <strong>${tienda}</strong>, autorizo de manera libre y voluntaria a Tiendas RITMO
        a descontar de mi nómina el monto de <span class="monto">RD$ ${monto}</span>,
        correspondiente al descuadre (faltante) de caja registrado el día
        <strong>${fechaLarga}</strong>.
        <br><br>
        Declaro que estoy de acuerdo con este descuento y firmo en señal de conformidad.
      </div>
      <div class="firma">
        <div class="linea">Firma del operario</div>
        <div class="datos">
          Nombre: ${nombre}<br>
          Cédula: ${cedula}<br>
          Fecha: ________________________
        </div>
      </div>
      <scr${""}ipt>window.onload=function(){window.focus();window.print();};<\/scr${""}ipt>
      </body></html>`);
    w.document.close();
  };

  const filasConFaltante = filas.filter((f) => f.nombre.trim() !== "" && calcDescuadre(f) < 0);

  const fechaLarga = new Date(fecha + "T00:00:00").toLocaleDateString("es-DO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F6", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", color: "#241C14" }}>
      <style>{`
        .print-only { display: none; }
        @media print {
          @page { size: letter landscape; margin: 0.4in; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .cuadre-wrap { padding: 0 !important; max-width: none !important; }
          .cuadre-tabla-wrap { overflow: visible !important; border: none !important; box-shadow: none !important; border-radius: 0 !important; }
          .cuadre-tabla { min-width: 0 !important; width: 100% !important; font-size: 8.5px !important; table-layout: fixed; }
          .cuadre-tabla th, .cuadre-tabla td { padding: 3px 4px !important; }
          .cuadre-tabla input { font-size: 8.5px !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      {/* Barra superior */}
      <div className="no-print" style={{ background: "#3FBFC4", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={logoRitmo} alt="RITMO" style={{ height: 30, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "white", lineHeight: 1.1 }}>Cuadre Diario de Caja</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)" }}>{codigoTienda} — {nombreTienda}</div>
          </div>
        </div>
        <button onClick={salirSeguro} style={btnGhost}>
          <LogOut size={15} /> Menú
        </button>
      </div>

      <div className="cuadre-wrap" style={{ padding: 20, maxWidth: 1300, margin: "0 auto" }}>
        {/* Encabezado solo para impresión */}
        <div className="print-only" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #2E9CA1", paddingBottom: 6, marginBottom: 6 }}>
            <span style={{ background: "#E85D1F", padding: "6px 12px", borderRadius: 6, display: "inline-flex" }}>
              <img src={logoRitmo} alt="RITMO" style={{ height: 30, objectFit: "contain" }} />
            </span>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#241C14" }}>CUADRE DIARIO DE CAJA</div>
            <div style={{ textAlign: "right", fontSize: 11, color: "#241C14" }}>
              <div style={{ fontWeight: 700 }}>{codigoTienda} — {nombreTienda}</div>
              <div style={{ textTransform: "capitalize" }}>{fechaLarga}</div>
            </div>
          </div>
        </div>

        {/* Controles */}
        <div className="no-print" style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Fecha del cuadre</label>
            <input type="date" value={fecha} onChange={(e) => cambiarFecha(e.target.value)} style={{ ...inputStyle, width: 180 }} />
          </div>
          <div style={{ fontSize: 13, color: "#5C5F5A", paddingBottom: 9, textTransform: "capitalize" }}>{fechaLarga}</div>

          <div style={{ flex: 1 }} />

          <button onClick={() => setShowSoportes(true)} style={{ ...btnSecondary, ...(soportes.length > 0 ? { borderColor: "#2E9CA1", color: "#2E9CA1", background: "#EAF6F6" } : {}) }}>
            <Paperclip size={15} /> Soportes de gastos{soportes.length > 0 ? ` (${soportes.length})` : ""}
          </button>
          <button onClick={imprimir} style={btnSecondary}>
            <Printer size={15} /> Imprimir
          </button>
          <button onClick={guardar} disabled={guardando} style={{ ...btnPrimary, opacity: guardando ? 0.7 : 1 }}>
            <Save size={15} /> {guardando ? "Guardando..." : dirty ? "Guardar cambios" : "Guardado"}
          </button>
        </div>

        {estado === "guardado" && (
          <div className="no-print" style={{ ...avisoBase, background: "#E6F6EC", color: "#1B5E33" }}>
            <CheckCircle2 size={15} /> Cuadre guardado correctamente.
          </div>
        )}
        {estado === "error" && (
          <div className="no-print" style={{ ...avisoBase, background: "#FCEBEB", color: "#791F1F" }}>
            <AlertTriangle size={15} /> No se pudo guardar. ¿Existe la tabla <code>cuadres_caja</code> en Supabase?
          </div>
        )}

        {/* Tabla */}
        <div className="cuadre-tabla-wrap" style={{ overflowX: "auto", background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #E4E7E7" }}>
          <table className="cuadre-tabla" style={{ borderCollapse: "collapse", width: "100%", minWidth: 1300, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Cédula</th>
                <th style={{ ...thStyle, minWidth: 160, textAlign: "left" }}>Nombre</th>
                <th style={{ ...thStyle, width: 50 }}>POS</th>
                {MONEY_COLS.map((c) => (
                  <th key={c.key} style={{ ...thStyle, minWidth: 96 }}>{c.label}</th>
                ))}
                <th style={{ ...thStyle, minWidth: 96, background: "#E85D1F" }}>Descuadre</th>
                <th style={{ ...thStyle, minWidth: 150, textAlign: "left" }}>Observaciones</th>
                <th style={{ ...thStyle, minWidth: 150 }}>Firma</th>
                <th className="no-print" style={{ ...thStyle, width: 40, background: "#3FBFC4" }}></th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={MONEY_COLS.length + 7} style={{ padding: 24, textAlign: "center", color: "#5C5F5A" }}>Cargando…</td></tr>
              ) : (
                filas.map((f) => {
                  const d = calcDescuadre(f);
                  const desc = Math.round(d * 100) / 100;
                  // No se pueden escribir montos hasta que la fila tenga nombre y cédula.
                  const habilitado = f.nombre.trim() !== "" && f.cedula.trim() !== "";
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
                        <input value={f.pos} disabled={!habilitado} onChange={(e) => setCelda(f.uid, "pos", e.target.value)} style={{ ...cellInput, width: 40, textAlign: "center", ...(habilitado ? {} : celdaBloqueada) }} inputMode="numeric" />
                      </td>
                      {MONEY_COLS.map((c) => (
                        <td key={c.key} style={{ ...tdStyle, background: habilitado ? undefined : "#F7F5F0" }}>
                          <input
                            value={f[c.key]}
                            disabled={!habilitado}
                            onChange={(e) => setCelda(f.uid, c.key, e.target.value)}
                            title={habilitado ? "" : "Primero ingresa el nombre y la cédula del cajero"}
                            style={{ ...cellInput, textAlign: "right", ...(habilitado ? {} : celdaBloqueada) }}
                            inputMode="decimal"
                          />
                        </td>
                      ))}
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: desc === 0 ? "#1B5E33" : "#B42318", background: desc === 0 ? "#F3FBF5" : "#FEF3F2" }}>
                        {desc === 0 ? "$0" : `$${fmt(desc)}`}
                      </td>
                      <td style={tdStyle}>
                        <input value={f.observaciones} onChange={(e) => setCelda(f.uid, "observaciones", e.target.value)} placeholder="—" style={{ ...cellInput, textAlign: "left", minWidth: 140 }} />
                      </td>
                      <td style={tdStyle}></td>
                      <td className="no-print" style={{ ...tdStyle, textAlign: "center" }}>
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
                <td style={tdTotal}></td>
                <td className="no-print" style={tdTotal}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <datalist id="lista-empleados">
          {empleados.map((e) => (
            <option key={e.id} value={e.nombre} />
          ))}
        </datalist>

        <button onClick={agregarFila} className="no-print" style={{ ...btnSecondary, marginTop: 14 }}>
          <Plus size={15} /> Agregar cajero
        </button>

        {filasConFaltante.length > 0 && (
          <div className="no-print" style={{ marginTop: 20, background: "#FEF3F2", border: "1px solid #F5C4B3", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B42318", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={16} /> Autorizaciones de descuento por nómina
            </div>
            <div style={{ fontSize: 12.5, color: "#5C5F5A", marginBottom: 8 }}>
              Operarios con faltante. Imprime la autorización para que cada uno firme el descuento por nómina.
            </div>
            {filasConFaltante.map((f) => {
              const monto = Math.abs(Math.round(calcDescuadre(f) * 100) / 100);
              return (
                <div key={f.uid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid #F5D5CB", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{f.nombre}</strong>{f.cedula ? ` · Céd. ${f.cedula}` : ""} — faltante <strong style={{ color: "#B42318" }}>RD$ {monto.toLocaleString("es-DO")}</strong>
                  </div>
                  <button onClick={() => imprimirAutorizacion(f)} style={btnSecondary}>
                    <Printer size={15} /> Imprimir autorización
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Firma del supervisor + Observación general */}
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 28, alignItems: "flex-end" }}>
          <div style={{ flex: "0 0 240px" }}>
            <div style={{ borderTop: "1.5px solid #241C14", paddingTop: 6, fontSize: 13, color: "#241C14" }}>
              Firma Supervisor
            </div>
          </div>
          <div style={{ flex: "1 1 320px" }}>
            <label style={labelStyle}>Observación General</label>
            <textarea
              value={observacionGeneral}
              onChange={(e) => { setEstado(""); setDirty(true); setObservacionGeneral(e.target.value); }}
              placeholder="Nota general del día, novedades…"
              rows={3}
              style={{ ...inputStyle, width: "100%", resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
        </div>

        <div className="no-print" style={{ marginTop: 16, fontSize: 12, color: "#5C5F5A", lineHeight: 1.6 }}>
          <strong>Descuadre</strong> = (Efectivo Bóveda + Ventas TCD + Bonos ADESS + Gastos + Picos por Consignar + Otros) − Ventas Odoo − <strong>Picos Consignados</strong>.
          <br /><strong>Picos Consignados</strong> se resta: son depósitos de ventas de días anteriores, así no generan descuadre.
          <br />En verde si cuadra ($0); en rojo si hay faltante o sobrante.
        </div>
      </div>

      {showSoportes && (
        <div className="no-print" onClick={() => setShowSoportes(false)}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "white", borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid #EDEBE4" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#241C14" }}>Soportes de gastos e imprevistos</div>
                <div style={{ fontSize: 12, color: "#5C5F5A", textTransform: "capitalize" }}>{codigoTienda} — {fechaLarga}</div>
              </div>
              <button onClick={() => setShowSoportes(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#5C5F5A", padding: 4 }}><X size={20} /></button>
            </div>
            <div style={{ padding: 18 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#E85D1F", color: "white", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: subiendoSoporte ? "default" : "pointer", opacity: subiendoSoporte ? 0.7 : 1 }}>
                <Camera size={16} /> {subiendoSoporte ? "Subiendo…" : "Agregar foto / archivo"}
                <input type="file" accept="image/*" multiple disabled={subiendoSoporte} onChange={(e) => { agregarSoportes(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
              </label>
              <div style={{ fontSize: 12, color: "#5C5F5A", marginTop: 8 }}>Toma la foto del recibo con la cámara (celular) o sube el archivo (PC). Puedes agregar varias.</div>

              {soportes.length === 0 ? (
                <div style={{ marginTop: 18, padding: "24px 12px", textAlign: "center", color: "#9A958C", fontSize: 13, background: "#FAFAF8", borderRadius: 8, border: "1px dashed #DEDBD2" }}>
                  Aún no hay soportes para este cuadre.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginTop: 16 }}>
                  {soportes.map((s) => (
                    <div key={s.path} style={{ position: "relative", border: "1px solid #E4E7E7", borderRadius: 8, overflow: "hidden", background: "#FAFAF8" }}>
                      <a href={s.url} target="_blank" rel="noreferrer">
                        <img src={s.url} alt="soporte" style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                      </a>
                      <button onClick={() => quitarSoporte(s.path)} title="Quitar" style={{ position: "absolute", top: 4, right: 4, background: "rgba(180,35,24,0.92)", color: "white", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
const celdaBloqueada = { background: "#F7F5F0", color: "#B4B2A9", cursor: "not-allowed" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.2)", color: "white", border: "none", borderRadius: 7, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnPrimary = { display: "inline-flex", alignItems: "center", gap: 6, background: "#E85D1F", color: "white", border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnSecondary = { display: "inline-flex", alignItems: "center", gap: 6, background: "white", color: "#2E9CA1", border: "1px solid #BfE3E5", borderRadius: 7, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnIcon = { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", color: "#B42318", border: "none", cursor: "pointer", padding: 6 };
const avisoBase = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "9px 12px", borderRadius: 7, marginBottom: 14 };
