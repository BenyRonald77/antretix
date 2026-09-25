"use client";

import { useState, type PointerEvent } from "react";
import { formatNumber, formatTime } from "@/lib/format";

export interface Sample {
  at: string;
  value: number;
}

const WIDTH = 560;

const HEIGHT = 180;

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

function niceMax(value: number): number {
  if (value <= 5) {
    return 5;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));

  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * Grafik garis satu seri (judul chart menamai serinya, jadi tanpa kotak legenda).
 * Garis 2px, grid samar, satu sumbu Y, crosshair + tooltip saat hover, dan tabel sebagai tampilan alternatif.
 * `reference` menggambar garis batas (mis. maks. pengguna aktif) sebagai garis putus-putus berlabel.
 */
export function LineChart({
  title,
  samples,
  reference,
}: {
  title: string;
  samples: readonly Sample[];
  reference?: { label: string; value: number };
}) {
  const [hover, setHover] = useState<number | null>(null);

  const maxValue = niceMax(
    Math.max(reference?.value ?? 0, ...samples.map((sample) => sample.value), 1),
  );

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (samples.length <= 1 ? plotWidth : (index / (samples.length - 1)) * plotWidth);

  const y = (value: number) => PAD.top + plotHeight - (value / maxValue) * plotHeight;

  const path = samples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(sample.value).toFixed(1)}`,
    )
    .join(" ");

  const ticks = [0, maxValue / 2, maxValue];
  const hovered = hover === null ? null : samples[hover];
  const last = samples.at(-1);

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;

    setHover(Math.min(samples.length - 1, Math.max(0, Math.round(ratio * (samples.length - 1)))));
  };

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-4">
        <span className="font-semibold">{title}</span>
        <span className="tabular text-sm text-ink-2">
          {last === undefined ? "—" : `terakhir ${formatNumber(last.value)}`}
        </span>
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}. Nilai terakhir ${last?.value ?? 0}.`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--rule)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-2)"
              >
                {formatNumber(Math.round(tick))}
              </text>
            </g>
          ))}
          {reference === undefined ? null : (
            <g>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--ink-2)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={WIDTH - PAD.right}
                y={y(reference.value) - 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--ink-2)"
              >
                {reference.label}
              </text>
            </g>
          )}
          {samples.length > 1 ? (
            <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
          ) : null}
          {hovered === undefined || hovered === null || hover === null ? null : (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                stroke="var(--ink-2)"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(hovered.value)}
                r={4}
                fill="var(--ink)"
                stroke="var(--paper)"
                strokeWidth={2}
              />
            </g>
          )}
          <text x={PAD.left} y={HEIGHT - 6} fontSize={11} fill="var(--ink-2)">
            {samples[0] === undefined ? "" : formatTime(samples[0].at)}
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 6}
            textAnchor="end"
            fontSize={11}
            fill="var(--ink-2)"
          >
            {last === undefined ? "" : formatTime(last.at)}
          </text>
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hovered === undefined || hovered === null || hover === null ? null : (
          <div
            className="pointer-events-none absolute top-0 rounded-sm border border-rule bg-paper px-2 py-1 text-sm"
            style={{
              left: `${(x(hover) / WIDTH) * 100}%`,
              transform: hover > samples.length / 2 ? "translateX(-105%)" : "translateX(5%)",
            }}
          >
            <span className="tabular font-semibold">{formatNumber(hovered.value)}</span>
            <span className="ml-2 text-ink-2">{formatTime(hovered.at)}</span>
          </div>
        )}
      </div>
      <details className="mt-1 text-sm text-ink-2">
        <summary className="cursor-pointer">Lihat sebagai tabel</summary>
        <table className="tabular mt-2 w-full max-w-xs">
          <tbody>
            {samples
              .slice(-10)
              .toReversed()
              .map((sample) => (
                <tr key={sample.at}>
                  <td className="py-0.5">{formatTime(sample.at)}</td>
                  <td className="py-0.5 text-right text-ink">{formatNumber(sample.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
