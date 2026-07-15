// Copyright Thales 2026
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useEffect, useRef, useState } from "react";
import IconButton from "@shared/atoms/IconButton/IconButton";

interface PrestonEditorBlockProps {
  presentation_id: string;
  base_url?: string;
}

export function PrestonEditorBlock({ presentation_id, base_url = "http://localhost:5050" }: PrestonEditorBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === iframeRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void iframeRef.current?.requestFullscreen();
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 60px)" }}>
      <iframe
        ref={iframeRef}
        src={`${base_url}/presentation?id=${presentation_id}`}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        title={`Presenton editor — ${presentation_id}`}
      />
      <IconButton
        type="button"
        color="primary"
        variant="filled"
        size="medium"
        icon={{ category: "outlined", type: isFullscreen ? "fullscreen_exit" : "fullscreen" }}
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        style={{ position: "absolute", top: 12, right: 12, zIndex: 1000 }}
      />
    </div>
  );
}
