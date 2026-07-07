"use client";

import { useEffect, useRef } from "react";

interface Props {
  xml: string;
}

export default function BpmnViewer({ xml }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current || !xml) return;

    let viewer: { importXML: (xml: string) => Promise<unknown>; destroy: () => void; get: (name: string) => { zoom: (level: string) => void } } | null = null;

    const init = async () => {
      const BpmnJS = (await import("bpmn-js/lib/NavigatedViewer")).default;
      viewer = new BpmnJS({ container: containerRef.current! });
      viewerRef.current = viewer;
      try {
        await viewer.importXML(xml);
        viewer.get("canvas").zoom("fit-viewport");
      } catch (err) {
        console.error("Error rendering BPMN:", err);
      }
    };

    init();

    return () => {
      if (viewer) viewer.destroy();
    };
  }, [xml]);

  return <div ref={containerRef} className="w-full h-full bg-white" />;
}
