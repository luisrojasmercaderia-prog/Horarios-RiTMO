import React, { useState, useEffect } from "react";
import { ShieldCheck, RefreshCw, FileSpreadsheet, Loader2, Store, BarChart3, CheckCircle, XCircle, AlertTriangle, Send, Lock, X, UserCheck } from "lucide-react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "./supabaseClient";
import HorariosTienda from "./HorariosTienda";

// ─── Roles y contraseñas ───
// Cambia aquí las contraseñas de cada rol.
const ROLES = {
  jefe_zona: {
    label: "Jefe de Zona",
    password: "jdz2024",
    color: "#E85D1F",
    icon: "🏪",
  },
  recursos_humanos: {
    label: "Recursos Humanos",
    password: "rrhh2024",
    color: "#7C5CFF",
    icon: "👥",
  },
  gerente_ventas: {
    label: "Gerente de Ventas",
    password: "gv2024",
    color: "#1B8388",
    icon: "📊",
  },
};

function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

function esNovedadRRHH(estado) {
  return ["incapacitado", "licencia_maternidad", "luto"].includes(estado);
}

const DIAS_LIMITE_ENVIO_RRHH = 3;

const NOVEDAD_LABEL = {
  incapacitado: "Incapacidad",
  licencia_maternidad: "Licencia de maternidad",
  luto: "Luto",
};

function diasVencidosRRHH(entry) {
  if (!esNovedadRRHH(entry.estado) || entry.enviadoRRHH || !entry.fechaRegistroNovedad) return null;
  const fechaRegistro = new Date(entry.fechaRegistroNovedad + "T00:00:00");
  const hoy = new Date();
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diffMs = hoySinHora - fechaRegistro;
  const diffDias = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDias;
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
      if (esDiaFestivo) mapa[clave].festivas += reales;
      if (saldo > 0) {
        if (esDiaFestivo) mapa[clave].extrasFestivas += saldo;
        else mapa[clave].extrasNormales += saldo;
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
        observacion: e.observacion || "",
        aprobacionEstado: null,
      });
    });
  });
  return resultado;
}

function extraerNovedadesRRHH(datos, tiendaCodigo, tiendaNombre, semanaFecha) {
  const resultado = [];
  const days = (datos && datos.days) || [];
  days.forEach((d) => {
    (d.entries || []).forEach((e) => {
      const nombre = (e.nombre || "").trim();
      const cedula = (e.cedula || "").trim();
      if (!nombre || !esNovedadRRHH(e.estado)) return;
      resultado.push({
        entryId: e.id,
        tiendaCodigo,
        tiendaNombre,
        semanaFecha,
        dia: d.dia,
        fecha: e.fecha || "",
        nombre,
        cedula,
        estado: e.estado,
        enviadoRRHH: !!e.enviadoRRHH,
        fechaRegistroNovedad: e.fechaRegistroNovedad || "",
        diasVencidos: diasVencidosRRHH(e),
      });
    });
  });
  return resultado;
}

