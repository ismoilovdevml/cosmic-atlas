/**
 * Final pass (TSL, RenderPipeline): HDR point light -> display, plus the all-sky image.
 *
 * Colour pipeline (all linear light until the last step):
 *   points / blobs / Milky Way model: sRGB bytes decoded to linear in their shaders, summed
 *   additively in the scene pass's half-float target;
 *   tone map: asinh stretch on luminance (Lupton et al. 1999, AJ 118, 1406), hue-preserving;
 *   sky image: an sRGB JPEG, decoded to linear by the texture (SRGBColorSpace);
 *   output: explicit IEC 61966-2-1 linear → sRGB encode, then ±0.5 LSB dither.
 * The canvas is a non-sRGB 8-bit format on both backends and outputColorTransform is off, so this
 * encode is the only one (checked by reading back the void colour, see README).
 *
 * The Gaia all-sky image is drawn in the same pass as an infinitely distant sphere centred on
 * the camera: each fragment's view direction (contract frame: +x -> l=0, +z -> NGP) -> Galactic
 * (l, b) -> Hammer-Aitoff uv of the source image (l = 0 at centre, l increasing to the LEFT,
 * b = +90 at top; pixel-centre convention of the producing script). The mip level comes from the
 * angular pixel footprint rather than uv derivatives, so the l = ±180 seam does not show.
 * hammerUV() in math/frames.ts is the CPU twin of this mapping and is unit-tested.
 *
 * Sky background chooser (src/messengers/backgrounds.ts): a second texture in the same projection
 * (eROSITA, Planck 857 GHz) replaces the Gaia image while it is set.
 *
 * CMB shell (src/messengers/cmb.ts): the last scattering surface as a sphere of radius R around
 * the Sun, ray-traced here per pixel (camera position / R, so float32 stays exact). The far wall
 * (the inner surface, i.e. the sky as seen from inside) is drawn in full; seen from outside, the
 * near wall is drawn faint with a limb glow, so the cosmic web inside stays visible. It is added
 * to the background term, under all scene light, so it is always behind everything. The texture
 * is equirectangular Galactic: u = 0.5 - l / 2pi, v = 0.5 + b / pi (scripts/build_cmb.py);
 * cmbUV() in src/messengers/cmb.ts is its CPU twin (unit-tested).
 */

import * as THREE from 'three/webgpu';
import {
  Fn, asinh, atan, clamp, cos, dot, float, fract, fwidth, length, log2, max, mrt, normalize, output, pass,
  positionView, pow, screenCoordinate, screenUV, select, sin, sqrt, texture, uniform, vec2, vec3, vec4, asin, mix,
  smoothstep,
} from 'three/tsl';
import { srgbToLinear } from './brightness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const linearToSrgbNode = (x: any): any =>
  select(x.lessThanEqual(0.0031308), x.mul(12.92), pow(max(x, 0.0), 1.0 / 2.4).mul(1.055).sub(0.055));

/** the page's void colour, sRGB bytes (also the CSS --void) */
export const VOID_SRGB: [number, number, number] = [4, 6, 11];

const SQRT2 = Math.SQRT2;

/** one frame of the CMB shell (src/messengers/cmb.ts) */
export interface CmbFrame {
  radiusPc: number;
  camPos: readonly number[];
  amount: number;
  gain: number;
}

/** a lens: scene HDR texture + sky sampler -> HDR light and linear sky along bent rays (src/blackhole/lens.ts) */
export type LensFn = (ctx: { hdrTex: any; skyAt: (d: any, lod: any) => any; skyWidth: any }) => { hdr: any; sky: any };
/**
 * 3D dust (src/dust): per-pixel factors on the points' light and the sky, plus added light. Called
 * inside the pipeline's Fn; `ld` = (Σ I·log2 depth, Σ I) of the scene's additive light.
 */
export type DustFn = (ctx: { dirAt: () => any; fwd: any; ldAt: (uv: any) => any }) => { pts: any; sky: any; glow: any };

