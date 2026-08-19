'use client';

import React, { useEffect, useRef } from 'react';

interface SignalVisualizerProps {
  rawSignal: number[];
  filteredSignal?: number[]; // FIX: Made optional
  title?: string;
  color?: string;
  height?: number;
}

export default function SignalVisualizer({
  rawSignal = [],
  filteredSignal = [], // Default to empty array if undefined
  title = 'Signal',
  color = 'cyan',
  height = 150
}: SignalVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Logic: Show filtered if available, else raw
  const data = (filteredSignal && filteredSignal.length > 0) ? filteredSignal : rawSignal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (data.length === 0) {
      // Draw "Waiting" line
      ctx.beginPath();
      ctx.strokeStyle = '#333';
      ctx.moveTo(0, rect.height / 2);
      ctx.lineTo(rect.width, rect.height / 2);
      ctx.stroke();
      return;
    }

    // Auto-Scale
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    // Prevent flatline divide-by-zero
    if (max === min) {
      min -= 0.5;
      max += 0.5;
    }

    const range = max - min;
    const padding = range * 0.1;
    const yMin = min - padding;
    const yMax = max + padding;
    const yRange = yMax - yMin;
    const stepX = rect.width / (data.length - 1 || 1);
    
    ctx.beginPath();
    ctx.strokeStyle = color === 'emerald' ? '#10b981' : '#06b6d4';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
      const x = i * stepX;
      const normalizedY = (data[i] - yMin) / (yRange || 1);
      const y = rect.height - (normalizedY * rect.height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

  }, [data, color, height]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      {title && (
        <div className="px-4 py-2 border-b border-border bg-muted/20 flex justify-between items-center">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </div>
      )}
      <div style={{ height: height }} className="relative w-full">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} className="block" />
      </div>
    </div>
  );
}