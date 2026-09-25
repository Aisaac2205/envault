import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface AsciiGardenConfig {
  renderMode:
    | 'dither'
    | 'characters'
    | 'mosaic'
    | 'pixel'
    | 'dots'
    | 'cross'
    | 'diamond'
    | 'voxel'
    | 'lego'
    | 'mixed'
    | 'lines'
    | 'diagonal'
    | 'braille'
    | 'disco'
    | 'hexdump'
    | 'matrix'
    | 'rings'
    | 'hearts'
    | 'stars'
    | 'hexagons'
    | 'triangles'
    | 'bubbles'
    | 'hatch'
    | 'contour'
    | 'halfblocks';
  bgMode: 'none' | 'solid' | 'blur' | 'original';
  bgBlur: number;
  bgOpacity: number;
  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: GlobalCompositeOperation;
  charSet: 'standard' | 'minimal' | 'dense' | 'custom';
  customChars: string;
  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  toneCurve: Array<{ x: number; y: number }>;
  tint: string;
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  saturation: number;
  grayscale: number;
  blurType: 'off' | 'gaussian' | 'directional' | 'tilt' | 'lens' | 'progressive';
  blurAmount: number;
  blurAngle: number;
  directionalBothSides: boolean;
  tiltFocus: number;
  tiltPosition: number;
  tiltFeather: number;
  lensFocus: number;
  blurCenterX: number;
  blurCenterY: number;
  progressivePosition: number;
  progressiveReverse: boolean;
  pfx: {
    vignette: { enabled: boolean; intensity: number };
    scanLines: { enabled: boolean; intensity: number };
    chromatic: { enabled: boolean; intensity: number };
    bloom: { enabled: boolean; intensity: number };
    filmGrain: { enabled: boolean; intensity: number };
    glitch: { enabled: boolean; intensity: number };
    pixelate: { enabled: boolean; intensity: number };
    halftone: { enabled: boolean; intensity: number };
    filmDust: { enabled: boolean; intensity: number };
  };
  animated: boolean;
  animStyle: 'pulse' | 'wave' | 'shimmer' | 'ripple' | 'flicker';
  animSpeed: { enabled: boolean; intensity: number };
  animIntensity: { enabled: boolean; intensity: number };
  lights: {
    enabled: boolean;
    points: Array<{ x: number; y: number; radius: number; intensity: number }>;
  };
  mask: {
    enabled: boolean;
    tool: string;
    brushSize: number;
    showOverlay: boolean;
    invert: boolean;
    dataUrl: string | null;
    shapes: any[];
  };
  focalPoint?: { x: number; y: number };
  mobileFocalPoint?: { x: number; y: number };
}

