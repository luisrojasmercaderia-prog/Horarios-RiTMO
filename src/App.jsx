import React, { useState, useEffect } from "react";
import { Lock, Store, ShieldCheck, Clock } from "lucide-react";
import { supabase } from "./supabaseClient";
import HorariosTienda from "./HorariosTienda";
import PanelAdmin from "./PanelAdmin";
import Fichaje from "./Fichaje";

const SESSION_KEY = "ritmo-sesion-tienda";
const ADMIN_PASSWORD = "RiTMO1234";

function LoginTienda({ onIngresar }) {
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

      if (modo
