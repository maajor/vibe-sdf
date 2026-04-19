// GLSL shader chunks for ray marching SDF renderer

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export const sdfPrimitives = /* glsl */ `
// Material ID encoding: integer part = material index
// Distance is stored as the float value, material ID encoded separately

struct SdfResult {
  float dist;
  float matId;
};

SdfResult makeSdf(float d, float m) {
  SdfResult r;
  r.dist = d;
  r.matId = m;
  return r;
}

// === Primitives ===

SdfResult sdSphere(vec3 p, float r, float matId) {
  return makeSdf(length(p) - r, matId);
}

SdfResult sdBox(vec3 p, vec3 b, float matId) {
  vec3 q = abs(p) - b;
  return makeSdf(length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0), matId);
}

SdfResult sdRoundedBox(vec3 p, vec3 b, float r, float matId) {
  vec3 q = abs(p) - b + r;
  return makeSdf(length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r, matId);
}

SdfResult sdTorus(vec3 p, vec2 t, float matId) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return makeSdf(length(q) - t.y, matId);
}

SdfResult sdCapsule(vec3 p, vec3 a, vec3 b, float r, float matId) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return makeSdf(length(pa - ba * h) - r, matId);
}

SdfResult sdCylinder(vec3 p, float h, float r, float matId) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return makeSdf(min(max(d.x, d.y), 0.0) + length(max(d, 0.0)), matId);
}

SdfResult sdCone(vec3 p, float h, float r, float matId) {
  // iq's sdCone, tip at origin, base at y=-h with radius r
  vec2 q = h * vec2(r / h, -1.0);
  vec2 w = vec2(length(p.xz), p.y);
  vec2 a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
  vec2 b = w - q * vec2(clamp(w.x / q.x, 0.0, 1.0), 1.0);
  float k = sign(q.y);
  float d = min(dot(a, a), dot(b, b));
  float s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
  return makeSdf(sqrt(d) * sign(s), matId);
}

SdfResult sdPlane(vec3 p, vec3 n, float matId) {
  return makeSdf(dot(p, n), matId);
}

// === Rotation helpers ===

vec3 opRotateX(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z);
}

vec3 opRotateY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
}

vec3 opRotateZ(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z);
}

// === CSG Operations ===
// Color is inherited from the branch with smallest distance

SdfResult opUnion(SdfResult a, SdfResult b) {
  if (a.dist < b.dist) return a;
  return b;
}

SdfResult opSmoothUnion(SdfResult a, SdfResult b, float k) {
  float h = clamp(0.5 + 0.5*(b.dist - a.dist)/k, 0.0, 1.0);
  float d = mix(b.dist, a.dist, h) - k*h*(1.0-h);
  float m = mix(b.matId, a.matId, step(0.5, h));
  return makeSdf(d, m);
}

SdfResult opSubtract(SdfResult a, SdfResult b) {
  float d = max(a.dist, -b.dist);
  float m = a.matId;
  return makeSdf(d, m);
}

SdfResult opSmoothSubtract(SdfResult a, SdfResult b, float k) {
  float h = clamp(0.5 - 0.5*(b.dist + a.dist)/k, 0.0, 1.0);
  float d = mix(a.dist, -b.dist, h) + k*h*(1.0-h);
  return makeSdf(d, a.matId);
}

SdfResult opIntersect(SdfResult a, SdfResult b) {
  float d = max(a.dist, b.dist);
  float m = a.dist > b.dist ? a.matId : b.matId;
  return makeSdf(d, m);
}

SdfResult opSmoothIntersect(SdfResult a, SdfResult b, float k) {
  float h = clamp(0.5 - 0.5*(b.dist - a.dist)/k, 0.0, 1.0);
  float d = mix(a.dist, b.dist, h) + k*h*(1.0-h);
  float m = mix(a.matId, b.matId, step(0.5, h));
  return makeSdf(d, m);
}
`;

export const rayMarchingFooter = /* glsl */ `
// === Normal calculation ===
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy).x - map(p - e.xyy).x,
    map(p + e.yxy).x - map(p - e.yxy).x,
    map(p + e.yyx).x - map(p - e.yyx).x
  ));
}

// === Soft shadow ===
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 64; i++) {
    float h = map(ro + rd * t).x;
    if (h < 0.001) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.01, 0.2);
    if (t > maxt) break;
  }
  return clamp(res, 0.0, 1.0);
}

// === Ambient Occlusion ===
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = map(p + h * n).x;
    occ += (h - d) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

// === Ray Marching ===
vec2 rayMarch(vec3 ro, vec3 rd, out vec3 outNormal, out float outMatId) {
  float t = 0.0;
  for (int i = 0; i < 200; i++) {
    vec3 p = ro + rd * t;
    vec2 res = map(p);
    if (res.x < 0.001) {
      outNormal = calcNormal(p);
      outMatId = res.y;
      return vec2(t, 1.0);
    }
    t += res.x;
    if (t > 100.0) break;
  }
  return vec2(t, 0.0);
}

// === Camera ray ===
mat3 setCamera(vec3 ro, vec3 ta) {
  vec3 cw = normalize(ta - ro);
  vec3 cp = vec3(0.0, 1.0, 0.0);
  vec3 cu = normalize(cross(cw, cp));
  vec3 cv = cross(cu, cw);
  return mat3(cu, cv, cw);
}

// === Material colors ===
vec3 getMaterialColor(float matId) {
  // Built-in materials
  MATERIAL_COLOR_TABLE
  return vec3(1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

  // Camera
  vec3 ro = uCameraPos;
  vec3 ta = vec3(0.0);
  mat3 ca = setCamera(ro, ta);

  vec3 rd = ca * normalize(vec3(uv, 1.5));

  // March
  vec3 normal;
  float matId;
  vec2 hit = rayMarch(ro, rd, normal, matId);

  vec3 col = vec3(0.05, 0.05, 0.08); // background

  if (hit.y > 0.5) {
    vec3 p = ro + rd * hit.x;
    vec3 matCol = getMaterialColor(matId);

    // Lighting
    vec3 lightDir = normalize(vec3(0.8, 1.2, 0.6));
    vec3 lightDir2 = normalize(vec3(-0.5, 0.3, -0.8));

    // Diffuse
    float diff = max(dot(normal, lightDir), 0.0);
    float diff2 = max(dot(normal, lightDir2), 0.0);

    // Specular
    vec3 halfDir = normalize(lightDir - rd);
    float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);

    // Shadow and AO
    float sha = softShadow(p + normal * 0.01, lightDir, 0.02, 25.0, 12.0);
    float ao = calcAO(p, normal);

    // Combine
    vec3 ambient = vec3(0.15, 0.17, 0.2) * ao;
    col = matCol * (ambient + diff * sha * vec3(1.0, 0.95, 0.9) * 0.7
                  + diff2 * vec3(0.2, 0.25, 0.35) * 0.3)
        + spec * sha * vec3(0.4, 0.4, 0.35);
  }

  // Tone mapping
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildFragmentShader(userMapFunction: string, materialColorTable: string): string {
  console.log('[shader] Assembling fragment shader with user map function and material table');
  const uniforms = /* glsl */ `
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCameraPos;

${sdfPrimitives}

${userMapFunction}

`;
  const fullShader = uniforms + rayMarchingFooter.replace('MATERIAL_COLOR_TABLE', materialColorTable);
  console.log('[shader] Final shader length:', fullShader.length, 'chars');
  return fullShader;
}
