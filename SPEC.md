# Vibe SDF — 项目规格文档

## 概述

LLM 驱动的 SDF 3D 模型生成器。用户输入自然语言描述，LLM 生成 SDF 代码，系统编译渲染为 3D 结果。

## 架构

```
用户 Prompt → LLM (Vercel AI SDK) → JS SDF 代码 → AST 转译 → GLSL → Ray Marching Shader → WebGL 渲染
```

## 技术栈

- **框架**: Next.js
- **3D 渲染**: Three.js (PlaneGeometry + ShaderMaterial + OrbitControls)
- **LLM**: Vercel AI SDK (支持 OpenAI / Anthropic 等)
- **转译**: @babel/parser + 自定义 AST visitor → GLSL
- **部署**: Vercel
- **语言**: TypeScript

## UI 布局

左右分栏：
- **左**: 用户 API Key 输入 + prompt 输入框 + 生成按钮 + 生成代码预览（可编辑）
- **右**: Three.js 3D 渲染视口（OrbitControls）

## LLM 调用

- 用户自带 API Key（前端输入）
- 通过 Vercel AI SDK 调用，支持多种 provider
- 流式输出

## 渲染管线

1. Three.js 创建 `PlaneGeometry(2, 2)` + `ShaderMaterial`
2. Fragment shader 内执行 ray marching
3. LLM 生成的 `map()` 函数转译后注入 shader
4. 预置代码：法线计算、AO、软阴影、相机射线生成
5. Uniform: `uResolution`, `uTime`, `uCameraPos`, `uCameraMatrix`

## 光照

- 环境光遮蔽 (AO)
- 软阴影
- 不需要 PBR 环境贴图
- 不支持动画（`uTime` 暂不用）

## SDF 语法 API

### 原语

所有原语返回距离值，最后一个参数 `opts?` 为可选对象。

```js
sphere(p, r, opts?)
box(p, b, opts?)                    // b: vec3 半尺寸
roundedBox(p, b, r, opts?)          // b: vec3 半尺寸, r: 圆角半径
torus(p, t, opts?)                  // t: vec2(主半径, 管半径)
capsule(p, a, b, r, opts?)          // a/b: vec3 端点, r: 半径
cylinder(p, h, r, opts?)            // h: 半高, r: 半径
cone(p, h, r, opts?)                // h: 半高, r: 底部半径
plane(p, n, opts?)                  // n: vec3 法线
```

`opts`:
- `color: [r, g, b]` (0-1)，默认 `[1, 1, 1]`
- `rotation: vec3(x, y, z)` 欧拉角，度数

### CSG 操作

```js
union(a, b, k?)          // 并集，k 不传为硬边，传了平滑过渡
subtract(a, b, k?)       // a - b
intersect(a, b, k?)      // 交集
```

`a`/`b` 可以是原语或另一个 CSG 操作的返回值。材质颜色自动取距离最小的分支。

### 空间变换

```js
vec3(x, y, z)
vec2(x, y)
rotateX(p, angle)   // 弧度
rotateY(p, angle)
rotateZ(p, angle)
```

### 数学常量与函数

```js
PI, TAU
sin, cos, tan, atan, atan2, sqrt, pow, abs, min, max, clamp,
floor, ceil, fract, mix, step, smoothstep, mod, length, dot, cross,
normalize, reflect
```

### LLM 需要实现的函数

```js
function map(p) {
  // 返回 CSG 树或单个原语
}
```

### 完整示例：杯子

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

## JS → GLSL 转译

使用 `@babel/parser` 解析 JS AST，自定义 visitor 生成 GLSL：

| JS | GLSL | 处理 |
|---|---|---|
| `function map(p)` | `vec2 map(vec3 p)` | 返回 vec2(distance, materialId) |
| 原语调用 | 内置 GLSL 函数 | 函数映射 |
| `const d1 = expr` | `float d1 = expr` | 类型推断 |
| `Math.sin(x)` | `sin(x)` | Math.* 转换 |
| `vec3(x,y,z)` | `vec3(x,y,z)` | 直接映射 |
| `opts: { color: [...] }` | 材质 ID 编码 | 注入材质表 |

材质处理：CSG 操作内部同时追踪距离和颜色，取距离最小分支的颜色。对 LLM 透明。

## 错误处理

- LLM 生成代码转译失败：显示错误信息
- Shader 编译失败：显示 GLSL 错误
- 保留上一个成功渲染的结果，不会清空视口
- 生成代码可手动编辑后重新渲染

## MVP 范围

第一版目标：跑通 `prompt → SDF → 渲染` 完整链路。