export class PostPass {
  readonly pipeline: THREE.RenderPipeline;
  private readonly uSkyOn = uniform(0);
  private readonly uSkyGain = uniform(0.5);
  private readonly uSkySize = uniform(new THREE.Vector2(4000, 2000));
  private readonly uCamRot = uniform(new THREE.Matrix3());
  private readonly uTanHalf = uniform(new THREE.Vector2(1, 1));
  readonly uQ = uniform(6);
  private lensPipeline: THREE.RenderPipeline | null = null;
  private makeLensOutput!: (lens: LensFn) => any;
  private dustPipeline: THREE.RenderPipeline | null = null;
  private makeDustOutput!: (dust: DustFn) => any;
  private readonly skyNode;
  private hasSky = false;
  // --- sky background chooser: override texture (same projection), its size and gain
  private readonly skyAltNode;
  private readonly uSkyAlt = uniform(0);
  private readonly uSkyAltSize = uniform(new THREE.Vector2(4000, 2000));
  private readonly uSkyAltGain = uniform(0.5);
  // --- CMB shell: camera position / R, texels per radian, amount, linear gain
  private readonly cmbNode;
  private readonly uCmbOn = uniform(0);
  private readonly uCmbCam = uniform(new THREE.Vector3());
  private readonly uCmbPxRad = uniform(1);
  private readonly uCmbGain = uniform(0.3);
  private hasCmb = false;

  constructor(private readonly renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const scenePass = pass(scene, camera);
    const hdrTex = scenePass.getTextureNode('output');
    // only opaque Solar System bodies write depth; the sky must not show through them
    const sceneDepth = scenePass.getTextureNode('depth');
    // The placeholder must carry the sky's filtering: on the WebGPU backend the swapped-in texture
    // kept the placeholder's sampler, so with DataTexture's default NearestFilter the sky was
    // point-sampled on WebGPU only (WebGL2 takes the filters from the new texture). Measured with
    // level(0) sampling: mean |WebGPU − WebGL2| 8.5/255 before, 0.03/255 after.
    // One placeholder per texture node: nodes created from the same texture object ended up
    // sharing one binding on WebGPU (the CMB shell sampled the Gaia image), and the CMB's needs
    // RepeatWrapping across the l = ±180° seam for the same sampler reason.
    const placeholder = (wrapS: THREE.Wrapping = THREE.ClampToEdgeWrapping) => {
      const p = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      p.minFilter = THREE.LinearMipmapLinearFilter;
      p.magFilter = THREE.LinearFilter;
      p.wrapS = wrapS;
      p.generateMipmaps = true;
      p.needsUpdate = true;
      return p;
    };
    this.skyNode = texture(placeholder());
    this.skyAltNode = texture(placeholder());
    this.cmbNode = texture(placeholder(THREE.RepeatWrapping));

    // linear Gaia sky for a world direction at an explicit mip level (also used along bent rays)
    const skyAt = (d: any, lod: any) => {
      const l = atan(d.y, d.x);
      const b = asin(clamp(d.z, -1.0, 1.0));
      const den = sqrt(float(1.0).add(cos(b).mul(cos(l.mul(0.5)))));
      const x = float(2.0 * SQRT2).mul(cos(b)).mul(sin(l.mul(0.5))).div(den);
      const y = float(SQRT2).mul(sin(b)).div(den);
      const col = float(2.0 * SQRT2).sub(x).div(4.0 * SQRT2).mul(this.uSkySize.x.sub(1.0));
      const row = float(SQRT2).sub(y).div(2.0 * SQRT2).mul(this.uSkySize.y.sub(1.0));
      const uvSky = vec2(col.add(0.5).div(this.uSkySize.x), float(1.0).sub(row.add(0.5).div(this.uSkySize.y)));
      const skyRaw = this.skyNode.sample(uvSky).level(lod).rgb;
      // background chooser: the same Hammer-Aitoff mapping on the override image's own grid
      const colA = float(2.0 * SQRT2).sub(x).div(4.0 * SQRT2).mul(this.uSkyAltSize.x.sub(1.0));
      const rowA = float(SQRT2).sub(y).div(2.0 * SQRT2).mul(this.uSkyAltSize.y.sub(1.0));
      const uvAlt = vec2(colA.add(0.5).div(this.uSkyAltSize.x), float(1.0).sub(rowA.add(0.5).div(this.uSkyAltSize.y)));
      const altRaw = this.skyAltNode.sample(uvAlt).level(lod).rgb;
      // (linear) the image's floor is a faint grey haze; pull it toward black so the sky stays calm
      const gaia = max(skyRaw.sub(0.003), 0.0).mul(this.uSkyGain);
      const alt = max(altRaw.sub(0.002), 0.0).mul(this.uSkyAltGain);
      return mix(gaia, alt, this.uSkyAlt).mul(this.uSkyOn);
    };
    // HDR scene light + linear sky -> display (tone map, encode, dither)
    const compose = (hdr: any, sky: any) => {
      const L = max(max(hdr.r, hdr.g), hdr.b);
      const q = this.uQ;
      const f = select(L.greaterThan(1e-6), asinh(q.mul(L)).div(asinh(q).mul(L)), q.div(asinh(q)));
      const c0 = hdr.mul(f);
      const mx = max(max(c0.r, c0.g), c0.b);
      const c = c0.div(max(mx, 1.0));
      const voidLin = vec3(...VOID_SRGB.map((v) => srgbToLinear(v / 255)) as [number, number, number]);
      const lin = voidLin.add(sky).add(c.mul(float(1.0).sub(sky.mul(0.5))));
      const enc = vec3(linearToSrgbNode(lin.x), linearToSrgbNode(lin.y), linearToSrgbNode(lin.z));
      const dither = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).div(255.0);
      return vec4(enc.add(dither), 1.0);
    };
    this.makeLensOutput = (lens) => Fn(() => {
      const r = lens({ hdrTex, skyAt, skyWidth: this.uSkySize.x });
      return compose(r.hdr, r.sky);
    })();

