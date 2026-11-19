import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCubeLut } from '../src/engine/color/lutLoader';
import { buildCurveTexture, CURVE_SAMPLES } from '../src/engine/color/userCurves';
import { defaultCurves } from '../src/types/curves';
import { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE } from '../src/engine/renderer/shaders';
import { sampleLut3DTrilinear } from '../src/engine/color/lutInterpolation';

const root = resolve(__dirname, '..');
const readLut = (file: string) => parseCubeLut(readFileSync(resolve(root, 'public/luts', file), 'utf8'));

describe('3D LUT data', () => {
  it('parses a 33³ lattice out of a real .cube file', () => {
    const lut = readLut('identity.cube');
    expect(lut.size).toBe(33);
    expect(lut.rgbaData).toHaveLength(33 * 33 * 33 * 4);
    expect(lut.floatData).toHaveLength(33 * 33 * 33 * 3);
  });

  it('is identity at the black and white corners', () => {
    const lut = readLut('identity.cube');
    const black = sampleLut3DTrilinear(lut, 0, 0, 0);
    const white = sampleLut3DTrilinear(lut, 1, 1, 1);
    black.forEach((channel) => expect(channel).toBeCloseTo(0, 2));
    white.forEach((channel) => expect(channel).toBeCloseTo(1, 2));
  });

  it('loads every shipped film LUT with the same lattice size', () => {
    for (const file of [
      'FS-001_VAERN.cube', 'FS-002_SKELD.cube', 'FS-003_AURVEN.cube', 'FS-004_VESTRA.cube',
      'FS-005_VEYRA.cube', 'FS-006_SOLVIK.cube', 'FS-007_LYSEN.cube', 'FS-008_MYRVEL.cube',
      'FS-009_RIMVA.cube', 'FS-010_RETRO90.cube',
    ]) {
      expect(readLut(file).size).toBe(33);
    }
  });
});

describe('tone curve texture', () => {
  it('is disabled for the identity curves', () => {
    const texture = buildCurveTexture(defaultCurves());
    expect(texture.enabled).toBe(false);
    expect(texture.data).toHaveLength(CURVE_SAMPLES * 4);
  });

  it('enables the shader path when a point moves', () => {
    const curves = defaultCurves();
    curves.white = [[0, 0], [0.45, 0.62], [1, 1]];
    const texture = buildCurveTexture(curves);
    expect(texture.enabled).toBe(true);
    // Sample near the moved point: the white channel must sit above identity.
    const index = Math.round(0.45 * (CURVE_SAMPLES - 1)) * 4;
    expect(texture.data[index]).toBeGreaterThan(0.55);
  });
});

describe('motion shader contract', () => {
  it('seeds grain from time so clips never show frozen dust', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform float u_time');
    expect(FRAGMENT_SHADER_SOURCE).toContain('grainFrame = floor(u_time * 24.0)');
    expect(FRAGMENT_SHADER_SOURCE).toContain('u_seed + grainFrame');
  });

  it('guards HDR/HLG input into a Rec.709 sRGB pipeline', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform int u_input_guard');
    expect(FRAGMENT_SHADER_SOURCE).toContain('guardInput');
    expect(FRAGMENT_SHADER_SOURCE).toContain('0.0627451');
    expect(FRAGMENT_SHADER_SOURCE).toContain('0.8745098');
    expect(FRAGMENT_SHADER_SOURCE).toContain('srgbToLinear');
  });

  it('runs every source through the guard before grading', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('vec3 srgb = guardInput(rawColor.rgb)');
    expect(FRAGMENT_SHADER_SOURCE).toContain('grade(srgb)');
    expect(VERTEX_SHADER_SOURCE).toContain('v_uv');
  });

  it('keeps the two-pass sharpening and stamp stages wired', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('u_detail_stage');
    expect(FRAGMENT_SHADER_SOURCE).toContain('u_stamp_enabled');
    expect(FRAGMENT_SHADER_SOURCE).toContain('mixColors');
    expect(FRAGMENT_SHADER_SOURCE).toContain('applyRGBBase');
  });
});
