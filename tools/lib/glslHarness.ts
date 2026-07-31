import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Shader chunk test harness (§8.2 item 1).
 *
 * Compiles a chunk into a fragment shader, renders it to a small float target
 * in a real WebGL2 context, and reads the pixels back. jsdom has no GL, so
 * these tests run under Playwright rather than vitest — a shader unit test that
 * does not run a shader is not a shader unit test.
 *
 * Output is RGBA32F, not RGBA8. Asserting a colour-matching fit to ±0.02 through
 * an 8-bit target would be asserting against a 1/255 = 0.0039 quantisation
 * floor, which is close enough to the tolerance to make a passing test
 * meaningless.
 */

/** Resolves the `#include "./x.glsl";` form that vite-plugin-glsl uses. */
export function resolveIncludes(entry: string, seen = new Set<string>()): string {
  const path = resolve(entry);
  if (seen.has(path)) return '';
  seen.add(path);

  const source = readFileSync(path, 'utf8');
  return source.replace(/^[ \t]*#include\s+"([^"]+)"\s*;?[ \t]*$/gm, (_match, relative: string) =>
    resolveIncludes(join(dirname(path), relative), seen),
  );
}

const VERT = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

export interface HarnessOptions {
  /** Chunk sources to prepend, already include-resolved. */
  chunks: string[];
  /**
   * Body of `vec4 weftTest(int index, float t)`. `index` is the linear pixel
   * index and `t` is index/(count-1), so a 1-D sweep needs no uniform plumbing.
   */
  body: string;
  /** Number of samples. Rounded up to fill a square target. */
  count: number;
}

/**
 * Runs a chunk and returns `count` RGBA quadruples.
 *
 * The shader is written as GLSL ES 3.00 because float render targets need
 * WebGL2, but the chunks themselves are GLSL ES 1.00 compatible (the piece
 * ships them through three's ShaderMaterial, which is ES 1.00). The two
 * incompatibilities are handled by the shim below rather than by writing the
 * chunks twice.
 */
export async function runChunk(page: Page, options: HarnessOptions): Promise<Float32Array> {
  const side = Math.ceil(Math.sqrt(options.count));

  const frag = `#version 300 es
precision highp float;
precision highp int;

// Shim: the chunks are authored for GLSL ES 1.00 so they can be used with
// three's ShaderMaterial. Under ES 3.00 the sampler function was renamed and
// the output is a declared variable rather than gl_FragColor.
#define texture2D texture
out vec4 fragColor;

${options.chunks.join('\n')}

uniform int uCount;
uniform int uSide;

vec4 weftTest(int index, float t) {
${options.body}
}

void main() {
  int x = int(gl_FragCoord.x);
  int y = int(gl_FragCoord.y);
  int index = y * uSide + x;
  float t = uCount > 1 ? float(index) / float(uCount - 1) : 0.0;
  fragColor = weftTest(index, t);
}
`;

  const result = await page.evaluate(
    ({ vert, fragment, sideLength, count }) => {
      const canvas = document.createElement('canvas');
      canvas.width = sideLength;
      canvas.height = sideLength;
      const context = canvas.getContext('webgl2');
      if (!context) throw new Error('no webgl2');
      const gl: WebGL2RenderingContext = context;
      if (!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error('EXT_color_buffer_float unavailable — cannot read float targets');
      }

      function compile(type: number, source: string): WebGLShader {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('createShader failed');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(shader) ?? '';
          const numbered = source
            .split('\n')
            .map((l, i) => `${String(i + 1).padStart(4)} ${l}`)
            .join('\n');
          throw new Error(`shader compile failed:\n${log}\n---\n${numbered}`);
        }
        return shader;
      }

      // createProgram is non-nullable in the current lib.dom typings.
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
      }
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1i(gl.getUniformLocation(program, 'uCount'), count);
      gl.uniform1i(gl.getUniformLocation(program, 'uSide'), sideLength);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, sideLength, sideLength);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
      }

      gl.viewport(0, 0, sideLength, sideLength);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const pixels = new Float32Array(sideLength * sideLength * 4);
      gl.readPixels(0, 0, sideLength, sideLength, gl.RGBA, gl.FLOAT, pixels);
      return Array.from(pixels.subarray(0, count * 4));
    },
    { vert: VERT, fragment: frag, sideLength: side, count: options.count },
  );

  return Float32Array.from(result);
}
