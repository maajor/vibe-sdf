import { transpile } from './transpiler';

// Helper: suppress console.log during tests
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

// ========== Basic primitives ==========

describe('basic SDF primitives', () => {
  test('sphere', () => {
    const code = `
      function map(p) {
        return sphere(p, 1.0);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdSphere');
    expect(result.glslMapFunction).toContain('vec2 map(vec3 p)');
  });

  test('box', () => {
    const code = `
      function map(p) {
        return box(p, vec3(1.0, 1.0, 1.0));
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdBox');
  });

  test('roundedBox', () => {
    const code = `
      function map(p) {
        return roundedBox(p, vec3(1.0, 1.0, 1.0), 0.1);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdRoundedBox');
  });

  test('torus', () => {
    const code = `
      function map(p) {
        return torus(p, vec2(1.0, 0.3));
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdTorus');
  });

  test('capsule', () => {
    const code = `
      function map(p) {
        return capsule(p, vec3(0, -1, 0), vec3(0, 1, 0), 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdCapsule');
  });

  test('cylinder', () => {
    const code = `
      function map(p) {
        return cylinder(p, 1.0, 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdCylinder');
  });

  test('cone', () => {
    const code = `
      function map(p) {
        return cone(p, 1.0, 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdCone');
  });

  test('plane', () => {
    const code = `
      function map(p) {
        return plane(p, vec3(0, 1, 0));
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sdPlane');
  });
});

// ========== CSG operations ==========

describe('CSG operations', () => {
  test('union of two spheres', () => {
    const code = `
      function map(p) {
        return union(
          sphere(p - vec3(1, 0, 0), 0.5),
          sphere(p + vec3(1, 0, 0), 0.5)
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opUnion');
  });

  test('smooth union with k parameter', () => {
    const code = `
      function map(p) {
        return union(
          sphere(p - vec3(1, 0, 0), 0.5),
          sphere(p + vec3(1, 0, 0), 0.5),
          0.3
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opSmoothUnion');
  });

  test('subtract', () => {
    const code = `
      function map(p) {
        return subtract(
          box(p, vec3(1, 1, 1)),
          sphere(p, 0.8)
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opSubtract');
  });

  test('smooth subtract', () => {
    const code = `
      function map(p) {
        return subtract(
          box(p, vec3(1, 1, 1)),
          sphere(p, 0.8),
          0.2
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opSmoothSubtract');
  });

  test('intersect', () => {
    const code = `
      function map(p) {
        return intersect(
          box(p, vec3(1, 1, 1)),
          sphere(p, 1.2)
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opIntersect');
  });

  test('smooth intersect', () => {
    const code = `
      function map(p) {
        return intersect(
          box(p, vec3(1, 1, 1)),
          sphere(p, 1.2),
          0.3
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opSmoothIntersect');
  });
});

// ========== Nested expressions ==========

describe('nested expressions', () => {
  test('nested CSG: union of subtracts', () => {
    const code = `
      function map(p) {
        return union(
          subtract(box(p, vec3(1, 1, 1)), sphere(p, 0.8)),
          sphere(p - vec3(2, 0, 0), 0.5)
        );
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opUnion');
    expect(result.glslMapFunction).toContain('opSubtract');
  });

  test('variable assignment with expression', () => {
    const code = `
      function map(p) {
        let d = sphere(p, 1.0);
        return d;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('SdfResult d = sdSphere');
  });

  test('multiple variables and operations', () => {
    const code = `
      function map(p) {
        let s = sphere(p, 1.0);
        let b = box(p, vec3(0.8, 0.8, 0.8));
        return union(s, b, 0.1);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('SdfResult s = sdSphere');
    expect(result.glslMapFunction).toContain('SdfResult b = sdBox');
    expect(result.glslMapFunction).toContain('opSmoothUnion(s, b, 0.1)');
  });

  test('spatial offset with subtraction', () => {
    const code = `
      function map(p) {
        return sphere(p - vec3(1, 0, 0), 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('(p - vec3(1.0, 0.0, 0.0))');
  });
});

// ========== GLSL reserved word sanitization ==========

describe('GLSL reserved word sanitization', () => {
  test('"external" variable name gets sanitized', () => {
    const code = `
      function map(p) {
        let external = sphere(p, 1.0);
        return external;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('_external_');
    expect(result.glslMapFunction).not.toMatch(/\bexternal\b/);
  });

  test('"uniform" variable name gets sanitized', () => {
    const code = `
      function map(p) {
        let uniform = sphere(p, 1.0);
        return uniform;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('_uniform_');
  });

  test('"in" variable name gets sanitized', () => {
    const code = `
      function map(p) {
        let in_val = sphere(p, 1.0);
        return in_val;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    // 'in' alone would be sanitized, but 'in_val' is fine
    expect(result.glslMapFunction).toContain('in_val');
  });

  test('"external" as function parameter gets sanitized', () => {
    const code = `
      function helper(p, external) {
        return sphere(p, external);
      }
      function map(p) {
        return helper(p, 1.0);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('_external_');
  });

  test('"external" as user-defined function name gets sanitized', () => {
    const code = `
      function external(p) {
        return sphere(p, 0.5);
      }
      function map(p) {
        return external(p);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    // Both definition and call should use sanitized name
    expect(result.glslMapFunction).toContain('SdfResult _external__impl');
    expect(result.glslMapFunction).toContain('_external_(p)');
  });

  test('"buffer" variable name gets sanitized', () => {
    const code = `
      function map(p) {
        let buffer = sphere(p, 1.0);
        return buffer;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('_buffer_');
  });

  test('type inference works with sanitized names', () => {
    const code = `
      function map(p) {
        let external = sphere(p, 1.0);
        let d = external;
        return d;
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    // The type of 'd' should be inferred as SdfResult since 'external' -> '_external_' is SdfResult
    expect(result.glslMapFunction).toContain('SdfResult d = _external_');
  });
});

// ========== Variable declarations ==========

describe('variable declarations', () => {
  test('float variable', () => {
    const code = `
      function map(p) {
        let r = 1.0;
        return sphere(p, r);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('float r = 1.0');
  });

  test('vec3 variable', () => {
    const code = `
      function map(p) {
        let offset = vec3(1, 0, 0);
        return sphere(p - offset, 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('vec3 offset = vec3(1.0, 0.0, 0.0)');
  });

  test('reassignment', () => {
    const code = `
      function map(p) {
        let d = 1.0;
        d = d + 0.5;
        return sphere(p, d);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('d = (d + 0.5)');
  });

  test('top-level constant', () => {
    const code = `
      const SIZE = 2.0;
      function map(p) {
        return sphere(p, SIZE);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('SIZE');
  });
});

// ========== Math functions ==========

describe('math functions', () => {
  test('sin/cos', () => {
    const code = `
      function map(p) {
        let r = sin(p.x) + cos(p.y);
        return sphere(p, r);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sin(p.x)');
    expect(result.glslMapFunction).toContain('cos(p.y)');
  });

  test('Math.sin style', () => {
    const code = `
      function map(p) {
        let r = Math.sin(1.0);
        return sphere(p, r);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('sin(1.0)');
  });

  test('abs, min, max, clamp', () => {
    const code = `
      function map(p) {
        let d = abs(p.x);
        d = min(d, 2.0);
        d = max(d, 0.5);
        d = clamp(d, 0.0, 1.0);
        return sphere(p, d);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('abs(p.x)');
    expect(result.glslMapFunction).toContain('min(d, 2.0)');
    expect(result.glslMapFunction).toContain('max(d, 0.5)');
    expect(result.glslMapFunction).toContain('clamp(d, 0.0, 1.0)');
  });

  test('length, normalize, dot, cross', () => {
    const code = `
      function map(p) {
        let d = length(p);
        let n = normalize(p);
        let dd = dot(p, n);
        let c = cross(p, n);
        return sphere(p, d);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('length(p)');
    expect(result.glslMapFunction).toContain('normalize(p)');
    expect(result.glslMapFunction).toContain('dot(p, n)');
    expect(result.glslMapFunction).toContain('cross(p, n)');
  });
});

// ========== vec constructors ==========

describe('vec constructors', () => {
  test('vec3 from literals', () => {
    const code = `
      function map(p) {
        let offset = vec3(1, 2, 3);
        return sphere(p - offset, 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('vec3(1.0, 2.0, 3.0)');
  });

  test('vec2 from literals', () => {
    const code = `
      function map(p) {
        return torus(p, vec2(1.0, 0.3));
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('vec2(1.0, 0.3)');
  });

  test('vec3 from expressions', () => {
    const code = `
      function map(p) {
        return sphere(p - vec3(1 + 2, 0, sin(1.0)), 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('vec3((1.0 + 2.0), 0.0, sin(1.0))');
  });

  test('array literal becomes vec3', () => {
    const code = `
      function map(p) {
        let offset = [1, 0, 0];
        return sphere(p - offset, 0.5);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('vec3(1.0, 0.0, 0.0)');
  });
});

// ========== Rotation transforms ==========

describe('rotation transforms', () => {
  test('rotateX', () => {
    const code = `
      function map(p) {
        return box(rotateX(p, 0.5), vec3(1, 1, 1));
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opRotateX(p, 0.5)');
  });

  test('rotation via options', () => {
    const code = `
      function map(p) {
        return box(p, vec3(1, 1, 1), { rotation: [45, 0, 0] });
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('opRotateX');
  });
});

// ========== Color / material ==========

describe('color and materials', () => {
  test('color option generates material table', () => {
    const code = `
      function map(p) {
        return sphere(p, 1.0, { color: [1, 0, 0] });
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.materialColorTable).toContain('vec3(1');
    expect(result.materialColorTable).toContain('0');
  });
});

// ========== Error handling ==========

describe('error handling', () => {
  test('missing map function returns error', () => {
    const code = `
      function notMap(p) {
        return sphere(p, 1.0);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('map()');
  });

  test('syntax error returns parse error', () => {
    const code = `function map(p) { return }}}}`;
    const result = transpile(code);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Transpilation error');
  });

  test('empty input returns error', () => {
    const result = transpile('');
    expect(result.error).toBeDefined();
  });
});

// ========== User-defined functions ==========

describe('user-defined functions', () => {
  test('helper function is transpiled', () => {
    const code = `
      function rep(p, c) {
        return sphere(p, c);
      }
      function map(p) {
        return rep(p, 1.0);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('SdfResult rep_impl');
    expect(result.glslMapFunction).toContain('rep(p, 1.0)');
  });
});

// ========== Binary/unary/conditional ==========

describe('expressions', () => {
  test('ternary conditional', () => {
    const code = `
      function map(p) {
        let r = p.y > 0 ? 1.0 : 0.5;
        return sphere(p, r);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('p.y > 0.0');
  });

  test('unary negation', () => {
    const code = `
      function map(p) {
        let r = -1.0;
        return sphere(p, r);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    expect(result.glslMapFunction).toContain('-1.0');
  });

  test('comparison operators', () => {
    const code = `
      function map(p) {
        let d = p.x === 0 ? 1.0 : 0.5;
        return sphere(p, d);
      }
    `;
    const result = transpile(code);
    expect(result.error).toBeUndefined();
    // === should become ==
    expect(result.glslMapFunction).toContain('==');
    expect(result.glslMapFunction).not.toContain('===');
  });
});
