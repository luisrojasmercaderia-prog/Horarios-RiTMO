import React, { useState, useEffect } from "react";
import { Lock, ShieldCheck, Clock, CalendarDays, Calculator, LogOut, ArrowLeft } from "lucide-react";
import { supabase } from "./supabaseClient";
import HorariosTienda from "./HorariosTienda";
import PanelAdmin from "./PanelAdmin";
import Fichaje from "./Fichaje";
import CuadreCaja from "./CuadreCaja";
import logoRitmo from "./logo-ritmo.png";

const SESSION_KEY = "ritmo-sesion-tienda";
const ADMIN_PASSWORD = "RiTMO1234";
// Contraseña única para Cuadre de Caja (separada de la de Horarios de cada tienda).
// Para cambiarla, edita solo este valor.
const CUADRE_PASSWORD = "caja2026";

function LoginTienda({ onIngresar, onAdmin, modulo = "horarios", onVolver, ocultarExtras }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [modo, setModo] = useState("ingresar");
  const [showFichaje, setShowFichaje] = useState(false);

  const handleIngresar = async (e) => {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const codigoNorm = codigo.trim().toUpperCase();
      const { data, error: err } = await supabase
        .from("tiendas")
        .select("*")
        .eq("codigo", codigoNorm)
        .maybeSingle();

      if (err) throw err;

      if (modulo === "cuadre") {
        if (!data) {
          setError("No existe una tienda con ese código.");
          setCargando(false);
          return;
        }
        if (clave.trim() !== CUADRE_PASSWORD) {
          setError("Contraseña de Cuadre de Caja incorrecta.");
          setCargando(false);
          return;
        }
        onIngresar(codigoNorm);
        return;
      }

      if (modo === "crear") {
        if (data) {
          setError("Ese código de tienda ya existe. Usa 'Ingresar' en su lugar.");
          setCargando(false);
          return;
        }
        if (!nombre.trim() || !clave.trim()) {
          setError("Completa el nombre de la tienda y la contraseña.");
          setCargando(false);
          return;
        }
        const { error: insertErr } = await supabase
          .from("tiendas")
          .insert({ codigo: codigoNorm, nombre: nombre.trim(), clave: clave.trim() });
        if (insertErr) throw insertErr;
        onIngresar(codigoNorm);
        return;
      }

      if (!data) {
        setError("No existe una tienda con ese código. Usa 'Crear nueva tienda' si es la primera vez.");
        setCargando(false);
        return;
      }
      if (data.clave !== clave.trim()) {
        setError("Contraseña incorrecta.");
        setCargando(false);
        return;
      }
      onIngresar(codigoNorm);
    } catch (err) {
      setError("Ocurrió un error al conectar. Intenta de nuevo.");
      setCargando(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#3FBFC4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", padding: 20, position: "relative", overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="grain-tienda">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves={4} stitchTiles="stitch" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite operator="over" in2="SourceGraphic" />
        </filter>
      </svg>
      <div style={{ position: "absolute", inset: 0, filter: "url(#grain-tienda)", mixBlendMode: "overlay", opacity: 1, pointerEvents: "none" }} />
      <div style={{ background: "white", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden", display: "flex", maxWidth: 720, width: "100%", flexWrap: "wrap", position: "relative", zIndex: 1 }}>

        <div style={{ background: "#E85D1F", flex: "1 1 260px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2.5rem 1.75rem", textAlign: "center" }}>
          <img src={logoRitmo} alt="Tiendas RITMO" style={{ width: "100%", maxWidth: 220, marginBottom: 16, objectFit: "contain" }} />
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.5 }}>
            {modulo === "cuadre" ? "Cuadre Diario de Caja" : "Planilla de Horarios Semanal"}
          </p>
        </div>

        <form onSubmit={handleIngresar} style={{ flex: "1 1 280px", padding: "2.25rem 1.75rem" }}>
          {onVolver && (
            <button type="button" onClick={onVolver} style={{ background: "#F0F4F4", border: "1px solid #CFE0E0", color: "#2E9CA1", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "8px 14px", borderRadius: 8, marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={15} /> Volver al menú
            </button>
          )}
          <div style={{ fontSize: 16, fontWeight: 700, color: "#241C14", marginBottom: 2 }}>
            {modulo === "cuadre" ? "Cuadre de Caja" : "Bienvenido"}
          </div>
          <div style={{ fontSize: 13, color: "#5C5F5A", marginBottom: 20 }}>
            {modo === "ingresar" ? "Ingresa el código de tu tienda para continuar" : "Crea el acceso para una nueva tienda"}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Código de tienda</label>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. RIT-014" style={inputStyle} required />
          </div>

          {modo === "crear" && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Nombre de la tienda</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Santiago Centro" style={inputStyle} required />
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Contraseña</label>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••" style={inputStyle} required />
          </div>

          {error && (
            <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, marginBottom: 14 }}>{error}</div>
          )}

          <button type="submit" disabled={cargando} style={{ width: "100%", background: "#E85D1F", color: "white", border: "none", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: cargando ? "default" : "pointer", opacity: cargando ? 0.7 : 1 }}>
            {cargando ? "Verificando..." : modo === "ingresar" ? "Ingresar" : "Crear tienda"}
          </button>

          {!ocultarExtras && (
          <div style={{ borderTop: "1px solid #EDEBE4", marginTop: 18, paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowFichaje(true)}
              style={{
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "#3FBFC4",
                color: "white",
                border: "none",
                borderRadius: 7,
                padding: "10px 14px",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <Clock size={15} /> ¿Eres colaborador? Fichar entrada o salida
            </button>
          </div>
          )}

          {!ocultarExtras && onAdmin && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={onAdmin}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9A958C",
                  fontSize: 12.5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                }}
              >
                Acceso administrador
              </button>
            </div>
          )}
        </form>
      </div>

      {showFichaje && (
        <div
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
          onClick={() => setShowFichaje(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <Fichaje onCerrar={() => setShowFichaje(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function LoginAdmin({ onIngresar }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (clave === ADMIN_PASSWORD) {
      onIngresar();
    } else {
      setError("Clave incorrecta.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#3FBFC4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", padding: 20, position: "relative", overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="grain-admin">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves={4} stitchTiles="stitch" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite operator="over" in2="SourceGraphic" />
        </filter>
      </svg>
      <div style={{ position: "absolute", inset: 0, filter: "url(#grain-admin)", mixBlendMode: "overlay", opacity: 1, pointerEvents: "none" }} />
      <form onSubmit={handleSubmit} style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 32, maxWidth: 380, width: "100%", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "#E85D1F" }}>
          <ShieldCheck size={20} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>Panel administrador</span>
        </div>
        <div style={{ fontSize: 13, color: "#5C5F5A", marginBottom: 20 }}>Acceso para Jefe de Zona</div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, color: "#5C5F5A", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Clave de acceso</label>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••" style={inputStyle} autoFocus required />
        </div>

        {error && (
          <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12.5, padding: "8px 10px", borderRadius: 6, marginBottom: 14 }}>{error}</div>
        )}

        <button type="submit" style={{ width: "100%", background: "#E85D1F", color: "white", border: "none", borderRadius: 7, padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          <Lock size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Entrar
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [sesionInicial] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });
  const [ruta, setRuta] = useState(() => (window.location.pathname.startsWith("/admin") ? "admin" : "tienda"));
  const [modulo, setModulo] = useState(sesionInicial?.modulo || null); // null | "horarios" | "cuadre"
  const [codigoTienda, setCodigoTienda] = useState(sesionInicial?.codigo || "");
  const [adminAutenticado, setAdminAutenticado] = useState(false);
  const [nombreTienda, setNombreTienda] = useState("");

  useEffect(() => {
    const onPopState = () => setRuta(window.location.pathname.startsWith("/admin") ? "admin" : "tienda");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!codigoTienda) { setNombreTienda(""); return; }
    let activo = true;
    (async () => {
      const { data } = await supabase.from("tiendas").select("nombre").eq("codigo", codigoTienda).maybeSingle();
      if (activo && data) setNombreTienda(data.nombre || "");
    })();
    return () => { activo = false; };
  }, [codigoTienda]);

  const persistir = (m, c) => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ modulo: m, codigo: c })); } catch (e) {}
  };

  // Elegir módulo en el portal → todavía sin tienda → pedirá la clave
  const elegirModulo = (m) => { setModulo(m); persistir(m, ""); };
  // Login correcto de un módulo
  const loginExitoso = (codigo) => { setCodigoTienda(codigo); persistir(modulo, codigo); };
  // Volver al portal (vuelve a pedir clave la próxima vez)
  const volverMenu = () => {
    setModulo(null);
    setCodigoTienda("");
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  };

  if (ruta === "admin") {
    if (!adminAutenticado) {
      return <LoginAdmin onIngresar={() => setAdminAutenticado(true)} />;
    }
    return <PanelAdmin />;
  }

  // Pantalla de inicio: el portal con los dos módulos
  if (!modulo) {
    return (
      <PortalInicio
        onElegir={elegirModulo}
        onAdmin={() => { window.history.pushState({}, "", "/admin"); setRuta("admin"); }}
      />
    );
  }

  // Módulo elegido pero sin tienda autenticada → login con clave
  if (!codigoTienda) {
    return (
      <LoginTienda
        modulo={modulo}
        ocultarExtras
        onVolver={volverMenu}
        onIngresar={loginExitoso}
      />
    );
  }

  if (modulo === "horarios") {
    return <HorariosTienda codigoTienda={codigoTienda} onSalir={volverMenu} />;
  }

  if (modulo === "cuadre") {
    return <CuadreCaja codigoTienda={codigoTienda} nombreTienda={nombreTienda} onSalir={volverMenu} />;
  }

  return null;
}

function PortalInicio({ onElegir, onAdmin }) {
  const [showFichaje, setShowFichaje] = useState(false);
  return (
    <div style={{ minHeight: "100vh", background: "#3FBFC4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Century Gothic', 'CenturyGothic', 'AppleGothic', Futura, sans-serif", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", maxWidth: 560, width: "100%", overflow: "hidden" }}>
        <div style={{ background: "#E85D1F", padding: "2rem 1.75rem", textAlign: "center" }}>
          <img src={logoRitmo} alt="Tiendas RITMO" style={{ maxWidth: 230, width: "100%", objectFit: "contain" }} />
        </div>
        <div style={{ padding: "1.75rem" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#241C14", textAlign: "center", marginBottom: 18 }}>¿Qué deseas hacer?</div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button onClick={() => onElegir("horarios")} style={{ ...tarjetaModulo, borderTop: "3px solid #E85D1F" }}>
              <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#FBE7DC", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CalendarDays size={28} color="#E85D1F" />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#241C14" }}>Horarios</span>
              <span style={{ fontSize: 12.5, color: "#5C5F5A" }}>Planilla semanal de horarios</span>
            </button>

            <button onClick={() => onElegir("cuadre")} style={{ ...tarjetaModulo, borderTop: "3px solid #2E9CA1" }}>
              <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#DCF1F1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calculator size={28} color="#2E9CA1" />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#241C14" }}>Cuadre de Caja</span>
              <span style={{ fontSize: 12.5, color: "#5C5F5A" }}>Cuadre diario por cajero</span>
            </button>
          </div>

          <div style={{ borderTop: "1px solid #EDEBE4", marginTop: 18, paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowFichaje(true)}
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#3FBFC4", color: "white", border: "none", borderRadius: 7, padding: "10px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              <Clock size={15} /> ¿Eres colaborador? Fichar entrada o salida
            </button>
          </div>

          {onAdmin && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={onAdmin}
                style={{ background: "transparent", border: "none", color: "#9A958C", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}
              >
                Acceso administrador
              </button>
            </div>
          )}
        </div>
      </div>

      {showFichaje && (
        <div
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(36,28,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
          onClick={() => setShowFichaje(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <Fichaje onCerrar={() => setShowFichaje(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

const tarjetaModulo = {
  flex: "1 1 200px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  background: "#fff",
  border: "1px solid #EDE9E2",
  borderRadius: 12,
  padding: "1.5rem 1rem",
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "center",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #DEDBD2",
  borderRadius: 6,
  padding: "9px 11px",
  fontSize: 13.5,
  fontFamily: "inherit",
  background: "#FAFAF8",
  outline: "none",
  color: "#241C14",
  boxSizing: "border-box",
};
