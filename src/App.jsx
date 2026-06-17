import React, { useState, useEffect } from "react";
import { Lock, Store, ShieldCheck } from "lucide-react";
import { supabase } from "./supabaseClient";
import HorariosTienda from "./HorariosTienda";
import PanelAdmin from "./PanelAdmin";

const SESSION_KEY = "ritmo-sesion-tienda";
const ADMIN_PASSWORD = "RiTMO1234";

function LoginTienda({ onIngresar }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [modo, setModo] = useState("ingresar"); // "ingresar" | "crear"

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
    <div style={{ minHeight: "100vh", background: "#FFF6EE", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
      <form onSubmit={handleIngresar} style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 32, maxWidth: 400, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "#E85D1F" }}>
          <Store size={20} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>Tiendas RITMO</span>
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

        <button
          type="button"
          onClick={() => { setModo(modo === "ingresar" ? "crear" : "ingresar"); setError(""); }}
          style={{ width: "100%", background: "transparent", border: "none", color: "#1B8388", fontSize: 12.5, marginTop: 14, cursor: "pointer" }}
        >
          {modo === "ingresar" ? "¿Primera vez? Crear nueva tienda" : "Ya tengo una tienda, ingresar"}
        </button>
      </form>
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
    <div style={{ minHeight: "100vh", background: "#FFF6EE", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ background: "white", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: 32, maxWidth: 380, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "#E85D1F" }}>
          <ShieldCheck size={20} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>Panel administrativo</span>
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
  const [ruta, setRuta] = useState(() => (window.location.pathname.startsWith("/admin") ? "admin" : "tienda"));
  const [codigoTienda, setCodigoTienda] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) || "";
    } catch (e) {
      return "";
    }
  });
  const [adminAutenticado, setAdminAutenticado] = useState(false);

  useEffect(() => {
    const onPopState = () => setRuta(window.location.pathname.startsWith("/admin") ? "admin" : "tienda");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleIngresarTienda = (codigo) => {
    setCodigoTienda(codigo);
    try {
      sessionStorage.setItem(SESSION_KEY, codigo);
    } catch (e) {
      // no-op
    }
  };

  const handleSalirTienda = () => {
    setCodigoTienda("");
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      // no-op
    }
  };

  if (ruta === "admin") {
    if (!adminAutenticado) {
      return <LoginAdmin onIngresar={() => setAdminAutenticado(true)} />;
    }
    return <PanelAdmin />;
  }

  if (!codigoTienda) {
    return <LoginTienda onIngresar={handleIngresarTienda} />;
  }

  return <HorariosTienda codigoTienda={codigoTienda} onSalir={handleSalirTienda} />;
}

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
