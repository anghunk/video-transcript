import { useEffect, useRef } from 'react';
import type { ThemeMode } from '../types';

interface ParticleFieldProps {
  theme: ThemeMode;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
}

const PARTICLE_COLORS: Record<ThemeMode, string[]> = {
  dark: ['92, 228, 194', '255, 120, 90', '226, 232, 240'],
  light: ['20, 166, 134', '224, 88, 61', '53, 71, 92'],
};

/** 为每个粒子生成稳定的随机运动状态。 */
function createParticle(width: number, height: number, colors: string[]): Particle {
  const radius = 0.8 + Math.random() * 1.8;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.22,
    vy: (Math.random() - 0.5) * 0.22,
    radius,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 0.26 + Math.random() * 0.34,
  };
}

/**
 * 首页背景粒子层。
 *
 * 使用 Canvas 绘制低频运动的点阵和邻近连线，为首页提供轻量的技术感背景。
 * 当用户开启“减少动态效果”时只绘制一帧静态画面。
 */
export function ParticleField({ theme }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const canvasElement: HTMLCanvasElement = canvas;
    const drawingContext: CanvasRenderingContext2D = context;
    const colors = PARTICLE_COLORS[theme];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 1;
    let height = 1;
    let frameId = 0;
    let particles: Particle[] = [];

    function resize() {
      const rect = canvasElement.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvasElement.width = Math.round(width * pixelRatio);
      canvasElement.height = Math.round(height * pixelRatio);
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const count = Math.min(68, Math.max(24, Math.round((width * height) / 24000)));
      particles = Array.from({ length: count }, () => createParticle(width, height, colors));
    }

    function draw() {
      drawingContext.clearRect(0, 0, width, height);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -10) particle.x = width + 10;
        if (particle.x > width + 10) particle.x = -10;
        if (particle.y < -10) particle.y = height + 10;
        if (particle.y > height + 10) particle.y = -10;

        drawingContext.beginPath();
        drawingContext.fillStyle = `rgba(${particle.color}, ${particle.alpha})`;
        drawingContext.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        drawingContext.fill();

        for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
          const next = particles[nextIndex];
          const deltaX = particle.x - next.x;
          const deltaY = particle.y - next.y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance > 126) continue;

          const alpha = (1 - distance / 126) * 0.13;
          drawingContext.beginPath();
          drawingContext.strokeStyle = `rgba(${particle.color}, ${alpha})`;
          drawingContext.lineWidth = 0.6;
          drawingContext.moveTo(particle.x, particle.y);
          drawingContext.lineTo(next.x, next.y);
          drawingContext.stroke();
        }
      }
    }

    function animate() {
      draw();
      frameId = window.requestAnimationFrame(animate);
    }

    resize();
    if (reduceMotion) draw();
    else frameId = window.requestAnimationFrame(animate);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasElement);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [theme]);

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
}
