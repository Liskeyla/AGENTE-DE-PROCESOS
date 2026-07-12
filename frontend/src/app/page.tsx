"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Shield } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let result;
      if (isRegister) {
        result = await api.register(email, password, fullName, orgName);
      } else {
        result = await api.login(email, password);
      }
      api.setToken(result.access_token);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="card w-full max-w-md shadow-elevated">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-ink">GeoCar SGQ</h1>
          <p className="text-ink-muted mt-2 text-sm">Plataforma de levantamiento y documentación ISO 9001:2015</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <>
              <input className="input-field" placeholder="Nombre completo" value={fullName}
                onChange={(e) => setFullName(e.target.value)} required />
              <input className="input-field" placeholder="Organización" value={orgName}
                onChange={(e) => setOrgName(e.target.value)} required />
            </>
          )}
          <input className="input-field" type="email" placeholder="Correo corporativo" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
          <input className="input-field" type="password" placeholder="Contraseña" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6} />

          {error && <p className="text-danger text-sm bg-danger-muted px-3 py-2 rounded-lg">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Procesando…" : isRegister ? "Crear cuenta" : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-ink-muted">
          {isRegister ? "¿Ya tiene cuenta?" : "¿No tiene cuenta?"}{" "}
          <button type="button" onClick={() => setIsRegister(!isRegister)} className="text-secondary hover:underline font-medium">
            {isRegister ? "Iniciar sesión" : "Registrarse"}
          </button>
        </p>
      </div>
    </div>
  );
}
