"use client";

import { useEffect, useState, type ReactNode } from "react";

import { DeepLinkListener } from "@/components/DeepLinkListener";
import { Sidebar } from "@/components/Sidebar";
import { toErrorMessage } from "@/lib/errors";
import {
  chooseProjectDirectory,
  getProject,
  setProjectRoot,
} from "@/lib/tauri";
// Persisted project selection returned by the native runtime.
import type { DesktopProject } from "@/lib/tauri";

// Props accepted by the project-aware desktop application shell.
interface DesktopShellProps {
  children: ReactNode;
}

// Gates the application on an explicit project folder and keeps it visible.
export function DesktopShell({ children }: DesktopShellProps) {
  const [project, setProject] = useState<DesktopProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Loads the saved project without updating an unmounted shell.
    async function loadProject() {
      try {
        const selected = await getProject();
        if (!cancelled) {
          setProject(selected);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            toErrorMessage(loadError, "Failed to load the saved project."),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
    };
  }, []);

  // Opens the native picker and persists a validated directory choice.
  async function handleChooseProject() {
    setChoosing(true);
    setError(null);
    try {
      const path = await chooseProjectDirectory();
      if (!path) {
        return;
      }
      setProject(await setProjectRoot(path));
    } catch (chooseError) {
      setError(
        toErrorMessage(chooseError, "Failed to choose that project folder."),
      );
    } finally {
      setChoosing(false);
    }
  }

  if (loading) {
    return (
      <main className="project-gate" aria-busy="true">
        <div className="project-gate-status">Opening FrameShift...</div>
      </main>
    );
  }

  if (!project?.path) {
    return (
      <main className="project-gate">
        <section
          className="project-gate-card"
          aria-labelledby="project-gate-title"
        >
          <div className="project-gate-kicker">First step</div>
          <h1 id="project-gate-title">
            Choose the project your agent works in
          </h1>
          <p>
            FrameShift keeps personas separate for each project. Pick the folder
            that contains your code or agent instructions. Nothing is moved.
          </p>
          <div
            className="project-gate-example"
            aria-label="What FrameShift will do"
          >
            <span>1. Pick a folder</span>
            <span>2. Install personas</span>
            <span>3. Connect your agent and choose a mode</span>
          </div>
          {error ? (
            <div className="status-panel status-panel-error" role="alert">
              <strong>FrameShift could not open the saved project.</strong>
              <span>{error}</span>
            </div>
          ) : null}
          <button
            className="btn btn-primary project-gate-button"
            onClick={() => void handleChooseProject()}
            disabled={choosing}
          >
            {choosing ? "Opening folder picker..." : "Choose project folder"}
          </button>
          <p className="project-gate-footnote">
            You can switch projects later from the sidebar.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="app-shell">
        <Sidebar
          project={project}
          choosingProject={choosing}
          onChooseProject={() => void handleChooseProject()}
        />
        <main className="app-content" key={project.path}>
          <div className="app-content-topline">
            <span>Working in</span>
            <strong title={project.path}>{project.path}</strong>
          </div>
          {error ? (
            <div
              className="status-panel status-panel-error app-status"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {children}
        </main>
      </div>
      <DeepLinkListener />
    </>
  );
}
