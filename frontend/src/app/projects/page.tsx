"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Project } from "@/lib/api";
import { Plus, FolderOpen, Clock, CheckCircle, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.getToken()) { router.push("/"); return; }
    api.listProjects().then(setProjects).catch(() => router.push("/")).finally(() => setLoading(false));
  }, [router]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const project = await api.createProject(newName, newDesc);
    router.push(`/projects/${project.id}`);
  };

  const handleDelete = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      `¿Eliminar el proyecto «${project.name}»?\n\nSe borrarán la entrevista, documentos y diagnóstico asociados. Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    setError(null);
    setDeletingId(project.id);
    try {
      await api.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el proyecto.");
    } finally {
      setDeletingId(null);
    }
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
          <div className="bg-white rounded-lg px-2 py-1">
            <Image
              src="/processum.png"
              alt="Processum"
              width={120}
              height={30}
              className="h-7 w-auto object-contain"
              priority
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Processum S.A.</h1>
            <p className="text-xs text-white/60">Consultorías y capacitación en SGC</p>
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
            <p className="text-sm text-ink-muted mt-1">Gestione entrevistas y documentación del SGC</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 w-fit">
            <Plus className="w-4 h-4" /> Nuevo proyecto
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-danger/20 bg-danger-muted px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {showCreate && (
          <div className="card mb-8 animate-slide-up">
            <h3 className="font-semibold text-ink mb-4">Crear nuevo proyecto</h3>
            <div className="space-y-3 max-w-lg">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-1.5">
                  <label htmlFor="project-org-name" className="text-sm font-medium text-ink">
                    Nombre del proyecto / organización
                  </label>
                  <span className="text-xs text-ink-muted sm:text-right max-w-sm">
                    Indique el nombre de la empresa; con base en él se generarán los documentos SGC y aparecerá en «Organización».
                  </span>
                </div>
                <input
                  id="project-org-name"
                  className="input-field"
                  placeholder="Ej. Distribuidora Andina S.A."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
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
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/projects/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/projects/${p.id}`);
                }
              }}
              className="card-interactive text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <FolderOpen className="w-8 h-8 text-secondary" />
                <div className="flex items-center gap-2">
                  {statusIcon(p.status)}
                  <button
                    type="button"
                    title="Eliminar proyecto"
                    aria-label={`Eliminar proyecto ${p.name}`}
                    disabled={deletingId === p.id}
                    onClick={(e) => handleDelete(p, e)}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-faint hover:text-danger hover:bg-danger-muted transition-colors disabled:opacity-50"
                  >
                    {deletingId === p.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-lg text-ink mb-1">{p.name}</h3>
              {p.description && <p className="text-sm text-ink-muted mb-4 line-clamp-2">{p.description}</p>}
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="bg-surface px-2 py-1 rounded-md">{statusLabel[p.status] || p.status}</span>
                <span>{new Date(p.updated_at).toLocaleDateString("es")}</span>
              </div>
            </div>
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
