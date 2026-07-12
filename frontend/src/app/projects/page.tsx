"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Project } from "@/lib/api";
import { Plus, FolderOpen, Clock, CheckCircle, Shield, Loader2 } from "lucide-react";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    if (!api.getToken()) { router.push("/"); return; }
    api.listProjects().then(setProjects).catch(() => router.push("/")).finally(() => setLoading(false));
  }, [router]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const project = await api.createProject(newName, newDesc);
    router.push(`/projects/${project.id}`);
  };

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="w-4 h-4 text-success" />;
    return <Clock className="w-4 h-4 text-warning" />;
  };

  const statusLabel: Record<string, string> = {
    draft: "Borrador", analyzing: "Analizando", questioning: "Preguntas",
    modeling: "Modelando", completed: "Completado",
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface text-ink-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando proyectos…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-primary text-white px-6 lg:px-10 py-4 flex justify-between items-center shadow-elevated">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">GeoCar · Agente de Procesos</h1>
            <p className="text-xs text-white/60">Plataforma de levantamiento ISO 9001:2015</p>
          </div>
        </div>
        <button onClick={() => { api.clearToken(); router.push("/"); }} className="text-sm text-white/80 hover:text-white font-medium">
          Cerrar sesión
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-10">
          <div>
            <h2 className="text-2xl font-semibold text-ink">Mis proyectos</h2>
            <p className="text-sm text-ink-muted mt-1">Gestione entrevistas y documentación del SGQ</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 w-fit">
            <Plus className="w-4 h-4" /> Nuevo proyecto
          </button>
        </div>

        {showCreate && (
          <div className="card mb-8 animate-slide-up">
            <h3 className="font-semibold text-ink mb-4">Crear nuevo proyecto</h3>
            <div className="space-y-3 max-w-lg">
              <input className="input-field" placeholder="Nombre del proyecto / organización" value={newName}
                onChange={(e) => setNewName(e.target.value)} />
              <textarea className="input-field" placeholder="Descripción (opcional)" value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)} rows={2} />
              <div className="flex gap-2">
                <button onClick={handleCreate} className="btn-primary">Crear proyecto</button>
                <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => (
            <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)}
              className="card-interactive text-left">
              <div className="flex items-start justify-between mb-4">
                <FolderOpen className="w-8 h-8 text-secondary" />
                {statusIcon(p.status)}
              </div>
              <h3 className="font-semibold text-lg text-ink mb-1">{p.name}</h3>
              {p.description && <p className="text-sm text-ink-muted mb-4 line-clamp-2">{p.description}</p>}
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="bg-surface px-2 py-1 rounded-md">{statusLabel[p.status] || p.status}</span>
                <span>{new Date(p.updated_at).toLocaleDateString("es")}</span>
              </div>
            </button>
          ))}
        </div>

        {projects.length === 0 && (
          <div className="card text-center py-16 text-ink-muted">
            <FolderOpen className="w-14 h-14 mx-auto mb-4 opacity-30" />
            <p>No hay proyectos aún. Cree uno para comenzar el levantamiento.</p>
          </div>
        )}
      </main>
    </div>
  );
}
