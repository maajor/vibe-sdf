# Vibe SDF — Project Specification

## Overview

LLM-driven SDF 3D model generator. Users describe objects in natural language, an LLM generates SDF code, and the system compiles and renders it as an interactive 3D scene.

## Architecture

```
User Prompt → LLM (Vercel AI SDK) → JS SDF Code → AST Transpile → GLSL → Ray Marching Shader → WebGL Render
```

## Tech Stack

- **Framework**: Next.js
- **3D Rendering**: Three.js (PlaneGeometry + ShaderMaterial + OrbitControls)
- **LLM**: Vercel AI SDK (OpenAI / Anthropic / etc.)
- **Transpilation**: @babel/parser + custom AST visitor → GLSL
- **Deployment**: Vercel
- **Language**: TypeScript

## UI Layout

Two-column layout:
- **Left**: API Key input + prompt textarea + generate button + code preview (editable)
- **Right**: Three.js 3D viewport (OrbitControls)

## LLM Integration

- User provides their own API Key (frontend input)
- Called via Vercel AI SDK, supporting multiple providers
- Streaming output

## Rendering Pipeline

1. Three.js creates `PlaneGeometry(2, 2)` + `ShaderMaterial`
2. Fragment shader performs ray marching
3. LLM-generated `map()` function is transpiled and injected into the shader
4. Pre-built code: normal calculation, AO, soft shadows, camera ray generation
5. Uniforms: `uResolution`, `uTime`, `uCameraPos`, `uCameraMatrix`

## Lighting

- Ambient Occlusion (AO)
- Soft shadows
- No PBR environment maps
- No animation support (`uTime` unused for now)

## SDF Syntax API

### Primitives

All primitives return a distance value. Last parameter `opts?` is optional.

```js
sphere(p, r, opts?)
box(p, b, opts?)                    // b: vec3 half-size
roundedBox(p, b, r, opts?)          // b: vec3 half-size, r: corner radius
torus(p, t, opts?)                  // t: vec2(major radius, tube radius)
capsule(p, a, b, r, opts?)          // a/b: vec3 endpoints, r: radius
cylinder(p, h, r, opts?)            // h: half-height, r: radius
cone(p, h, r, opts?)                // h: half-height, r: base radius
plane(p, n, opts?)                  // n: vec3 normal
```

`opts`:
- `color: [r, g, b]` (0–1 range), default `[1, 1, 1]`
- `rotation: vec3(x, y, z)` Euler angles in degrees

### CSG Operations

```js
union(a, b, k?)          // Union; hard edge if k omitted, smooth blend if provided
subtract(a, b, k?)       // a - b
intersect(a, b, k?)      // Intersection
```

`a`/`b` can be primitives or return values of other CSG operations. Material color is automatically inherited from the branch with the smallest distance.

### Spatial Transforms

```js
vec3(x, y, z)
vec2(x, y)
rotateX(p, angle)   // radians
rotateY(p, angle)
rotateZ(p, angle)
```

### Math Constants & Functions

```js
PI, TAU
sin, cos, tan, atan, atan2, sqrt, pow, abs, min, max, clamp,
floor, ceil, fract, mix, step, smoothstep, mod, length, dot, cross,
normalize, reflect
```

### LLM-Implemented Function

```js
function map(p) {
  // Return a CSG tree or a single primitive
}
```

### Full Example: A Cup

```js
function map(p) {
  return union(
    subtract(
      cylinder(p, 1.2, 0.8, { color: [0.9, 0.9, 0.85] }),
      cylinder(p - vec3(0, 0.1, 0), 1.3, 0.75)
    ),
    torus(
      rotateY(p - vec3(1, 0, 0), PI / 2),
      vec2(0.4, 0.08),
      { color: [0.8, 0.3, 0.1] }
    )
  );
}
```

## JS → GLSL Transpilation

Uses `@babel/parser` to parse JS AST, custom visitor generates GLSL:

| JS | GLSL | Handling |
|---|---|---|
| `function map(p)` | `vec2 map(vec3 p)` | Returns vec2(distance, materialId) |
| Primitive calls | Built-in GLSL functions | Function mapping |
| `const d1 = expr` | `float d1 = expr` | Type inference |
| `Math.sin(x)` | `sin(x)` | Math.* conversion |
| `vec3(x,y,z)` | `vec3(x,y,z)` | Direct mapping |
| `opts: { color: [...] }` | Material ID encoding | Inject into material table |

Material handling: CSG operations internally track both distance and color simultaneously, selecting the color from the branch with the smallest distance. Transparent to the LLM.

## Error Handling

- Transpilation failure: display error message
- Shader compilation failure: display GLSL error
- Preserve the last successful render — viewport is never cleared on error
- Generated code is editable; user can manually tweak and re-render

## MVP Scope

First version goal: complete `prompt → SDF → render` pipeline.
