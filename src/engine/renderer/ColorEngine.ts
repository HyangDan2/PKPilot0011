import { normalizeSharpening, type SharpeningSettings } from '../../types/sharpening';
import { buildRGBBaseMatrix, hasRGBBaseEdits } from '../color/rgbBase';
import {
  MIXER_COLORS,
  normalizeColorMixer,
  hasColorMixerEdits,
  type ColorMixerSettings,
} from '../../types/colorMixer';
import type { ToneCurves } from '../../types/curves';
import { buildCurveTexture, CURVE_SAMPLES } from '../color/userCurves';
import { getEffectiveCamera } from '../../films/cameraEffects';
import type { AdjustmentSettings } from '../../types/film';
import type { CameraSettings } from '../../types/camera';
import { createDateStamp } from '../overlay/dateStamp';
import { VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE } from './shaders';
import type { ParsedLut3D } from '../color/lutLoader';

export interface GradeOptions {
  adjustments: AdjustmentSettings;
  filmId?: string;
  camera?: CameraSettings;
  curves?: ToneCurves;
  colorMixer?: ColorMixerSettings;
  sharpening?: SharpeningSettings;
  /** Seconds into the clip; seeds the animated grain. Photos pass 0. */
  time?: number;
  /** 0 = assume full-range sRGB, 1 = expand 16–235 (HDR/HLG safety guard). */
  inputGuard?: 0 | 1;
  compareMode?: 'none' | 'original' | 'split';
  splitPos?: number;
  seed?: number;
}

/**
 * WebGL2 film grading on a canvas. One instance per canvas; the same engine
 * grades a still, the current frame of a playing clip, and every export frame.
 */
