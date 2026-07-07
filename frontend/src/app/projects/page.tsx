"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Project } from "@/lib/api";
import { Plus, FolderOpen, Clock, CheckCircle } from "lucide-react";

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
    if (status === "completed") return <CheckCircle className="w-4 h-4 text-emerald-600" />;
    return <Clock className="w-4 h-4 text-amber-500" />;
  };

  const statusLabel: Record<string, string> = {
    draft: "Borrador", analyzing: "Analizando", questioning: "Preguntas",
    modeling: "Modelando", completed: "Completado",
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-primary text-white px-8 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Agente de Procesos BPMN</h1>
        <button onClick={() => { api.clearToken(); router.push("/"); }} className="text-sm opacity-80 hover:opacity-100">
          Cerrar sesión
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold">Mis Proyectos de Procesos</h2>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nuevo Proyecto
          </button>
        </div>

        {showCreate && (
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">Crear nuevo proyecto</h3>
            <div className="space-y-3">
              <input className="input-field" placeholder="Nombre del proceso" value={newName}
                onChange={(e) => setNewName(e.target.value)} />
              <textarea className="input-field" placeholder="Descripción (opcional)" value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)} rows={2} />
              <div className="flex gap-2">
                <button onClick={handleCreate} className="btn-primary">Crear</button>
                <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)}
              className="card text-left hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <FolderOpen className="w-8 h-8 text-primary-light" />
                {statusIcon(p.status)}
              </div>
              <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
              {p.description && <p className="text-sm text-slate-500 mb-3 line-clamp-2">{p.description}</p>}
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="bg-slate-100 px-2 py-1 rounded">{statusLabel[p.status] || p.status}</span>
                <span>{new Date(p.updated_at).toLocaleDateString("es")}</span>
              </div>
            </button>
          ))}
        </div>

        {projects.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p>No hay proyectos aún. Crea uno para comenzar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
