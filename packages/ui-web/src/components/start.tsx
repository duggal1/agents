"use client";

import MetallicPaint from "./logo-start";

// Your logo: black fill + padded square viewBox so the metallic effect shows through and doesn't clip
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="-10 -13 40 40" fill="#000"><path d="M18.51.671 14.99 2.156a13.58 13.58 0 0 1-10.552 0L.916.671A.66.66 0 0 0 0 1.283v11.156c0 .473.48.795.916.611l3.52-1.485a13.58 13.58 0 0 1 10.553 0l3.521 1.485a.66.66 0 0 0 .916-.611V1.283A.66.66 0 0 0 18.51.67m-1.28 7.372c-.54.97-1.682 1.423-2.751 1.136a4 4 0 0 1-.41-.135 2 2 0 0 1-.27-.13c-1.202-.66-2.538-1.034-3.91-1.034h-.353c-1.371 0-2.708.374-3.91 1.035a2 2 0 0 1-.27.129q-.2.08-.41.135c-1.069.286-2.21-.166-2.75-1.136a2.44 2.44 0 0 1-.06-2.253c.503-1.031 1.675-1.538 2.783-1.255q.245.063.479.157.14.058.271.135c1.182.677 2.534 1.006 3.898 1.006h.292c1.363 0 2.714-.329 3.897-1.006q.131-.077.272-.135.234-.095.479-.157c1.108-.282 2.28.224 2.783 1.255a2.44 2.44 0 0 1-.06 2.253"/></svg>`;

const logo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg)}`;

export default function Component() {
  return (
    <div style={{ width: "100%", aspectRatio: "1 / 1" }}>
      <MetallicPaint
        imageSrc={logo}
        // Pattern
        seed={42}
        scale={4}
        patternSharpness={1}
        noiseScale={0.5}
        // Animation
        speed={0.3}
        liquid={0.75}
        mouseAnimation={false}
        // Visual
        brightness={2}
        contrast={0.5}
        refraction={0.01}
        blur={0.015}
        chromaticSpread={2}
        fresnel={1}
        angle={0}
        waveAmplitude={1}
        distortion={1}
        contour={0.2}
        // Colors
        lightColor="#ffffff"
        darkColor="#000000"
        tintColor="#feb3ff"
      />
    </div>
  );
}
