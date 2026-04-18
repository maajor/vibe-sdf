/**
 * Smoke tests for the shader assembly pipeline.
 *
 * These tests verify that the transpiler + shader assembly produces valid GLSL
 * without requiring WebGL. They check structural correctness of the output.
 *
 * For visual testing, run `npm run dev` and open the app in a browser.
 * The default sphere should render as a shaded brownish sphere.
 */
import { transpile } from './transpiler';
import { buildFragmentShader, vertexShader, sdfPrimitives, rayMarchingFooter } from './shader';

let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  jest.restoreAllMocks();
});

describe('shader assembly smoke tests', () => {
  test('vertex shader is valid GLSL structure', () => {
    expect(vertexShader).toContain('void main()');
    expect(vertexShader).toContain('gl_Position');
    expect(vertexShader).toContain('vUv');
  });

  test('sdfPrimitives contains all required SDF functions', () => {
    const requiredFns = [
      'sdSphere', 'sdBox', 'sdRoundedBox', 'sdTorus', 'sdCapsule',
      'sdCylinder', 'sdCone', 'sdPlane',
      'opUnion', 'opSmoothUnion', 'opSubtract', 'opSmoothSubtract',
      'opIntersect', 'opSmoothIntersect',
      'opRotateX', 'opRotateY', 'opRotateZ',
    ];
    for (const fn of requiredFns) {
      expect(sdfPrimitives).toContain(fn);
    }
  });

  test('rayMarchingFooter contains main rendering pipeline', () => {
    expect(rayMarchingFooter).toContain('void main()');
    expect(rayMarchingFooter).toContain('rayMarch');
    expect(rayMarchingFooter).toContain('calcNormal');
    expect(rayMarchingFooter).toContain('getMaterialColor');
    expect(rayMarchingFooter).toContain('gl_FragColor');
  });

  test('sdfPrimitives does not contain GLSL reserved words as variable names', () => {
    // Check that no bare 'external' is used as a variable name in shader code
    // (it was a bug before)
    const reservedPattern = /\bexternal\b/;
    expect(sdfPrimitives).not.toMatch(reservedPattern);
  });

  test('simple sphere transpiles and assembles into complete shader', () => {
    const code = `
      function map(p) {
        return sphere(p, 1.0);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();

    const fullShader = buildFragmentShader(result.glslMapFunction, result.materialColorTable);

    // Must have all essential parts
    expect(fullShader).toContain('uniform vec2 uResolution');
    expect(fullShader).toContain('uniform float uTime');
    expect(fullShader).toContain('uniform vec3 uCameraPos');
    expect(fullShader).toContain('SdfResult');
    expect(fullShader).toContain('sdSphere');
    expect(fullShader).toContain('vec2 map(vec3 p)');
    expect(fullShader).toContain('void main()');
    expect(fullShader).toContain('gl_FragColor');

    // Should not contain any unsupported expression markers
    expect(fullShader).not.toContain('unsupported');
    expect(fullShader).not.toContain('/* unsupported');
  });

  test('complex scene transpiles and assembles correctly', () => {
    const code = `
      function map(p) {
        let s = sphere(p, 1.0, { color: [1, 0, 0] });
        let b = box(p - vec3(2, 0, 0), vec3(0.5, 0.5, 0.5), { color: [0, 1, 0] });
        return union(s, b);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();

    const fullShader = buildFragmentShader(result.glslMapFunction, result.materialColorTable);
    expect(fullShader).toContain('sdSphere');
    expect(fullShader).toContain('sdBox');
    expect(fullShader).toContain('opUnion');
    expect(fullShader).toContain('getMaterialColor');

    // Material table should have entries for both colors
    expect(result.materialColorTable).toContain('vec3(1');
  });

  test('scene with reserved-word variables assembles without bare reserved words', () => {
    const code = `
      function map(p) {
        let external = sphere(p, 1.0);
        return external;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();

    const fullShader = buildFragmentShader(result.glslMapFunction, result.materialColorTable);

    // The shader should NOT contain bare 'external' as a variable
    // (it should be _external_)
    expect(fullShader).toContain('_external_');
    // Match 'external' as a whole word but not inside _external_
    const bareExternal = /(?<![_\w])external(?![_\w])/;
    expect(fullShader).not.toMatch(bareExternal);
  });

  test('MATERIAL_COLOR_TABLE placeholder gets replaced', () => {
    const code = `
      function map(p) {
        return sphere(p, 1.0, { color: [0.8, 0.5, 0.3] });
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();

    const fullShader = buildFragmentShader(result.glslMapFunction, result.materialColorTable);
    expect(fullShader).not.toContain('MATERIAL_COLOR_TABLE');
    expect(fullShader).toContain('vec3(0.8, 0.5, 0.3)');
  });
});

describe('visual testing guide', () => {
  test.todo('Visual: run `npm run dev`, open browser, verify sphere renders correctly');
  test.todo('Visual: test CSG operations (union, subtract, intersect) render correctly');
  test.todo('Visual: test materials/colors display correctly on shapes');
  test.todo('Visual: test orbit controls work (drag to rotate, scroll to zoom)');
});
