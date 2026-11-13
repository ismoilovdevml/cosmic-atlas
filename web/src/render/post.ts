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
 */

import * as THREE from 'three/webgpu';
import {
  Fn, asinh, atan, clamp, cos, dot, float, fract, fwidth, length, log2, max, normalize, pass, pow, screenCoordinate,
  screenUV, select, sin, sqrt, texture, uniform, vec2, vec3, vec4, asin,
} from 'three/tsl';
import { srgbToLinear } from './brightness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const linearToSrgbNode = (x: any): any =>
  select(x.lessThanEqual(0.0031308), x.mul(12.92), pow(max(x, 0.0), 1.0 / 2.4).mul(1.055).sub(0.055));

/** the page's void colour, sRGB bytes (also the CSS --void) */
export const VOID_SRGB: [number, number, number] = [4, 6, 11];

const SQRT2 = Math.SQRT2;

/** a lens: scene HDR texture + sky sampler -> HDR light and linear sky along bent rays (src/blackhole/lens.ts) */
export type LensFn = (ctx: { hdrTex: any; skyAt: (d: any, lod: any) => any; skyWidth: any }) => { hdr: any; sky: any };

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
  private readonly skyNode;
  private hasSky = false;

  constructor(private readonly renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const scenePass = pass(scene, camera);
    const hdrTex = scenePass.getTextureNode('output');
    // only opaque Solar System bodies write depth; the sky must not show through them
    const sceneDepth = scenePass.getTextureNode('depth');
    const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    // The placeholder must carry the sky's filtering: on the WebGPU backend the swapped-in texture
    // kept the placeholder's sampler, so with DataTexture's default NearestFilter the sky was
    // point-sampled on WebGPU only (WebGL2 takes the filters from the new texture). Measured with
    // level(0) sampling: mean |WebGPU − WebGL2| 8.5/255 before, 0.03/255 after.
    placeholder.minFilter = THREE.LinearMipmapLinearFilter;
    placeholder.magFilter = THREE.LinearFilter;
    placeholder.generateMipmaps = true;
    placeholder.needsUpdate = true;
    this.skyNode = texture(placeholder);

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
      // (linear) the image's floor is a faint grey haze; pull it toward black so the sky stays calm
      return max(skyRaw.sub(0.003), 0.0).mul(this.uSkyGain).mul(this.uSkyOn);
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

    const out = Fn(() => {
      // sky: view direction -> (l, b) -> Hammer-Aitoff uv
      const ndc = vec2(screenUV.x.mul(2.0).sub(1.0), float(1.0).sub(screenUV.y.mul(2.0)));
      const d = normalize(this.uCamRot.mul(vec3(ndc.mul(this.uTanHalf), -1.0)));
      const ang = length(fwidth(d));
      const lod = log2(max(ang.mul(this.uSkySize.x).mul(0.25), 1.0));
      const clearDepth = select(sceneDepth.x.greaterThanEqual(0.9999999), float(1.0), float(0.0));
      return compose(hdrTex.rgb, skyAt(d, lod).mul(clearDepth));
    })();

    this.pipeline = new THREE.RenderPipeline(renderer, out);
    this.pipeline.outputColorTransform = false;
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

  setSky(tex: THREE.Texture, w: number, h: number) {
    this.skyNode.value = tex;
    this.uSkySize.value.set(w, h);
    this.hasSky = true;
  }

  /** skyAmount: 0..1 (layer opacity x distance fade) */
  render(camera: THREE.PerspectiveCamera, skyAmount: number, lens = false) {
    this.uSkyOn.value = this.hasSky ? skyAmount : 0;
    this.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    const t = Math.tan((camera.fov * Math.PI) / 360);
    this.uTanHalf.value.set(t * camera.aspect, t);
    (lens && this.lensPipeline ? this.lensPipeline : this.pipeline).render();
  }
}
