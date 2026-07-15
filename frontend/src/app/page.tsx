"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="card w-full max-w-md shadow-elevated">
        <div className="text-center mb-8">
          <div className="flex justify-center">
            <Image
              src="/processum.png"
              alt="Processum"
              width={420}
              height={120}
              className="h-28 w-auto max-w-full object-contain"
              priority
            />
          </div>
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
