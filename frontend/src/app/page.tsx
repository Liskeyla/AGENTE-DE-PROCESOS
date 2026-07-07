"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-teal-50">
      <div className="card w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Agente de Procesos</h1>
          <p className="text-slate-500 mt-2">Levantamiento y documentación BPMN con IA</p>
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
          <input className="input-field" type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
          <input className="input-field" type="password" placeholder="Contraseña" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6} />

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Procesando..." : isRegister ? "Registrarse" : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-center mt-4 text-sm text-slate-500">
          {isRegister ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?"}{" "}
          <button onClick={() => setIsRegister(!isRegister)} className="text-primary-light hover:underline">
            {isRegister ? "Iniciar sesión" : "Registrarse"}
          </button>
        </p>
      </div>
    </div>
  );
}
