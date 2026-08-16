import React, { useEffect, useRef } from "react";
import "./TechBackground.css";

const TechBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const mouse = {
      x: width / 2,
      y: height / 2,
      targetX: width / 2,
      targetY: height / 2,
      active: false,
    };

    const handleMouseMove = (e) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.active = false;
    };

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      initData();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("resize", handleResize);

    // Tech Elements
    let microNodes = [];
    let dataPulses = [];
    let particles = [];
    let ringPings = [];
    let time = 0;

    function initData() {
      microNodes = [];
      dataPulses = [];
      particles = [];
      ringPings = [];

      const gridSize = 80;
      const cols = Math.ceil(width / gridSize);
      const rows = Math.ceil(height / gridSize);

      // 1. Grid Intersection Nodes (Dimmed)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.4) {
            microNodes.push({
              x: c * gridSize + (gridSize / 2),
              y: r * gridSize + (gridSize / 2),
              type: Math.random() < 0.2 ? "cross" : "dot",
              baseAlpha: Math.random() * 0.06 + 0.02, // Ultra soft opacity
              pulseOffset: Math.random() * Math.PI * 2,
              color: Math.random() < 0.5 ? "#38bdf8" : "#818cf8"
            });
          }
        }
      }

      // 2. Dim Micro Data Signal Streams
      const pulseCount = 14;
      for (let i = 0; i < pulseCount; i++) {
        const isHorizontal = Math.random() > 0.5;
        const linePos = Math.floor(Math.random() * (isHorizontal ? rows : cols)) * gridSize + (gridSize / 2);

        dataPulses.push({
          isHorizontal,
          linePos,
          progress: Math.random() * (isHorizontal ? width : height),
          speed: (Math.random() * 0.4 + 0.25),
          length: Math.random() * 40 + 20,
          color: i % 2 === 0 ? "rgba(56, 189, 248, " : "rgba(129, 140, 248, "
        });
      }

      // 3. Faint Floating Asteroid Particles (Subtle Low Brightness)
      const particleCount = 24;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * 1.0 + 0.5,
          alpha: Math.random() * 0.08 + 0.03, // Low dim brightness
          color: i % 2 === 0 ? "#38bdf8" : "#a855f7"
        });
      }
    }

    initData();

    // Main render loop
    const render = () => {
      time += 0.008;

      mouse.x += (mouse.targetX - mouse.x) * 0.05;
      mouse.y += (mouse.targetY - mouse.y) * 0.05;

      ctx.clearRect(0, 0, width, height);

      // A. Faint Calming Waves
      ctx.save();
      for (let w = 0; w < 2; w++) {
        ctx.beginPath();
        const waveY = height * (0.3 + w * 0.35);
        const amplitude = 25 + w * 10;
        const frequency = 0.0018;
        const speed = time * (w === 0 ? 0.7 : -0.5);

        ctx.moveTo(0, waveY);
        for (let x = 0; x <= width; x += 20) {
          const y = waveY + Math.sin(x * frequency + speed) * amplitude + Math.cos((x + time * 15) * 0.001) * 10;
          ctx.lineTo(x, y);
        }

        ctx.strokeStyle = w === 0 ? "rgba(56, 189, 248, 0.025)" : "rgba(129, 140, 248, 0.018)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      // B. Soft Damped Mouse Light Glow
      if (mouse.active) {
        const aura = ctx.createRadialGradient(
          mouse.x, mouse.y, 0,
          mouse.x, mouse.y, 200
        );
        aura.addColorStop(0, "rgba(56, 189, 248, 0.035)");
        aura.addColorStop(0.6, "rgba(56, 189, 248, 0.01)");
        aura.addColorStop(1, "rgba(56, 189, 248, 0)");
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, width, height);
      }

      // C. Draw Micro Grid Nodes
      for (let i = 0; i < microNodes.length; i++) {
        const node = microNodes[i];
        const alpha = node.baseAlpha + Math.sin(time * 2 + node.pulseOffset) * 0.02;

        ctx.save();
        ctx.globalAlpha = Math.max(0.01, Math.min(0.12, alpha));

        if (node.type === "cross") {
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(node.x - 3, node.y);
          ctx.lineTo(node.x + 3, node.y);
          ctx.moveTo(node.x, node.y - 3);
          ctx.lineTo(node.x, node.y + 3);
          ctx.stroke();
        } else {
          ctx.fillStyle = node.color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 1.0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // D. Draw Dim Drifting Particles (Asteroids in background)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Faint Constellation Links
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.save();
            ctx.globalAlpha = (1 - dist / 100) * 0.04; // Extremely dim lines
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // E. Micro Data Signal Streams (Low Opacity)
      for (let i = 0; i < dataPulses.length; i++) {
        const p = dataPulses[i];
        p.progress += p.speed;

        const maxBoundary = p.isHorizontal ? width : height;
        if (p.progress > maxBoundary + p.length) {
          p.progress = -p.length;
        }

        ctx.save();
        let grad;
        if (p.isHorizontal) {
          grad = ctx.createLinearGradient(p.progress - p.length, p.linePos, p.progress, p.linePos);
          grad.addColorStop(0, p.color + "0)");
          grad.addColorStop(0.8, p.color + "0.05)");
          grad.addColorStop(1, p.color + "0.12)");

          ctx.fillStyle = grad;
          ctx.fillRect(p.progress - p.length, p.linePos - 0.5, p.length, 1.0);
        } else {
          grad = ctx.createLinearGradient(p.linePos, p.progress - p.length, p.linePos, p.progress);
          grad.addColorStop(0, p.color + "0)");
          grad.addColorStop(0.8, p.color + "0.05)");
          grad.addColorStop(1, p.color + "0.12)");

          ctx.fillStyle = grad;
          ctx.fillRect(p.linePos - 0.5, p.progress - p.length, 1.0, p.length);
        }
        ctx.restore();
      }

      // F. Subtle Soft Sonar Ring Pings
      if (Math.random() < 0.02 && ringPings.length < 3 && microNodes.length > 0) {
        const targetNode = microNodes[Math.floor(Math.random() * microNodes.length)];
        ringPings.push({
          x: targetNode.x,
          y: targetNode.y,
          r: 2,
          maxR: 18,
          alpha: 0.08, // Very soft ping
          color: targetNode.color
        });
      }

      for (let i = ringPings.length - 1; i >= 0; i--) {
        const ping = ringPings[i];
        ping.r += 0.3;
        ping.alpha -= 0.003;

        if (ping.alpha <= 0 || ping.r >= ping.maxR) {
          ringPings.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, ping.alpha);
        ctx.strokeStyle = ping.color;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, ping.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="tech-bg-wrapper">
      <div className="tech-grid-overlay"></div>
      <canvas ref={canvasRef} className="tech-canvas" />
    </div>
  );
};

export default TechBackground;