// ─── Pantalla de selección de rol ───
function PantallaRoles({ onRolSeleccionado }) {
  const [rolPendiente, setRolPendiente] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSeleccionarRol = (rolKey) => {
    setRolPendiente(rolKey);
    setPassword("");
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const rol = ROLES[rolPendiente];
    if (password === rol.password) {
      onRolSeleccionado(rolPendiente);
    } else {
      setError("Contraseña incorrecta. Intenta de nuevo.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#FFF6EE",
      fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#E85D1F", marginBottom: 8 }}>
          Panel Administrativo
        </div>
        <div style={{ fontSize: 14, color: "#5C5F5A" }}>
          Selecciona tu rol para ingresar
        </div>
      </div>

      {/* Botones de roles */}
      {!rolPendiente && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360 }}>
          {Object.entries(ROLES).map(([key, rol]) => (
            <button
              key={key}
              onClick={() => handleSeleccionarRol(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "white",
                border: `2px solid ${rol.color}`,
                borderRadius: 12,
                padding: "18px 24px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = rol.color; e.currentTarget.style.color = "white"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = "#241C14"; }}
            >
              <span style={{ fontSize: 28 }}>{rol.icon}</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{rol.label}</div>
              </div>
              <Lock size={16} style={{ marginLeft: "auto", opacity: 0.5 }} />
            </button>
          ))}
        </div>
      )}

      {/* Modal de contraseña */}
      {rolPendiente && (
        <div style={{
          background: "white",
          borderRadius: 12,
          padding: 28,
          maxWidth: 360,
          width: "100%",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          border: `2px solid ${ROLES[rolPendiente].color}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ROLES[rolPendiente].color, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{ROLES[rolPendiente].icon}</span> {ROLES[rolPendiente].label}
            </div>
            <button onClick={() => setRolPendiente(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#5C5F5A" }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 13, color: "#5C5F5A", marginBottom: 16 }}>
            Ingresa la contraseña para acceder como <strong>{ROLES[rolPendiente].label}</strong>.
          </div>
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Contraseña"
              style={fieldInputStyle}
            />
            {error && (
              <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, marginTop: 10 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="submit"
                style={{
                  ...btnStyle(ROLES[rolPendiente].color, "#FFFFFF"),
                  flex: 1,
                  justifyContent: "center",
                }}
              >
                <UserCheck size={15} /> Ingresar
              </button>
              <button
                type="button"
                onClick={() => setRolPendiente(null)}
                style={{ ...btnStyle("#FAFAF7", "#5C5F5A"), flex: 1, justifyContent: "center" }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ───
export default function PanelAdmin() {
  const [rolActivo, setRolActivo] = useState(null); // null = pantalla de selección

  if (!rolActivo) {
    return <PantallaRoles onRolSeleccionado={setRolActivo} />;
  }

  return (
    <PanelConRol
      rolKey={rolActivo}
      onCerrarSesion={() => setRolActivo(null)}
    />
  );
}

// ─── Panel con datos (solo se monta cuando hay rol activo) ───
function PanelConRol({ rolKey, onCerrarSesion }) {
  const rol = ROLES[rolKey];

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [filas, setFilas] = useState([]);
  const [listaTiendas, setListaTiendas] = useState([]);
  const [tiendaSeleccionada, setTiendaSeleccionada] = useState("");
  const [filasExtras, setFilasExtras] = useState([]);
  const [aprobaciones, setAprobaciones] = useState({});
  const [novedadesRRHH, setNovedadesRRHH] = useState([]);

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
      const todasNovedades = [];
      (horarios || []).forEach((h) => {
        const filasH = extraerFilasConExtras(h.datos, h.tienda_codigo, h.semana_fecha);
        todasFilasExtras.push(...filasH);

        const tiendaInfo = (tiendas || []).find((t) => t.codigo === h.tienda_codigo);
        const novedadesH = extraerNovedadesRRHH(
          h.datos,
          h.tienda_codigo,
          tiendaInfo ? tiendaInfo.nombre : h.tienda_codigo,
          h.semana_fecha
        );
        todasNovedades.push(...novedadesH);
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
      setNovedadesRRHH(todasNovedades);
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

  const novedadesVencidasGlobal = novedadesRRHH
    .filter((n) => !n.enviadoRRHH && n.diasVencidos !== null && n.diasVencidos >= DIAS_LIMITE_ENVIO_RRHH)
    .sort((a, b) => (b.diasVencidos || 0) - (a.diasVencidos || 0));

  const novedadesPendientesGlobal = novedadesRRHH
    .filter((n) => !n.enviadoRRHH && n.diasVencidos !== null && n.diasVencidos < DIAS_LIMITE_ENVIO_RRHH)
    .sort((a, b) => (b.diasVencidos || 0) - (a.diasVencidos || 0));

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
    filas.filter((f) => f.tiendaCodigo === tiendaSeleccionada).forEach((f) => {
      total.extrasNormales += f.extrasNormales;
      total.extrasFestivas += f.extrasFestivas;
      total.nocturnas += f.nocturnas;
    });
    return [total];
  })();

  const totalesParaGraficas = tiendaSeleccionada ? totalTiendaSeleccionada : totalesPorTienda;

  const datosExtrasNormales = [...totalesParaGraficas].sort((a, b) => b.extrasNormales - a.extrasNormales).map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.extrasNormales)) }));
  const datosExtrasFestivas = [...totalesParaGraficas].sort((a, b) => b.extrasFestivas - a.extrasFestivas).map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.extrasFestivas)) }));
  const datosNocturnas = [...totalesParaGraficas].sort((a, b) => b.nocturnas - a.nocturnas).map((t) => ({ tienda: t.tienda, valor: Number(fmt(t.nocturnas)) }));

  const exportarExcel = () => {
    if (tiendaSeleccionada) {
      const nombreTienda = listaTiendas.find((t) => t.codigo === tiendaSeleccionada)?.nombre || tiendaSeleccionada;
      const filasTienda = filas.filter((f) => f.tiendaCodigo === tiendaSeleccionada);
      const data = filasTienda.map((f) => ({
        Semana: f.semana, Operario: f.operario, Cédula: f.cedula,
        "Hrs Festivas": Number(fmt(f.festivas)), "Hrs Nocturnas": Number(fmt(f.nocturnas)),
        "Hrs Extras Festivas": Number(fmt(f.extrasFestivas)), "Hrs Extras Normales": Number(fmt(f.extrasNormales)),
      }));
      const hoja = XLSX.utils.json_to_sheet(data);
      hoja["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Consolidado");
      XLSX.writeFile(libro, `Consolidado_${nombreTienda}.xlsx`.replace(/\s+/g, "_"));
      return;
    }
    const data = filas.map((f) => ({
      Tienda: f.tiendaNombre, "Código Tienda": f.tiendaCodigo, Semana: f.semana,
      Operario: f.operario, Cédula: f.cedula,
      "Hrs Festivas": Number(fmt(f.festivas)), "Hrs Nocturnas": Number(fmt(f.nocturnas)),
      "Hrs Extras Festivas": Number(fmt(f.extrasFestivas)), "Hrs Extras Normales": Number(fmt(f.extrasNormales)),
    }));
    const hoja = XLSX.utils.json_to_sheet(data);
    hoja["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Consolidado General");
    XLSX.writeFile(libro, "Consolidado_General_RITMO.xlsx");
  };

  const exportarNovedadesExcel = () => {
    const data = [...novedadesVencidasGlobal, ...novedadesPendientesGlobal].map((n) => ({
      Tienda: n.tiendaNombre, "Código Tienda": n.tiendaCodigo,
      Operario: n.nombre, Cédula: n.cedula,
      Tipo: NOVEDAD_LABEL[n.estado] || n.estado,
      "Fecha registro": n.fechaRegistroNovedad,
      "Días sin enviar": n.diasVencidos,
      Estado: n.diasVencidos >= DIAS_LIMITE_ENVIO_RRHH ? "VENCIDO" : "Pendiente",
    }));
    const hoja = XLSX.utils.json_to_sheet(data);
    hoja["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Novedades RRHH");
    XLSX.writeFile(libro, "Novedades_Pendientes_RRHH.xlsx");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FFF6EE", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", color: "#241C14" }}>

      {/* Barra superior */}
      <div style={{ background: rol.color, color: "white", padding: "18px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck size={20} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Panel Administrativo · {rol.label}</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{rol.icon} Sesión activa</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={cargarDatos} style={btnStyle("transparent", "#FFFFFF", true)}>
              <RefreshCw size={14} /> Actualizar
            </button>
            <button onClick={exportarExcel} style={btnStyle("#FFFFFF", rol.color, false)}>
              <FileSpreadsheet size={14} /> {tiendaSeleccionada ? "Exportar tienda" : "Exportar a Excel"}
            </button>
            <button
              onClick={onCerrarSesion}
              style={btnStyle("rgba(255,255,255,0.15)", "#FFFFFF", true)}
              title="Cambiar de rol"
            >
              🔄 Cambiar rol
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px 60px" }}>

        {/* Alerta novedades RRHH */}
        {!cargando && !error && (novedadesVencidasGlobal.length > 0 || novedadesPendientesGlobal.length > 0) && (
          <div style={{
            background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            padding: 22, marginBottom: 22,
            border: novedadesVencidasGlobal.length > 0 ? "1.5px solid #E53935" : "1px solid #EDEBE4",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={18} color={novedadesVencidasGlobal.length > 0 ? "#E53935" : "#946800"} />
                <div style={{ fontSize: 15, fontWeight: 700, color: novedadesVencidasGlobal.length > 0 ? "#E53935" : "#241C14" }}>
                  Novedades pendientes de envío a RRHH
                </div>
                {novedadesVencidasGlobal.length > 0 && (
                  <span style={{ background: "#E53935", color: "white", borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700 }}>
                    {novedadesVencidasGlobal.length} vencida{novedadesVencidasGlobal.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <button onClick={exportarNovedadesExcel} style={btnStyle("#3FBFC4", "#FFFFFF", false)}>
                <Send size={13} /> Exportar novedades
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#5C5F5A", marginBottom: 14 }}>
              Incapacidades, licencias de maternidad y casos de luto sin marcar como enviados a Recursos Humanos. Las novedades con {DIAS_LIMITE_ENVIO_RRHH} o más días sin enviar se muestran en rojo.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#FAFAF7", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#5C5F5A" }}>
                  <th style={thStyle}>Tienda</th>
                  <th style={thStyle}>Operario</th>
                  <th style={thStyle}>Cédula</th>
                  <th style={thStyle}>Tipo</th>
                  <th style={thStyle}>Fecha registro</th>
                  <th style={thStyle}>Días sin enviar</th>
                </tr>
              </thead>
              <tbody>
                {[...novedadesVencidasGlobal, ...novedadesPendientesGlobal].map((n, i) => {
                  const vencido = n.diasVencidos >= DIAS_LIMITE_ENVIO_RRHH;
                  return (
                    <tr key={`${n.tiendaCodigo}-${n.semanaFecha}-${n.entryId}-${i}`} style={{ borderTop: "1px solid #EDEBE4", background: vencido ? "#FDECEA" : "transparent" }}>
                      <td style={tdStyle}>
                        <button onClick={() => setTiendaSeleccionada(n.tiendaCodigo)} style={{ background: "transparent", border: "none", color: rol.color, fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 12.5, textDecoration: "underline" }}>
                          {n.tiendaNombre}
                        </button>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{n.nombre}</td>
                      <td style={tdStyle}>{n.cedula || "—"}</td>
                      <td style={tdStyle}>{NOVEDAD_LABEL[n.estado] || n.estado}</td>
                      <td style={tdStyle}>{n.fechaRegistroNovedad || "—"}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, color: vencido ? "#E53935" : "#946800", background: vencido ? "#FCEBEB" : "#FFF6DC", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                          {vencido ? "⚠ " : ""}{n.diasVencidos} día{n.diasVencidos !== 1 ? "s" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Consolidado por tienda */}
        <div style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: rol.color, marginBottom: 16 }}>Consolidado por tienda</div>

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
                const vencidasTienda = novedadesVencidasGlobal.filter((n) => n.tiendaCodigo === t.codigo).length;
                return (
                  <button
                    key={t.codigo}
                    onClick={() => setTiendaSeleccionada(activo ? "" : t.codigo)}
                    style={{
                      position: "relative",
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: activo ? rol.color : "#FFF6EE",
                      color: activo ? "#FFFFFF" : rol.color,
                      border: `1px solid ${rol.color}`,
                      borderRadius: 7, padding: "9px 14px", fontSize: 13, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <Store size={14} /> {t.nombre} ({t.codigo})
                    {vencidasTienda > 0 && (
                      <span style={{ position: "absolute", top: -7, right: -7, background: "#E53935", color: "#FFFFFF", borderRadius: "50%", width: 18, height: 18, fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #FFF6EE" }}>
                        {vencidasTienda}
                      </span>
                    )}
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: rol.color, marginBottom: 10 }}>
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
                          <th style={thStyle}>Observación</th>
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
                            <tr key={`${f.tiendaCodigo}-${f.semanaFecha}-${f.entryId}-${i}`} style={{ borderTop: "1px solid #EDEBE4", background: aprobado ? "#E8F5E9" : rechazado ? "#FDECEA" : "white" }}>
                              <td style={tdStyle}>{SEMANA_LABEL[f.semanaFecha] || f.semanaFecha}</td>
                              <td style={tdStyle}>{f.dia}</td>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{f.nombre}</td>
                              <td style={tdStyle}>{f.cedula}</td>
                              <td style={tdStyle}>{f.llegada}</td>
                              <td style={tdStyle}>{f.salida}</td>
                              <td style={{ ...tdStyle, color: rol.color, fontWeight: 700 }}>{f.saldo}</td>
                              <td style={tdStyle}>{f.esFestivo ? "Festivo" : "Normal"}</td>
                              <td style={{ ...tdStyle, maxWidth: 200, fontSize: 12, color: "#5C5F5A", fontStyle: f.observacion ? "normal" : "italic" }}>
                                {f.observacion || "Sin observación"}
                              </td>
                              <td style={tdStyle}>
                                {aprobado && <span style={{ color: "#2E7D32", fontWeight: 600 }}>✓ Aprobado</span>}
                                {rechazado && <span style={{ color: "#C62828", fontWeight: 600 }}>✗ Rechazado</span>}
                                {!f.aprobacionEstado && <span style={{ color: "#5C5F5A" }}>Pendiente</span>}
                              </td>
                              <td style={tdStyle}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    onClick={() => handleAprobacion(f, "aprobado")}
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, background: aprobado ? "#2E7D32" : "#E8F5E9", color: aprobado ? "white" : "#2E7D32", border: "1px solid #2E7D32", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                                  >
                                    <CheckCircle size={12} /> Aprobar
                                  </button>
                                  <button
                                    onClick={() => handleAprobacion(f, "rechazado")}
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, background: rechazado ? "#C62828" : "#FDECEA", color: rechazado ? "white" : "#C62828", border: "1px solid #C62828", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
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

        {/* Gráficas */}
        {!cargando && !error && totalesParaGraficas.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 24 }}>
            <GraficaBarras titulo={tiendaSeleccionada ? "Horas extras normales (total de la tienda)" : "Mayor horas extras normales"} datos={datosExtrasNormales} color="#3FBFC4" />
            <GraficaBarras titulo={tiendaSeleccionada ? "Horas festivas / dominicales (total de la tienda)" : "Mayor horas festivas / dominicales"} datos={datosExtrasFestivas} color={rol.color} />
            <GraficaBarras titulo={tiendaSeleccionada ? "Horas nocturnas (total de la tienda)" : "Mayor horas nocturnas"} datos={datosNocturnas} color="#7C5CFF" />
          </div>
        )}
      </div>

      {/* Planilla de tienda seleccionada */}
      {tiendaSeleccionada && (
        <div style={{ borderTop: `4px solid ${rol.color}`, marginTop: 8 }}>
          <HorariosTienda codigoTienda={tiendaSeleccionada} onSalir={() => setTiendaSeleccionada("")} />
        </div>
      )}
    </div>
  );
}

/* ─── Componentes auxiliares ─── */
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

const thStyle = { padding: "9px 8px", textAlign: "left", fontWeight: 600 };
const tdStyle = { padding: "8px", fontSize: 12.5, verticalAlign: "middle" };

const fieldInputStyle = {
  width: "100%", border: "1px solid #DEDBD2", borderRadius: 6,
  padding: "7px 10px", fontSize: 13, fontFamily: "inherit",
  background: "#FAFAF8", outline: "none", color: "#241C14",
  boxSizing: "border-box",
};

function btnStyle(bg, color, transparent = false) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: bg, color,
    border: transparent ? "1px solid rgba(255,255,255,0.5)" : "none",
    borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };
}