    const view = () => {
      // sky: view direction -> (l, b) -> Hammer-Aitoff uv
      const ndc = vec2(screenUV.x.mul(2.0).sub(1.0), float(1.0).sub(screenUV.y.mul(2.0)));
      const d = normalize(this.uCamRot.mul(vec3(ndc.mul(this.uTanHalf), -1.0)));
      const ang = length(fwidth(d));
      const lod = log2(max(ang.mul(this.uSkySize.x).mul(0.25), 1.0));
      const clearDepth = select(sceneDepth.x.greaterThanEqual(0.9999999), float(1.0), float(0.0));
      return { d, lod, clearDepth, ang };
    };
    const out = Fn(() => {
      const { d, lod, clearDepth, ang } = view();
      return compose(hdrTex.rgb, skyAt(d, lod).add(this.cmbAt(d, ang)).mul(clearDepth));
    })();
    // --- Dust hook: its own scene pass with a second, single-channel half-float target "ldepth"
    // holding Σ w·log2(view depth in pc), w = luminance × alpha of each fragment's light, blended
    // like the material (additive for the points). The scene light is summed as Σ rgb·alpha, so
    // Σ w = luminance of the HDR output, and Σ w·log2 d / Σ w is the pixel's light-weighted mean
    // log2 depth. A separate pass, so views without dust do not pay for the extra target
    // (measured: an RGBA16F second target cost 2.4 ms at 300 pc with 3.4 M points).
    const LUMA = vec3(0.2126, 0.7152, 0.0722);
    this.makeDustOutput = (dust) => {
      const dustPass = pass(scene, camera);
      const w = dot(output.rgb, LUMA).mul(output.a);
      const m = mrt({ output, ldepth: vec4(w.mul(log2(max(positionView.z.negate(), 1e-12))), 0.0, 0.0, 1.0) });
      // plain sum (One, One): a single-channel target has no alpha for SrcAlpha factors; w already
      // carries the fragment's alpha
      const sum = new THREE.BlendMode(THREE.CustomBlending);
      sum.blendSrc = sum.blendSrcAlpha = THREE.OneFactor;
      sum.blendDst = sum.blendDstAlpha = THREE.OneFactor;
      sum.blendEquation = sum.blendEquationAlpha = THREE.AddEquation;
      m.setBlendMode('ldepth', sum);
      dustPass.setMRT(m);
      dustPass.getTexture('ldepth').format = THREE.RedFormat;
      const dHdr = dustPass.getTextureNode('output');
      const dDepth = dustPass.getTextureNode('depth');
      const ldTex = dustPass.getTextureNode('ldepth');
      return Fn(() => {
        const { d, lod } = view();
        const clearDepth = select(dDepth.x.greaterThanEqual(0.9999999), float(1.0), float(0.0));
        const fwd = normalize(this.uCamRot.mul(vec3(0.0, 0.0, -1.0)));
        // per-stage helpers: screenUV is the RTT's own in the dust trace stage
        const dirAt = () => normalize(this.uCamRot.mul(vec3(vec2(screenUV.x.mul(2.0).sub(1.0), float(1.0).sub(screenUV.y.mul(2.0))).mul(this.uTanHalf), -1.0)));
        const ldAt = (uv: any) => vec2(ldTex.sample(uv).r, dot(dHdr.sample(uv).rgb, LUMA));
        const r = dust({ dirAt, fwd, ldAt });
        return compose(dHdr.rgb.mul(r.pts).add(r.glow), skyAt(d, lod).mul(clearDepth).mul(r.sky));
      })();
    };

