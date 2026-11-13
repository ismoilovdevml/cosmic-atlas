/**
 * GPU picking through a 1×1 cropped projection (technique from skymap, MIT, Copyright (c) 2026
 * Alexander Rulkens, windowedSlabView.ts / pickProgram.ts; re-implemented with three.js).
 *
 * camera.setViewOffset(W, H, x, y, 1, 1) crops the projection to the cursor's device pixel, so only
 * that pixel is rasterised. Each layer's pick material writes (point index, node slot, layer code)
 * as floats into a 1×1 RGBA32F target (exact for integers < 2^24, and avoids integer-target quirks
 * between the WebGPU and WebGL2 backends); the brightest point wins through a depth test on
 * 1/(1+intensity). One pick is in flight at a time; newer requests replace the queued one.
 * The pick materials share the display gate, so anything faded to zero cannot take a click.
 */

import * as THREE from 'three/webgpu';

export interface PickHit {
  layerCode: number;
  slot: number;
  index: number;
}

export class GpuPicker {
  readonly scene = new THREE.Scene();
  private readonly rt = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  private readonly cam = new THREE.PerspectiveCamera();
  private busy = false;
  private queued: { x: number; y: number; resolve: (h: PickHit | null) => void } | null = null;

  constructor(private renderer: THREE.WebGPURenderer, private camera: THREE.PerspectiveCamera) {}

  /** cssX/cssY in CSS px of the canvas */
  pick(cssX: number, cssY: number): Promise<PickHit | null> {
    return new Promise((resolve) => {
      if (this.busy) {
        this.queued?.resolve(null);
        this.queued = { x: cssX, y: cssY, resolve };
        return;
      }
      void this.run(cssX, cssY).then(resolve);
    });
  }

  private async run(cssX: number, cssY: number): Promise<PickHit | null> {
    this.busy = true;
    try {
      const canvas = this.renderer.domElement;
      const W = canvas.width;
      const H = canvas.height;
      const sx = W / canvas.clientWidth;
      const sy = H / canvas.clientHeight;
      this.cam.copy(this.camera);
      this.cam.setViewOffset(W, H, Math.floor(cssX * sx), Math.floor(cssY * sy), 1, 1);
      this.cam.updateProjectionMatrix();
      this.cam.updateMatrixWorld(true);
      const prevColor = new THREE.Color();
      this.renderer.getClearColor(prevColor);
      const prevAlpha = this.renderer.getClearAlpha();
      this.renderer.setRenderTarget(this.rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, this.cam);
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(prevColor, prevAlpha);
      const px = (await this.renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, 1, 1)) as Float32Array;
      const layerCode = Math.round(px[2]);
      if (!(layerCode > 0)) return null;
      return { layerCode, slot: Math.round(px[1]), index: Math.round(px[0]) };
    } finally {
      this.busy = false;
      const q = this.queued;
      this.queued = null;
      if (q) void this.run(q.x, q.y).then(q.resolve);
    }
  }
}