export const DEFAULT_CONFIG: AsciiGardenConfig = {
  renderMode: 'dither',
  bgMode: 'original',
  bgBlur: 0,
  bgOpacity: 85,
  focalPoint: { x: 0.5, y: 0.5 },
  mobileFocalPoint: { x: 0.16, y: 0.65 },
  cellSize: 9,
  coverage: 100,
  invert: false,
  styleBlend: 'source-over',
  charSet: 'standard',
  customChars: '',
  brightness: 10,
  contrast: 135,
  edgeEmphasis: 0,
  density: 20,
  toneCurve: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  tint: '#fafafa',
  tintOpacity: 0,
  overlayBlend: 'multiply',
  saturation: 100,
  grayscale: 0,
  blurType: 'off',
  blurAmount: 35,
  blurAngle: 0,
  directionalBothSides: false,
  tiltFocus: 35,
  tiltPosition: 50,
  tiltFeather: 15,
  lensFocus: 40,
  blurCenterX: 50,
  blurCenterY: 50,
  progressivePosition: 55,
  progressiveReverse: false,
  pfx: {
    vignette: { enabled: false, intensity: 38 },
    scanLines: { enabled: false, intensity: 40 },
    chromatic: { enabled: false, intensity: 15 },
    bloom: { enabled: false, intensity: 25 },
    filmGrain: { enabled: false, intensity: 30 },
    glitch: { enabled: false, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
  },
  animated: true,
  animStyle: 'pulse',
  animSpeed: { enabled: true, intensity: 100 },
  animIntensity: { enabled: true, intensity: 60 },
  lights: { enabled: false, points: [] },
  mask: {
    enabled: false,
    tool: 'freehand',
    brushSize: 30,
    showOverlay: true,
    invert: false,
    dataUrl: null,
    shapes: [],
  },
};

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const STANDARD_CHARS = ' .:-=+*#%@';
const DENSE_CHARS = ' `.-\':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@';
const MINIMAL_CHARS = ' .:coCO#@';
const BRAILLE_CHARS = ['⠀', '⠄', '⠤', '⠠', '⠴', '⠶', '⠷', '⠿'];
const MATRIX_CHARS = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';

interface Props {
  sourcePhoto?: string;
  config?: Partial<AsciiGardenConfig>;
  className?: string;
  interactive?: boolean;
  onModeChange?: (mode: AsciiGardenConfig['renderMode']) => void;
}

export const AsciiGardenCanvas: React.FC<Props> = ({
  sourcePhoto = '/ascii-editor/demos/generated/hero.webp',
  config: userConfig,
  className = '',
  interactive = true,
  onModeChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const [activeConfig, setActiveConfig] = useState<AsciiGardenConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...userConfig,
  }));

  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [fps, setFps] = useState<number>(60);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Sync external config updates
  useEffect(() => {
    if (userConfig) {
      setActiveConfig((prev) => ({ ...prev, ...userConfig }));
    }
  }, [userConfig]);

  // Reduced motion preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Helper: Generate procedural Japanese Zen Ink Garden when image is loading / offline
  const drawProceduralGarden = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // Mountain silhouettes in background
    ctx.save();
    const mountainGrad = ctx.createLinearGradient(0, 0, 0, height);
    mountainGrad.addColorStop(0, '#1c1c24');
    mountainGrad.addColorStop(1, '#09090b');
    ctx.fillStyle = mountainGrad;

    ctx.beginPath();
    ctx.moveTo(0, height * 0.45);
    ctx.bezierCurveTo(width * 0.2, height * 0.15, width * 0.35, height * 0.35, width * 0.5, height * 0.2);
    ctx.bezierCurveTo(width * 0.65, height * 0.1, width * 0.85, height * 0.3, width, height * 0.4);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Raked sand ripples (horizontal wavy lines)
    ctx.strokeStyle = '#272733';
    ctx.lineWidth = 1.5;
    for (let y = height * 0.6; y < height; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= width; x += 30) {
        const offset = Math.sin((x + y * 2) * 0.02) * 6;
        ctx.lineTo(x, y + offset);
      }
      ctx.stroke();
    }

    // Zen stone on rock terrace (focal point)
    const stoneX = width * 0.68;
    const stoneY = height * 0.65;
    const stoneGrad = ctx.createRadialGradient(stoneX, stoneY, 10, stoneX, stoneY, 90);
    stoneGrad.addColorStop(0, '#ffffff');
    stoneGrad.addColorStop(0.4, '#808090');
    stoneGrad.addColorStop(1, '#181820');
    ctx.fillStyle = stoneGrad;
    ctx.beginPath();
    ctx.ellipse(stoneX, stoneY, 80, 50, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Stone Lantern silhouette on left
    const lanX = width * 0.22;
    const lanY = height * 0.62;
    ctx.fillStyle = '#404052';
    // Roof
    ctx.beginPath();
    ctx.moveTo(lanX - 35, lanY - 30);
    ctx.lineTo(lanX, lanY - 55);
    ctx.lineTo(lanX + 35, lanY - 30);
    ctx.closePath();
    ctx.fill();
    // Firebox
    ctx.fillRect(lanX - 18, lanY - 30, 36, 32);
    // Base & Column
    ctx.fillRect(lanX - 10, lanY + 2, 20, 50);
    ctx.fillRect(lanX - 25, lanY + 52, 50, 16);

    // Warm glow in lantern firebox
    const fireGrad = ctx.createRadialGradient(lanX, lanY - 14, 2, lanX, lanY - 14, 24);
    fireGrad.addColorStop(0, '#ffffff');
    fireGrad.addColorStop(0.3, '#bfe70a');
    fireGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = fireGrad;
    ctx.beginPath();
    ctx.arc(lanX, lanY - 14, 24, 0, Math.PI * 2);
    ctx.fill();

    // Bonsai tree branch above the rock
    ctx.strokeStyle = '#323242';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stoneX + 15, stoneY - 20);
    ctx.quadraticCurveTo(stoneX - 20, stoneY - 80, stoneX - 70, stoneY - 110);
    ctx.quadraticCurveTo(stoneX - 120, stoneY - 130, stoneX - 150, stoneY - 110);
    ctx.stroke();

    // Pine needle clumps
    ctx.fillStyle = '#606078';
    const clumps = [
      { x: stoneX - 70, y: stoneY - 115, r: 28 },
      { x: stoneX - 120, y: stoneY - 135, r: 35 },
      { x: stoneX - 155, y: stoneY - 112, r: 25 },
      { x: stoneX - 35, y: stoneY - 95, r: 22 },
    ];
    clumps.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }, []);

  // Load source photo
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = sourcePhoto;
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.onerror = () => {
      // Fallback: will render procedural sumi-e zen garden
      setImageLoaded(true);
    };
  }, [sourcePhoto]);

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenCanvasRef.current;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!offCtx) return;

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();

    const render = (time: number) => {
      // FPS measurement
      frameCount++;
      if (time - fpsTimer >= 1000) {
        setFps(Math.round((frameCount * 1000) / (time - fpsTimer)));
        frameCount = 0;
        fpsTimer = time;
      }

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(100, Math.floor(rect.width));
      const height = Math.max(100, Math.floor(rect.height));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        offscreen.width = width;
        offscreen.height = height;
      }

      // Step 1: Draw source photo / garden into offscreen canvas
      offCtx.clearRect(0, 0, width, height);
      if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
        // Draw image cover-fit with responsive focal framing
        const img = imageRef.current;
        const isMobile = width < 768 || width < height;
        const focalX = isMobile
          ? (activeConfig.mobileFocalPoint?.x ?? 0.16)
          : (activeConfig.focalPoint?.x ?? 0.5);
        const focalY = isMobile
          ? (activeConfig.mobileFocalPoint?.y ?? 0.65)
          : (activeConfig.focalPoint?.y ?? 0.5);

        const hRatio = width / img.naturalWidth;
        const vRatio = height / img.naturalHeight;
        const ratio = Math.max(hRatio, vRatio);

        const scaledW = img.naturalWidth * ratio;
        const scaledH = img.naturalHeight * ratio;

        const centerShiftX = Math.min(0, Math.max(width - scaledW, (width - scaledW) * focalX));
        const centerShiftY = Math.min(0, Math.max(height - scaledH, (height - scaledH) * focalY));

        offCtx.drawImage(
          img,
          0,
          0,
          img.naturalWidth,
          img.naturalHeight,
          centerShiftX,
          centerShiftY,
          scaledW,
          scaledH
        );
      } else {
        drawProceduralGarden(offCtx, width, height);
      }

      // Read pixel raster
      let imgData: ImageData;
      try {
        imgData = offCtx.getImageData(0, 0, width, height);
      } catch (err) {
        // Fallback if security taint
        drawProceduralGarden(offCtx, width, height);
        imgData = offCtx.getImageData(0, 0, width, height);
      }
      const data = imgData.data;

      // Clear main canvas
      ctx.clearRect(0, 0, width, height);

      // Step 1b: Background handling (bgMode / bgBlur / bgOpacity)
      if (activeConfig.bgMode !== 'none') {
        ctx.save();
        if (activeConfig.bgMode === 'blur') {
          ctx.filter = `blur(${activeConfig.bgBlur}px)`;
        }
        ctx.globalAlpha = activeConfig.bgOpacity / 100;
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
      }

      // Step 2 & 8: Animation factors
      const isAnimated = activeConfig.animated && !isReducedMotion;
      const animSpeedFactor = (activeConfig.animSpeed.intensity / 100) * 0.0018;
      const animIntensity = (activeConfig.animIntensity.intensity / 100) * 0.45;
      const animTime = isAnimated ? time * animSpeedFactor : 0;

      // Step 2: Grid segmentation — mobile screen gets finer cell size for delicate lotus flower outlines
      const isMobileFrame = width < 768 || width < height;
      const baseCell = activeConfig.cellSize;
      const cellSize = Math.max(4, isMobileFrame ? Math.min(baseCell, 6) : baseCell);
      const cols = Math.ceil(width / cellSize);
      const rows = Math.ceil(height / cellSize);

      // Contrast factor formula
      const contrastFactor =
        activeConfig.contrast !== 0
          ? (259 * (activeConfig.contrast + 255)) / (255 * (259 - activeConfig.contrast))
          : 1;

      // Color adjustment helpers
      const brightness = activeConfig.brightness;
      const saturation = activeConfig.saturation / 100;
      const grayscale = activeConfig.grayscale / 100;

      // Setup styles
      ctx.save();
      ctx.globalCompositeOperation = activeConfig.styleBlend;
      ctx.font = `${Math.floor(cellSize * 1.15)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const coverageRatio = activeConfig.coverage / 100;

      // Step 3: Draw shapes per cell
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (coverageRatio < 1 && (c * 7 + r * 13) % 100 > activeConfig.coverage) {
            continue;
          }

          const centerX = Math.floor(c * cellSize + cellSize / 2);
          const centerY = Math.floor(r * cellSize + cellSize / 2);
          if (centerX >= width || centerY >= height) continue;

          const pixelIndex = (centerY * width + centerX) * 4;
          let red = data[pixelIndex] ?? 0;
          let green = data[pixelIndex + 1] ?? 0;
          let blue = data[pixelIndex + 2] ?? 0;

          // Brightness & Contrast
          if (brightness !== 0) {
            red = Math.min(255, Math.max(0, red + brightness));
            green = Math.min(255, Math.max(0, green + brightness));
            blue = Math.min(255, Math.max(0, blue + brightness));
          }
          if (activeConfig.contrast !== 0) {
            red = Math.min(255, Math.max(0, contrastFactor * (red - 128) + 128));
            green = Math.min(255, Math.max(0, contrastFactor * (green - 128) + 128));
            blue = Math.min(255, Math.max(0, contrastFactor * (blue - 128) + 128));
          }

          // Saturation & Grayscale
          let lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          if (grayscale > 0) {
            red = red * (1 - grayscale) + lum * grayscale;
            green = green * (1 - grayscale) + lum * grayscale;
            blue = blue * (1 - grayscale) + lum * grayscale;
          }
          if (saturation !== 1) {
            red = Math.min(255, Math.max(0, lum + (red - lum) * saturation));
            green = Math.min(255, Math.max(0, lum + (green - lum) * saturation));
            blue = Math.min(255, Math.max(0, lum + (blue - lum) * saturation));
          }

          if (activeConfig.invert) {
            lum = 255 - lum;
            red = 255 - red;
            green = 255 - green;
            blue = 255 - blue;
          }

          // Step 8: Animation modulation per style
          let modLum = lum;
          if (isAnimated) {
            const distFromCenter = Math.hypot(c - cols / 2, r - rows / 2);
            switch (activeConfig.animStyle) {
              case 'pulse': {
                const wave = Math.sin(animTime + distFromCenter * 0.08);
                modLum = Math.min(255, Math.max(0, lum * (1 + wave * animIntensity)));
                break;
              }
              case 'wave': {
                const wave = Math.sin(animTime * 1.5 + (c + r) * 0.12);
                modLum = Math.min(255, Math.max(0, lum * (1 + wave * animIntensity)));
                break;
              }
              case 'ripple': {
                const mx = mousePos.x * cols;
                const my = mousePos.y * rows;
                const distFromMouse = Math.hypot(c - mx, r - my);
                const ripple = Math.sin(animTime * 2 - distFromMouse * 0.2);
                modLum = Math.min(255, Math.max(0, lum * (1 + ripple * animIntensity * 1.2)));
                break;
              }
              case 'shimmer': {
                const shimmer = Math.sin(animTime * 2.5 + c * 0.2) * Math.cos(animTime * 1.8 + r * 0.2);
                modLum = Math.min(255, Math.max(0, lum * (1 + shimmer * animIntensity)));
                break;
              }
              case 'flicker': {
                const noise = ((Math.sin(animTime * 10 + c * 3 + r * 7) + 1) / 2) * animIntensity;
                modLum = Math.min(255, Math.max(0, lum * (1 - noise * 0.5)));
                break;
              }
            }
          }

          // Interactive mouse light boost
          if (isHovering) {
            const mx = mousePos.x * width;
            const my = mousePos.y * height;
            const distMouse = Math.hypot(centerX - mx, centerY - my);
            if (distMouse < 180) {
              const boost = (1 - distMouse / 180) * 0.55;
              modLum = Math.min(255, modLum * (1 + boost));
            }
          }

          const normLum = modLum / 255;
          const alpha = Math.min(1, Math.max(0.12, normLum));

          // Draw per renderMode
          switch (activeConfig.renderMode) {
            case 'dither': {
              const threshold = (BAYER_4X4[r % 4][c % 4] / 16) * 255;
              const densityFactor = activeConfig.density / 20;
              if (modLum > threshold * (1 / densityFactor)) {
                const radius = Math.max(0.8, (cellSize / 2.3) * Math.sqrt(normLum));
                ctx.fillStyle = normLum > 0.65 ? '#ffffff' : (activeConfig.tint || '#bfe70a');
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fill();
              }
              break;
            }

            case 'characters': {
              const charList =
                activeConfig.charSet === 'dense'
                  ? DENSE_CHARS
                  : activeConfig.charSet === 'minimal'
                  ? MINIMAL_CHARS
                  : activeConfig.charSet === 'custom' && activeConfig.customChars
                  ? activeConfig.customChars
                  : STANDARD_CHARS;
              const charIndex = Math.min(charList.length - 1, Math.floor(normLum * charList.length));
              const glyph = charList[charIndex];
              ctx.fillStyle = activeConfig.tint || '#fafafa';
              ctx.globalAlpha = alpha;
              ctx.fillText(glyph, centerX, centerY);
              break;
            }

            case 'matrix': {
              const mIndex = (c * 3 + r * 5 + Math.floor(animTime * 10)) % MATRIX_CHARS.length;
              const char = MATRIX_CHARS[mIndex];
              ctx.fillStyle = normLum > 0.6 ? '#6ee7b7' : '#10b981';
              ctx.globalAlpha = Math.max(0.2, normLum);
              ctx.fillText(char, centerX, centerY);
              break;
            }

            case 'braille': {
              const bIndex = Math.min(BRAILLE_CHARS.length - 1, Math.floor(normLum * BRAILLE_CHARS.length));
              ctx.fillStyle = activeConfig.tint || '#ffffff';
              ctx.globalAlpha = alpha;
              ctx.fillText(BRAILLE_CHARS[bIndex], centerX, centerY);
              break;
            }

            case 'dots': {
              const dotRadius = Math.max(1, (cellSize / 2) * normLum);
              ctx.fillStyle = normLum > 0.6 ? '#ffffff' : (activeConfig.tint || '#bfe70a');
              ctx.globalAlpha = alpha;
              ctx.beginPath();
              ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
              ctx.fill();
              break;
            }

            case 'hexdump': {
              const hexVal = Math.floor(normLum * 255)
                .toString(16)
                .toUpperCase()
                .padStart(2, '0');
              ctx.font = `${Math.floor(cellSize * 0.85)}px monospace`;
              ctx.fillStyle = activeConfig.tint || '#bfe70a';
              ctx.globalAlpha = alpha;
              ctx.fillText(hexVal, centerX, centerY);
              ctx.font = `${Math.floor(cellSize * 1.15)}px monospace`;
              break;
            }

            case 'lines': {
              const lineLen = cellSize * normLum;
              ctx.strokeStyle = activeConfig.tint || '#ffffff';
              ctx.lineWidth = 1.5;
              ctx.globalAlpha = alpha;
              ctx.beginPath();
              ctx.moveTo(centerX - lineLen / 2, centerY);
              ctx.lineTo(centerX + lineLen / 2, centerY);
              ctx.stroke();
              break;
            }

            case 'cross': {
              const size = (cellSize / 2.5) * normLum;
              ctx.strokeStyle = activeConfig.tint || '#bfe70a';
              ctx.lineWidth = 1.2;
              ctx.globalAlpha = alpha;
              ctx.beginPath();
              ctx.moveTo(centerX - size, centerY);
              ctx.lineTo(centerX + size, centerY);
              ctx.moveTo(centerX, centerY - size);
              ctx.lineTo(centerX, centerY + size);
              ctx.stroke();
              break;
            }

            case 'diamond': {
              const dSize = (cellSize / 2.2) * normLum;
              ctx.fillStyle = activeConfig.tint || '#ffffff';
              ctx.globalAlpha = alpha;
              ctx.beginPath();
              ctx.moveTo(centerX, centerY - dSize);
              ctx.lineTo(centerX + dSize, centerY);
              ctx.lineTo(centerX, centerY + dSize);
              ctx.lineTo(centerX - dSize, centerY);
              ctx.closePath();
              ctx.fill();
              break;
            }

            case 'pixel':
            case 'mosaic':
            default: {
              const pSize = cellSize * Math.max(0.2, normLum);
              ctx.fillStyle = normLum > 0.6 ? '#ffffff' : (activeConfig.tint || '#bfe70a');
              ctx.globalAlpha = alpha;
              ctx.fillRect(centerX - pSize / 2, centerY - pSize / 2, pSize, pSize);
              break;
            }
          }
        }
      }

      ctx.restore();

      // Step 5: Post-effects (scanLines, vignette, bloom, filmGrain)
      const pfx = activeConfig.pfx;
      if (pfx.scanLines.enabled) {
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${pfx.scanLines.intensity / 100})`;
        for (let y = 0; y < height; y += 3) {
          ctx.fillRect(0, y, width, 1);
        }
        ctx.restore();
      }

      if (pfx.vignette.enabled) {
        ctx.save();
        const radGrad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.25,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.75
        );
        radGrad.addColorStop(0, 'transparent');
        radGrad.addColorStop(1, `rgba(0,0,0,${pfx.vignette.intensity / 100})`);
        ctx.fillStyle = radGrad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      if (pfx.filmGrain.enabled) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 255, 255, ${(pfx.filmGrain.intensity / 100) * 0.08})`;
        for (let i = 0; i < 400; i++) {
          const rx = Math.random() * width;
          const ry = Math.random() * height;
          ctx.fillRect(rx, ry, 1.5, 1.5);
        }
        ctx.restore();
      }

      // Step 6: Lights
      if (activeConfig.lights.enabled && activeConfig.lights.points.length > 0) {
        ctx.save();
        activeConfig.lights.points.forEach((pt) => {
          const lx = pt.x * width;
          const ly = pt.y * height;
          const lGrad = ctx.createRadialGradient(lx, ly, 2, lx, ly, pt.radius);
          lGrad.addColorStop(0, `rgba(191, 231, 10, ${pt.intensity / 100})`);
          lGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = lGrad;
          ctx.beginPath();
          ctx.arc(lx, ly, pt.radius, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [activeConfig, isReducedMotion, isHovering, mousePos, drawProceduralGarden, imageLoaded]);

  // Pointer interactions
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setMousePos({ x, y });
  };

  const setMode = (mode: AsciiGardenConfig['renderMode']) => {
    setActiveConfig((prev) => ({ ...prev, renderMode: mode }));
    onModeChange?.(mode);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="EnVault Management Ink Garden ASCII and Dither raster effect visualization"
        className="block w-full h-full"
      />

      {interactive && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-950/80 backdrop-blur-md border border-white/10 shadow-lg text-[11px] font-mono text-zinc-400">
          <span className="flex items-center gap-1.5 px-2 text-zinc-500 font-sans border-r border-white/10">
            <span className="size-1.5 rounded-full bg-[#bfe70a] animate-pulse" />
            21st.dev Engine
          </span>

          {(['dither', 'characters', 'matrix', 'braille', 'dots', 'hexdump'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer capitalize ${
                activeConfig.renderMode === m
                  ? 'bg-[#bfe70a]/20 text-[#bfe70a] font-semibold border border-[#bfe70a]/40 shadow-sm'
                  : 'hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {m}
            </button>
          ))}

          <span className="hidden sm:inline-block px-2 text-[10px] text-zinc-500 border-l border-white/10">
            {fps} FPS · Cell: {activeConfig.cellSize}px
          </span>
        </div>
      )}
    </div>
  );
};
