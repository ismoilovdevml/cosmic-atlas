/**
 * Final pass (TSL, RenderPipeline): HDR point light -> display, plus the all-sky image.
 *
 * Points and the Milky Way model are summed additively into the scene pass's half-float target,
 * then compressed with an asinh stretch on luminance (Lupton et al. 1999, AJ 118, 1406; the SDSS
 * colour-image convention), which keeps faint diffuse light and bright stars legible together
 * without clipping colour.
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
  Fn, asinh, atan, clamp, cos, dot, float, fract, fwidth, length, log2, max, normalize, pass, screenCoordinate,
  screenUV, select, sin, sqrt, texture, uniform, vec2, vec3, vec4, asin,
} from 'three/tsl';

const SQRT2 = Math.SQRT2;

export class PostPass {
  readonly pipeline: THREE.RenderPipeline;
  private readonly uSkyOn = uniform(0);
  private readonly uSkyGain = uniform(0.42);
  private readonly uSkySize = uniform(new THREE.Vector2(4000, 2000));
  private readonly uCamRot = uniform(new THREE.Matrix3());
  private readonly uTanHalf = uniform(new THREE.Vector2(1, 1));
  private readonly uQ = uniform(9);
  private readonly skyNode;
  private hasSky = false;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const scenePass = pass(scene, camera);
    const hdrTex = scenePass.getTextureNode('output');
    const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    placeholder.needsUpdate = true;
    this.skyNode = texture(placeholder);

    const out = Fn(() => {
      const hdr = hdrTex.rgb;
      const L = max(max(hdr.r, hdr.g), hdr.b);
      const q = this.uQ;
      const f = select(L.greaterThan(1e-6), asinh(q.mul(L)).div(asinh(q).mul(L)), q.div(asinh(q)));
      const c0 = hdr.mul(f);
      const mx = max(max(c0.r, c0.g), c0.b);
      const c = c0.div(max(mx, 1.0));

      // sky: view direction -> (l, b) -> Hammer-Aitoff uv
      const ndc = vec2(screenUV.x.mul(2.0).sub(1.0), float(1.0).sub(screenUV.y.mul(2.0)));
      const d = normalize(this.uCamRot.mul(vec3(ndc.mul(this.uTanHalf), -1.0)));
      const l = atan(d.y, d.x);
      const b = asin(clamp(d.z, -1.0, 1.0));
      const den = sqrt(float(1.0).add(cos(b).mul(cos(l.mul(0.5)))));
      const x = float(2.0 * SQRT2).mul(cos(b)).mul(sin(l.mul(0.5))).div(den);
      const y = float(SQRT2).mul(sin(b)).div(den);
      const col = float(2.0 * SQRT2).sub(x).div(4.0 * SQRT2).mul(this.uSkySize.x.sub(1.0));
      const row = float(SQRT2).sub(y).div(2.0 * SQRT2).mul(this.uSkySize.y.sub(1.0));
      const uvSky = vec2(col.add(0.5).div(this.uSkySize.x), float(1.0).sub(row.add(0.5).div(this.uSkySize.y)));
      const ang = length(fwidth(d));
      const lod = log2(max(ang.mul(this.uSkySize.x).mul(0.25), 1.0));
      const skyRaw = this.skyNode.sample(uvSky).level(lod).rgb;
      // the image's floor is a faint grey haze; pull it toward black so the sky stays calm
      const sky = max(skyRaw.sub(0.035), 0.0).mul(this.uSkyGain).mul(this.uSkyOn);

      const voidCol = vec3(4 / 255, 6 / 255, 11 / 255);
      const dither = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).div(255.0);
      const outc = voidCol.add(sky).add(c.mul(float(1.0).sub(sky.mul(0.5)))).add(dither);
      return vec4(outc, 1.0);
    })();

    this.pipeline = new THREE.RenderPipeline(renderer, out);
    this.pipeline.outputColorTransform = false;
  }

  setSky(tex: THREE.Texture, w: number, h: number) {
    this.skyNode.value = tex;
    this.uSkySize.value.set(w, h);
    this.hasSky = true;
  }

  /** skyAmount: 0..1 (layer opacity x distance fade) */
  render(camera: THREE.PerspectiveCamera, skyAmount: number) {
    this.uSkyOn.value = this.hasSky ? skyAmount : 0;
    this.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    const t = Math.tan((camera.fov * Math.PI) / 360);
    this.uTanHalf.value.set(t * camera.aspect, t);
    this.pipeline.render();
  }
}