export class ColorEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private imageTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private stampTexture: WebGLTexture | null = null;
  private stampKey = '';
  private stampRect: [number, number, number, number] = [0, 0, 1, 1];
  private curveTexture: WebGLTexture | null = null;
  private curveKey = '';
  private curvesEnabled = false;
  private detailTexture: WebGLTexture | null = null;
  private detailFbo: WebGLFramebuffer | null = null;
  private detailSize = '';
  private currentLutSize = 33;
  private sourceWidth = 1;
  private sourceHeight = 1;
  private isContextLost = false;
  private isInitialized = false;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initContext();
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.isContextLost = true;
      this.isInitialized = false;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.detailTexture = null;
      this.detailFbo = null;
      this.detailSize = '';
      this.imageTexture = null;
      this.lutTexture = null;
      this.stampTexture = null;
      this.stampKey = '';
      this.curveTexture = null;
      this.curveKey = '';
      this.initContext();
    });
  }

  isReady(): boolean {
    return this.isInitialized && !this.isContextLost && this.gl !== null && this.program !== null;
  }

  getContext(): WebGL2RenderingContext | null {
    return this.gl;
  }

  private initContext(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      this.isInitialized = false;
      return false;
    }
    this.gl = gl;
    this.isContextLost = false;
    this.initPipeline();
    return this.isInitialized;
  }

  private initPipeline(): void {
    const gl = this.gl;
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program linking failed:', gl.getProgramInfoLog(program));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      return;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;

    const uniformNames = [
      'u_graded', 'u_detail_stage', 'u_detail', 'u_source_size', 'u_detail_mask', 'u_detail_fast',
      'u_image', 'u_lut', 'u_lut_size', 'u_resolution',
      'u_exposure', 'u_temperature', 'u_tint', 'u_highlights', 'u_shadows', 'u_contrast',
      'u_saturation', 'u_grain', 'u_sharpness', 'u_vignette', 'u_film_strength',
      'u_compare_mode', 'u_split_pos',
      'u_rgb_base_enabled', 'u_rgb_base_matrix', 'u_shadows_tint', 'u_mixer_enabled',
      'u_mixer_reference', 'u_mix_bands[0]', 'u_point_count', 'u_point_color[0]',
      'u_point_range[0]', 'u_point_shift[0]', 'u_mixer_visualize',
      'u_curves', 'u_curves_enabled', 'u_endpoints', 'u_seed', 'u_time', 'u_input_guard',
      'u_stamp', 'u_stamp_enabled', 'u_stamp_rect', 'u_optics', 'u_optical_samples',
    ];
    for (const name of uniformNames) this.uniforms[name] = gl.getUniformLocation(program, name);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 1.0,
       1.0, -1.0, 1.0, 1.0,
      -1.0,  1.0, 0.0, 0.0,
      -1.0,  1.0, 0.0, 0.0,
       1.0, -1.0, 1.0, 1.0,
       1.0,  1.0, 1.0, 0.0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const uvLoc = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    this.isInitialized = true;
  }

  /** Upload a still, a canvas, or the current frame of a video element. */
  setSource(source: TexImageSource, width?: number, height?: number): void {
    const gl = this.gl;
    if (!gl || this.isContextLost) return;
    if (!this.imageTexture) this.imageTexture = gl.createTexture();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const domLike = (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
      || (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement)
      || (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement)
      || (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
      || (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);

    try {
      if (domLike) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        const w = width ?? this.canvas.width;
        const h = height ?? this.canvas.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source as unknown as ArrayBufferView);
      }
    } catch (error) {
      // A video element whose decoder has not produced a frame yet throws; the
      // caller simply keeps the previous texture on screen.
      if (import.meta.env?.DEV) console.warn('Frame upload skipped:', error);
      return;
    }

    const dom = source as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    this.sourceWidth = dom.videoWidth || dom.naturalWidth || dom.width || width || this.canvas.width;
    this.sourceHeight = dom.videoHeight || dom.naturalHeight || dom.height || height || this.canvas.height;
  }

  setLut(lut: ParsedLut3D): void {
    const gl = this.gl;
    if (!gl || this.isContextLost) return;
    if (!this.lutTexture) this.lutTexture = gl.createTexture();
    this.currentLutSize = lut.size;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.rgbaData);
  }

  render(options: GradeOptions): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || this.isContextLost || !this.isInitialized) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    if (this.uniforms.u_image) gl.uniform1i(this.uniforms.u_image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    if (this.uniforms.u_lut) gl.uniform1i(this.uniforms.u_lut, 1);

    const camera = getEffectiveCamera(options.filmId as never, options.camera);
    const stamp = camera.dateStamp;
    const stampKey = JSON.stringify([this.canvas.width, this.canvas.height, stamp]);
    gl.activeTexture(gl.TEXTURE2);
    if (!this.stampTexture) {
      this.stampTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.stampTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stampTexture);
    if (this.stampKey !== stampKey) {
      const patch = createDateStamp(this.canvas.width, this.canvas.height, stamp);
      if (patch) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, patch.canvas);
        this.stampRect = [patch.layout.x, patch.layout.y, patch.layout.width, patch.layout.height];
      }
      this.stampKey = stampKey;
    }
    if (this.uniforms.u_stamp) gl.uniform1i(this.uniforms.u_stamp, 2);
    if (this.uniforms.u_stamp_enabled) gl.uniform1i(this.uniforms.u_stamp_enabled, stamp.enabled && !!stamp.date ? 1 : 0);
    if (this.uniforms.u_stamp_rect) gl.uniform4fv(this.uniforms.u_stamp_rect, this.stampRect);
    if (this.uniforms.u_optics) gl.uniform3f(this.uniforms.u_optics, camera.optics.glow / 100, camera.optics.halation / 100, camera.optics.softness / 100);
    if (this.uniforms.u_optical_samples) gl.uniform1i(this.uniforms.u_optical_samples, camera.optics.quality === 'high' ? 8 : 4);

    gl.activeTexture(gl.TEXTURE3);
    if (!this.curveTexture) {
      this.curveTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    const curveKey = JSON.stringify(options.curves || null);
    if (curveKey !== this.curveKey) {
      const texture = buildCurveTexture(options.curves);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_SAMPLES, 1, 0, gl.RGBA, gl.FLOAT, texture.data);
      this.curvesEnabled = texture.enabled;
      this.curveKey = curveKey;
    }
    if (this.uniforms.u_curves) gl.uniform1i(this.uniforms.u_curves, 3);
    if (this.uniforms.u_curves_enabled) gl.uniform1i(this.uniforms.u_curves_enabled, this.curvesEnabled ? 1 : 0);
    if (this.uniforms.u_endpoints) gl.uniform2f(this.uniforms.u_endpoints, (options.adjustments.blacks || 0) / 100, (options.adjustments.whites || 0) / 100);

    const mixer = normalizeColorMixer(options.colorMixer);
    if (this.uniforms.u_rgb_base_enabled) gl.uniform1i(this.uniforms.u_rgb_base_enabled, mixer.enabled && hasRGBBaseEdits(mixer.rgbBase) ? 1 : 0);
    if (this.uniforms.u_rgb_base_matrix) gl.uniformMatrix3fv(this.uniforms.u_rgb_base_matrix, false, buildRGBBaseMatrix(mixer.rgbBase));
    if (this.uniforms.u_shadows_tint) gl.uniform1f(this.uniforms.u_shadows_tint, mixer.rgbBase.shadowsTint / 100);
    if (this.uniforms.u_mixer_enabled) gl.uniform1i(this.uniforms.u_mixer_enabled, hasColorMixerEdits(mixer) ? 1 : 0);
    if (this.uniforms.u_mixer_reference) gl.uniform1i(this.uniforms.u_mixer_reference, 0);
    if (this.uniforms['u_mix_bands[0]']) {
      gl.uniform3fv(this.uniforms['u_mix_bands[0]'], MIXER_COLORS.flatMap((c) => [
        mixer.bands[c].hue / 1200, mixer.bands[c].saturation / 100, mixer.bands[c].luminance / 100,
      ]));
    }
    if (this.uniforms.u_point_count) gl.uniform1i(this.uniforms.u_point_count, mixer.points.length);
    const colors = new Float32Array(24);
    const ranges = new Float32Array(32);
    const shifts = new Float32Array(32);
    mixer.points.forEach((point, i) => {
      colors.set(point.color, i * 3);
      ranges.set([point.range.hue / 360, point.range.saturation / 100, point.range.luminance / 100, point.feather / 100], i * 4);
      shifts.set([point.shift.hue / 200, point.shift.saturation / 100, point.shift.luminance / 100,
        point.enabled && (point.shift.hue !== 0 || point.shift.saturation !== 0 || point.shift.luminance !== 0) ? 1 : 0], i * 4);
    });
    if (this.uniforms['u_point_color[0]']) gl.uniform3fv(this.uniforms['u_point_color[0]'], colors);
    if (this.uniforms['u_point_range[0]']) gl.uniform4fv(this.uniforms['u_point_range[0]'], ranges);
    if (this.uniforms['u_point_shift[0]']) gl.uniform4fv(this.uniforms['u_point_shift[0]'], shifts);
    if (this.uniforms.u_mixer_visualize) gl.uniform1i(this.uniforms.u_mixer_visualize, -1);

    if (this.uniforms.u_lut_size) gl.uniform1f(this.uniforms.u_lut_size, this.currentLutSize);
    if (this.uniforms.u_resolution) gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);

    const adj = options.adjustments;
    if (this.uniforms.u_exposure) gl.uniform1f(this.uniforms.u_exposure, adj.exposure);
    if (this.uniforms.u_temperature) gl.uniform1f(this.uniforms.u_temperature, adj.temperature / 100.0);
    if (this.uniforms.u_tint) gl.uniform1f(this.uniforms.u_tint, adj.tint / 100.0);
    if (this.uniforms.u_highlights) gl.uniform1f(this.uniforms.u_highlights, adj.highlights / 100.0);
    if (this.uniforms.u_shadows) gl.uniform1f(this.uniforms.u_shadows, adj.shadows / 100.0);
    if (this.uniforms.u_contrast) gl.uniform1f(this.uniforms.u_contrast, adj.contrast / 100.0);
    if (this.uniforms.u_saturation) gl.uniform1f(this.uniforms.u_saturation, adj.saturation / 100.0);
    if (this.uniforms.u_grain) gl.uniform1f(this.uniforms.u_grain, adj.grain / 100.0);
    if (this.uniforms.u_vignette) gl.uniform1f(this.uniforms.u_vignette, adj.vignette / 100.0);
    if (this.uniforms.u_film_strength) gl.uniform1f(this.uniforms.u_film_strength, adj.filmStrength / 100.0);

    const compare = options.compareMode === 'original' ? 1 : options.compareMode === 'split' ? 2 : 0;
    if (this.uniforms.u_compare_mode) gl.uniform1i(this.uniforms.u_compare_mode, compare);
    if (this.uniforms.u_split_pos) gl.uniform1f(this.uniforms.u_split_pos, options.splitPos ?? 0.5);
    if (this.uniforms.u_seed) gl.uniform1f(this.uniforms.u_seed, options.seed ?? 42.0);
    if (this.uniforms.u_time) gl.uniform1f(this.uniforms.u_time, options.time ?? 0);
    if (this.uniforms.u_input_guard) gl.uniform1i(this.uniforms.u_input_guard, options.inputGuard ?? 0);

    const sharpening = normalizeSharpening(options.sharpening, adj.sharpness);
    if (this.uniforms.u_sharpness) gl.uniform1f(this.uniforms.u_sharpness, sharpening.mode === 'legacy' ? sharpening.amount / 100 : 0);
    const detailed = sharpening.mode === 'advanced' && sharpening.amount > 0 && compare !== 1;
    if (this.uniforms.u_detail_fast) gl.uniform1i(this.uniforms.u_detail_fast, 1);
    if (this.uniforms.u_detail_stage) gl.uniform1i(this.uniforms.u_detail_stage, 0);
    if (this.uniforms.u_detail_mask) gl.uniform1i(this.uniforms.u_detail_mask, 0);
    if (this.uniforms.u_detail) gl.uniform4f(this.uniforms.u_detail, sharpening.amount / 100, sharpening.radius, sharpening.detail / 100, sharpening.masking / 100);
    if (this.uniforms.u_source_size) gl.uniform2f(this.uniforms.u_source_size, this.sourceWidth, this.sourceHeight);
    if (detailed) {
      try {
        this.ensureDetailTarget();
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (this.uniforms.u_graded) gl.uniform1i(this.uniforms.u_graded, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.detailFbo);
        if (this.uniforms.u_detail_stage) gl.uniform1i(this.uniforms.u_detail_stage, 1);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.detailTexture);
        if (this.uniforms.u_graded) gl.uniform1i(this.uniforms.u_graded, 4);
        if (this.uniforms.u_detail_stage) gl.uniform1i(this.uniforms.u_detail_stage, 2);
      } catch {
        if (this.uniforms.u_detail_stage) gl.uniform1i(this.uniforms.u_detail_stage, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private ensureDetailTarget(): void {
    const gl = this.gl;
    if (!gl) throw new Error('No WebGL2 context');
    const key = `${this.canvas.width}x${this.canvas.height}`;
    if (this.detailTexture && this.detailSize === key) return;
    if (this.detailTexture) gl.deleteTexture(this.detailTexture);
    if (this.detailFbo) gl.deleteFramebuffer(this.detailFbo);
    this.detailTexture = gl.createTexture();
    this.detailFbo = gl.createFramebuffer();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.detailTexture);
    const floating = !!gl.getExtension('EXT_color_buffer_float');
    gl.texImage2D(gl.TEXTURE_2D, 0, floating ? gl.RGBA16F : gl.RGBA8, this.canvas.width, this.canvas.height, 0, gl.RGBA, floating ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.detailFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.detailTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.detailSize = '';
      throw new Error('Sharpening buffer could not be allocated');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.detailSize = key;
  }

  readPixels(x: number, y: number, w: number, h: number): Uint8Array | null {
    const gl = this.gl;
    if (!gl || this.isContextLost) return null;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  destroy(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.detailTexture) gl.deleteTexture(this.detailTexture);
    if (this.detailFbo) gl.deleteFramebuffer(this.detailFbo);
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    if (this.lutTexture) gl.deleteTexture(this.lutTexture);
    if (this.stampTexture) gl.deleteTexture(this.stampTexture);
    if (this.curveTexture) gl.deleteTexture(this.curveTexture);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.isInitialized = false;
    this.gl = null;
  }
}