    this.pipeline = new THREE.RenderPipeline(renderer, out);
    this.pipeline.outputColorTransform = false;
  }

  /** linear CMB colour along the view ray d (world = Galactic axes) from the camera; 0 off the shell */
  private cmbAt(d: any, ang: any): any {
    const o = this.uCmbCam; // camera position / R
    const b = dot(o, d);
    const c = dot(o, o).sub(1.0);
    const disc = b.mul(b).sub(c);
    const hit = disc.greaterThan(0.0);
    const sq = sqrt(max(disc, 0.0));
    const tFar = sq.sub(b);
    const tNear = b.negate().sub(sq);
    const sample = (t: any) => {
      const p = normalize(o.add(d.mul(t)));
      const l = atan(p.y, p.x);
      const bb = asin(clamp(p.z, -1.0, 1.0));
      const uv = vec2(float(0.5).sub(l.div(2.0 * Math.PI)), float(0.5).add(bb.div(Math.PI)));
      // mip from the shell area under one pixel (angle x distance / R, in texels per radian)
      const lod = log2(max(ang.mul(t).mul(this.uCmbPxRad), 1.0));
      return this.cmbNode.sample(uv).level(lod).rgb;
    };
    const far = select(hit.and(tFar.greaterThan(0.0)), sample(tFar), vec3(0.0));
    // outside the shell: the near wall, faint, plus a limb glow where the rays graze it
    const outside = c.greaterThan(0.0).and(hit).and(tNear.greaterThan(0.0));
    const cosI = clamp(sq, 0.0, 1.0); // |d . n| at the near wall of a unit sphere
    const nearW = float(0.2).add(smoothstep(0.35, 0.0, cosI).mul(0.6));
    const near = sample(max(tNear, 0.0));
    const col = select(outside, mix(far.mul(0.8), near, nearW), far);
    return col.mul(this.uCmbGain).mul(this.uCmbOn);
  }

  /**
   * Black hole lens hook (src/blackhole): a second pipeline whose scene light and sky come from a
   * lens function (rays bent around the hole). Built once; render(..., true) uses it.
   */
  enableLens(lens: LensFn) {
    if (this.lensPipeline) return;
    this.lensPipeline = new THREE.RenderPipeline(this.renderer, this.makeLensOutput(lens));
    this.lensPipeline.outputColorTransform = false;
  }

  /** Dust hook (src/dust): a third pipeline with its own scene pass (see the constructor) */
  enableDust(dust: DustFn) {
    if (this.dustPipeline) return;
    this.dustPipeline = new THREE.RenderPipeline(this.renderer, this.makeDustOutput(dust));
    this.dustPipeline.outputColorTransform = false;
  }

  setSky(tex: THREE.Texture, w: number, h: number) {
    this.skyNode.value = tex;
    this.uSkySize.value.set(w, h);
    this.hasSky = true;
  }

  /** sky background chooser: an image in the Gaia image's projection, or null for the Gaia image */
  setSkyOverride(tex: THREE.Texture | null, w = 4000, h = 2000, gain = 0.5) {
    if (tex) {
      this.skyAltNode.value = tex;
      this.uSkyAltSize.value.set(w, h);
      this.uSkyAltGain.value = gain;
    }
    this.uSkyAlt.value = tex ? 1 : 0;
  }

  /** CMB shell texture (equirectangular Galactic, `width` texels around 2pi) */
  setCmb(tex: THREE.Texture, width: number) {
    this.cmbNode.value = tex;
    this.uCmbPxRad.value = width / (2 * Math.PI);
    this.hasCmb = true;
  }

  /**
   * skyAmount: 0..1 (layer opacity x distance fade).
   * dust: draw the dust pipeline (ignored while the lens runs).
   * cmb: shell radius (pc), the camera's Sun-centred position (pc), amount 0..1, linear gain.
   */
  render(camera: THREE.PerspectiveCamera, skyAmount: number, lens = false, dust = false, cmb?: CmbFrame) {
    this.uSkyOn.value = this.hasSky || this.uSkyAlt.value > 0 ? skyAmount : 0;
    const on = this.hasCmb && !!cmb && cmb.amount > 0;
    this.uCmbOn.value = on ? cmb!.amount : 0;
    if (on) {
      const r = cmb!.radiusPc;
      this.uCmbCam.value.set(cmb!.camPos[0] / r, cmb!.camPos[1] / r, cmb!.camPos[2] / r);
      this.uCmbGain.value = cmb!.gain;
    }
    this.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    const t = Math.tan((camera.fov * Math.PI) / 360);
    this.uTanHalf.value.set(t * camera.aspect, t);
    const useLens = lens && this.lensPipeline;
    const useDust = !useLens && dust && !!this.dustPipeline;
    (useLens ? this.lensPipeline! : useDust ? this.dustPipeline! : this.pipeline).render();
  }
}
