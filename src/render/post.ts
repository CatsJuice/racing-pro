import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Environment } from './environment';

/**
 * Renders view-space normals of the opaque, outline-able geometry into its own target.
 * Objects flagged `userData.noOutline` (or using transparent materials) are skipped.
 */
class NormalPass extends Pass {
  target: THREE.WebGLRenderTarget;
  private mat = new THREE.MeshNormalMaterial();
  private hidden: THREE.Object3D[] = [];

  constructor(public scene: THREE.Scene, public camera: THREE.Camera) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  }

  setSize(w: number, h: number) {
    this.target.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer) {
    const hidden = this.hidden;
    hidden.length = 0;
    this.scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const transparent = m ? (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent) : false;
      if (o.userData.noOutline || transparent || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const bg = this.scene.background, fog = this.scene.fog, ov = this.scene.overrideMaterial;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.mat;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x8080ff, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    this.scene.background = bg;
    this.scene.fog = fog;
    this.scene.overrideMaterial = ov;
    for (const o of hidden) o.visible = true;
  }
}

/** Ink outlines from depth + normal discontinuities, plus colour grading. */
class InkPass extends Pass {
  private quad: FullScreenQuad;
  material: THREE.ShaderMaterial;

  constructor(private normals: NormalPass, public camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        ink: { value: new THREE.Color('#2a1a44') },
        thickness: { value: 1.0 },
        strength: { value: 0.42 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler2D tNormal;
        uniform vec2 resolution; uniform float cameraNear; uniform float cameraFar;
        uniform vec3 ink; uniform float thickness; uniform float strength;
        varying vec2 vUv;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(z, cameraNear, cameraFar); }
        vec3 nrm(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
        void main(){
          vec4 col = texture2D(tDiffuse, vUv);
          vec2 px = thickness / resolution;
          float d = lin(vUv);
          vec3 n = nrm(vUv);
          float dMax = 0.0; float nMin = 1.0;
          vec2 offs[8];
          offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
          offs[4] = px; offs[5] = -px; offs[6] = vec2(px.x, -px.y); offs[7] = vec2(-px.x, px.y);
          for (int i = 0; i < 8; i++) {
            float di = lin(vUv + offs[i]);
            // only the nearer side of a depth step draws the line (keeps lines 1-sided and crisp)
            dMax = max(dMax, (di - d) / max(d, 0.001));
            nMin = min(nMin, dot(n, nrm(vUv + offs[i])));
          }
          float depthEdge = smoothstep(0.035, 0.09, dMax);
          float normalEdge = smoothstep(0.45, 0.2, nMin) * (1.0 - smoothstep(40.0, 120.0, d)) * 0.6;
          float fade = 1.0 - smoothstep(350.0, 1200.0, d);
          float edge = clamp(max(depthEdge, normalEdge), 0.0, 1.0) * fade * strength;
          col.rgb = mix(col.rgb, col.rgb * ink * 2.2, edge);
          gl_FragColor = col;
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(w: number, h: number) {
    this.material.uniforms.resolution.value.set(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.tNormal.value = this.normals.target.texture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/** separable tilt-shift blur with a sharp focus band around `r` */
function tiltShader(horizontal: boolean) {
  return {
    uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, r: { value: 0.5 }, band: { value: 0.22 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float amount; uniform float r; uniform float band;
      varying vec2 vUv;
      void main(){
        float k = amount * smoothstep(0.0, 0.5 - band, abs(r - vUv.y) - band);
        vec2 dir = ${horizontal ? 'vec2(k, 0.0)' : 'vec2(0.0, k)'};
        vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
        sum += (texture2D(tDiffuse, vUv + dir) + texture2D(tDiffuse, vUv - dir)) * 0.1531;
        sum += (texture2D(tDiffuse, vUv + dir * 2.0) + texture2D(tDiffuse, vUv - dir * 2.0)) * 0.12245;
        sum += (texture2D(tDiffuse, vUv + dir * 3.0) + texture2D(tDiffuse, vUv - dir * 3.0)) * 0.0918;
        sum += (texture2D(tDiffuse, vUv + dir * 4.0) + texture2D(tDiffuse, vUv - dir * 4.0)) * 0.051;
        gl_FragColor = sum;
      }`,
  };
}

class GradePass extends Pass {
  private quad: FullScreenQuad;
  material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, saturation: { value: 1.14 }, contrast: { value: 1.0 }, vignette: { value: 0.32 }, tint: { value: new THREE.Color(1, 1, 1) },
      shadowTint: { value: new THREE.Color('#7050c0') }, highTint: { value: new THREE.Color('#ffb070') }, split: { value: 0.16 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform float vignette; uniform vec3 tint;
      uniform vec3 shadowTint; uniform vec3 highTint; uniform float split;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation);
        c.rgb = (c.rgb - 0.18) * contrast + 0.18;
        // split toning: cool purple shadows, warm highlights
        float lum = clamp(l, 0.0, 1.0);
        c.rgb += (shadowTint - 0.5) * (1.0 - smoothstep(0.0, 0.55, lum)) * split;
        c.rgb += (highTint - 0.5) * smoothstep(0.45, 1.1, lum) * split * 0.8;
        vec2 q = vUv - 0.5;
        c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
        c.rgb *= tint;
        gl_FragColor = c;
      }`,
  });

  constructor() {
    super();
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

export class PostFX {
  composer: EffectComposer;
  private renderPass: RenderPass;
  private normalPass: NormalPass;
  private inkPass: InkPass;
  private bloom: UnrealBloomPass;
  grade: GradePass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  /** user setting: allow depth of field at all */
  dof = 1;
  /** per-view strength requested by the current screen (0 = none) */
  dofStrength = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();

  constructor(private renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.normalPass = new NormalPass(this.scene, this.camera);
    this.inkPass = new InkPass(this.normalPass, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 0.95);
    this.grade = new GradePass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.normalPass);
    this.composer.addPass(this.inkPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.tiltH = new ShaderPass(tiltShader(true));
    this.tiltV = new ShaderPass(tiltShader(false));
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // keep the ink line ~1.5 CSS px wide regardless of the device pixel ratio
    this.inkPass.material.uniforms.thickness.value = Math.max(1, this.renderer.getPixelRatio() * 1.25);
    this.size.set(w, h);
  }

  private size = new THREE.Vector2(1, 1);

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, env?: Environment) {
    const n = env?.night ?? 0;
    this.grade.material.uniforms.tint.value.copy(env ? env.grade : new THREE.Color(1, 1, 1));
    this.grade.material.uniforms.split.value = 0.1 + n * 0.04;
    this.bloom.strength = 0.45 + n * 0.55;
    this.bloom.threshold = 0.95 - n * 0.35;
    const s = this.dof * this.dofStrength;
    const on = s > 0.01;
    this.tiltH.enabled = this.tiltV.enabled = on;
    if (on) {
      this.tiltH.uniforms.amount.value = (2.2 * s) / this.size.x;
      this.tiltV.uniforms.amount.value = (2.2 * s) / this.size.y;
      this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.45;
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.normalPass.scene = scene;
    this.normalPass.camera = camera;
    this.inkPass.camera = camera;
    this.composer.render();
  }
}
