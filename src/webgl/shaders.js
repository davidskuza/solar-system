/**
 * Raw WebGL2 (GLSL ES 3.00) shaders for the Solar System visualization.
 */

export const SKYBOX_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uViewNoTranslate;
uniform mat4 uProjection;

out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  vec4 pos = uProjection * uViewNoTranslate * vec4(aPosition * 600.0, 1.0);
  gl_Position = pos.xyww;
}
`;

export const SKYBOX_FS = `#version 300 es
precision highp float;

in vec2 vTexCoord;
uniform sampler2D uSkyboxMap;

out vec4 fragColor;

void main() {
  vec3 tex = texture(uSkyboxMap, vTexCoord).rgb;
  // Reveal rich Milky Way dust lanes while keeping deep space dark
  vec3 col = pow(tex, vec3(1.12)) * 1.18;
  fragColor = vec4(col, 1.0);
}
`;

export const STAR_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
layout(location = 3) in float aPhase;

uniform mat4 uViewNoTranslate;
uniform mat4 uProjection;
uniform float uTime;
uniform float uPixelRatio;

out vec3 vColor;
out float vTwinkle;

void main() {
  vColor = aColor;
  vTwinkle = 0.75 + 0.25 * sin(uTime * 1.4 + aPhase);
  vec4 pos = uProjection * uViewNoTranslate * vec4(aPosition, 1.0);
  gl_Position = pos.xyww;
  gl_PointSize = aSize * uPixelRatio;
}
`;

export const STAR_FS = `#version 300 es
precision highp float;

in vec3 vColor;
in float vTwinkle;

out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float alpha = exp(-r2 * 18.0) * vTwinkle;
  fragColor = vec4(vColor * alpha * 1.35, alpha);
}
`;

export const SUN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vTexCoord;
out vec3 vLocalPos;

void main() {
  vLocalPos = aPosition;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vTexCoord = aTexCoord;
  gl_Position = uViewProj * world;
}
`;

export const SUN_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vTexCoord;
in vec3 vLocalPos;

uniform sampler2D uSunMap;
uniform vec3 uCameraPos;
uniform float uTime;
uniform float uHover;

out vec4 fragColor;

// Compact 3D value noise for animated solar granulation
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.05 + vec3(13.1, 7.7, 5.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  float ndotv = clamp(dot(N, V), 0.0, 1.0);

  // Subtle plasma convection warping
  float flow = fbm(vLocalPos * 4.5 + vec3(uTime * 0.08, -uTime * 0.05, uTime * 0.06));
  vec2 warpedUV = vTexCoord + vec2((flow - 0.5) * 0.018, (flow - 0.5) * 0.012);
  vec3 base = texture(uSunMap, warpedUV).rgb;

  // Limb darkening + hot coronal rim
  float limb = pow(ndotv, 0.45);
  float rimFlare = pow(1.0 - ndotv, 3.2);

  vec3 coreColor = base * (1.28 + 0.42 * flow) * mix(0.68, 1.22, limb);
  vec3 rimColor = vec3(1.0, 0.48, 0.12) * rimFlare * 1.45;
  vec3 hoverTint = vec3(1.0, 0.9, 0.6) * rimFlare * uHover * 0.65;

  fragColor = vec4(coreColor + rimColor + hoverTint, 1.0);
}
`;

export const CORONA_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuadPos;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uViewProj;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uScale;

out vec2 vUV;

void main() {
  vUV = aTexCoord * 2.0 - 1.0;
  vec3 worldPos = (uCameraRight * aQuadPos.x + uCameraUp * aQuadPos.y) * uScale;
  gl_Position = uViewProj * vec4(worldPos, 1.0);
}
`;

export const CORONA_FS = `#version 300 es
precision highp float;

in vec2 vUV;
uniform float uTime;

out vec4 fragColor;

void main() {
  float r = length(vUV);
  if (r > 1.0) discard;

  float angle = atan(vUV.y, vUV.x);
  float rays = 0.86
    + 0.08 * sin(angle * 7.0 + uTime * 0.35)
    + 0.06 * sin(angle * 13.0 - uTime * 0.5);

  float innerGlow = exp(-r * 4.8) * 1.35;
  float outerHalo = pow(max(0.0, 1.0 - r), 3.4) * 0.48 * rays;
  float intensity = innerGlow + outerHalo;

  vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.85, 0.55), exp(-r * 3.5));
  fragColor = vec4(col * intensity, clamp(intensity, 0.0, 1.0));
}
`;

export const PLANET_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uNormalMatrix;
uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uNormalMatrix) * aNormal);
  vTexCoord = aTexCoord;
  gl_Position = uViewProj * world;
}
`;

export const PLANET_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vTexCoord;

uniform sampler2D uDiffuseMap;
uniform sampler2D uNightMap;
uniform sampler2D uRingShadowMap;

uniform vec3 uCameraPos;
uniform vec3 uSunPos;

uniform int uIsEarth;
uniform int uHasAtmosphere;
uniform vec3 uAtmoColor;
uniform float uAtmoIntensity;
uniform float uAtmoPower;
uniform float uSpecularStrength;
uniform float uHover;

// Ring shadow parameters (Saturn)
uniform int uReceivesRingShadow;
uniform mat4 uPlanetInvTransform;
uniform float uRingInner;
uniform float uRingOuter;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L + V);

  vec3 albedo = texture(uDiffuseMap, vTexCoord).rgb;
  float ndotl = dot(N, L);
  // Soft atmospheric terminator wrap
  float wrap = uHasAtmosphere == 1 ? 0.08 : 0.02;
  float diffuse = clamp((ndotl + wrap) / (1.0 + wrap), 0.0, 1.0);
  // Smooth falloff near terminator
  diffuse = pow(diffuse, 0.92);

  // Analytical ring shadow onto planet (e.g., Saturn's rings casting bands on Saturn)
  float shadowFactor = 1.0;
  if (uReceivesRingShadow == 1 && ndotl > 0.0) {
    vec3 localPos = (uPlanetInvTransform * vec4(vWorldPos, 1.0)).xyz;
    vec3 localDir = normalize((uPlanetInvTransform * vec4(L, 0.0)).xyz);
    if (abs(localDir.y) > 1e-4) {
      float t = -localPos.y / localDir.y;
      if (t > 0.0) {
        vec3 hit = localPos + localDir * t;
        float dist = length(hit.xz);
        if (dist > uRingInner && dist < uRingOuter) {
          float u = (dist - uRingInner) / (uRingOuter - uRingInner);
          float ringAlpha = texture(uRingShadowMap, vec2(u, 0.5)).a;
          shadowFactor = 1.0 - ringAlpha * 0.72;
        }
      }
    }
  }

  // Specular highlights (stronger on Earth's oceans)
  float specMask = uSpecularStrength;
  if (uIsEarth == 1) {
    // Detect ocean blue vs land/ice from daymap chroma
    float oceanLikelihood = clamp((albedo.b - max(albedo.r, albedo.g) * 0.85) * 4.5, 0.0, 1.0);
    specMask = mix(0.03, uSpecularStrength, oceanLikelihood);
  }
  float shininess = uIsEarth == 1 ? 42.0 : 16.0;
  float spec = pow(max(dot(N, H), 0.0), shininess) * specMask * smoothstep(-0.05, 0.25, ndotl);

  // Ambient cosmic bounce so dark side silhouettes remain subtly readable
  vec3 ambient = albedo * vec3(0.055, 0.068, 0.095);
  vec3 litColor = albedo * (diffuse * shadowFactor * 1.18) + vec3(1.0, 0.97, 0.92) * spec * shadowFactor;

  // Earth night city lights on unlit hemisphere
  if (uIsEarth == 1) {
    vec3 nightLights = texture(uNightMap, vTexCoord).rgb;
    float nightMask = smoothstep(0.12, -0.22, ndotl);
    litColor += nightLights * nightMask * vec3(1.15, 0.95, 0.72) * 1.1;
  }

  vec3 color = ambient + litColor;

  // Atmospheric Fresnel limb scattering
  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  if (uHasAtmosphere == 1) {
    float fresnel = pow(1.0 - ndotv, uAtmoPower);
    float sunFacing = smoothstep(-0.35, 0.55, ndotl);
    float twilight = exp(-pow(ndotl * 3.5, 2.0)) * 0.35;
    vec3 atmoGlow = uAtmoColor * fresnel * uAtmoIntensity * (sunFacing + twilight);
    color += atmoGlow;
  }

  // Subtle hover selection rim
  if (uHover > 0.001) {
    float hoverRim = pow(1.0 - ndotv, 2.6) * uHover;
    color += vec3(0.45, 0.82, 1.0) * hoverRim * 0.75;
  }

  fragColor = vec4(color, 1.0);
}
`;

export const CLOUD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uNormalMatrix;
uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uNormalMatrix) * aNormal);
  vTexCoord = aTexCoord;
  gl_Position = uViewProj * world;
}
`;

export const CLOUD_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vTexCoord;

uniform sampler2D uCloudMap;
uniform vec3 uSunPos;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  float cloudDensity = texture(uCloudMap, vTexCoord).r;
  float ndotl = dot(N, L);
  float light = smoothstep(-0.18, 0.35, ndotl);
  float alpha = smoothstep(0.18, 0.88, cloudDensity) * 0.78 * mix(0.08, 1.0, light);
  if (alpha < 0.01) discard;
  vec3 col = mix(vec3(0.18, 0.24, 0.36), vec3(1.0, 0.99, 0.97), light);
  fragColor = vec4(col, alpha);
}
`;

export const RING_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec2 vTexCoord;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vTexCoord = aTexCoord;
  gl_Position = uViewProj * world;
}
`;

export const RING_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec2 vTexCoord;

uniform sampler2D uRingMap;
uniform vec3 uSunPos;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform vec4 uRingTint;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uRingMap, vec2(vTexCoord.x, 0.5));
  float alpha = tex.a * uRingTint.a;
  if (alpha < 0.01) discard;

  // Analytical ray-sphere intersection to cast planet's shadow onto its rings
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 oc = vWorldPos - uPlanetCenter;
  float b = dot(oc, L);
  float c = dot(oc, oc) - uPlanetRadius * uPlanetRadius;
  float disc = b * b - c;

  float shadow = 1.0;
  if (disc > 0.0) {
    float t = -b - sqrt(disc);
    if (t > 0.0) {
      float edge = clamp(disc / (uPlanetRadius * uPlanetRadius), 0.0, 1.0);
      shadow = mix(1.0, 0.08, smoothstep(0.0, 0.16, edge));
    }
  }

  vec3 col = tex.rgb * uRingTint.rgb * mix(0.12, 1.15, shadow);
  fragColor = vec4(col, alpha);
}
`;

export const ASTEROID_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aOrbitData;   // radius, initialAngle, speed, yOffset
layout(location = 3) in vec4 aVisualData;  // scale, tumbleSpeed, shade, phase

uniform mat4 uViewProj;
uniform float uTime;

out vec3 vWorldPos;
out vec3 vNormal;
out float vShade;

mat3 rotateY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

mat3 rotateX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

void main() {
  float angle = aOrbitData.y + uTime * aOrbitData.z;
  vec3 center = vec3(
    cos(angle) * aOrbitData.x,
    aOrbitData.w,
    sin(angle) * aOrbitData.x
  );

  float tumble = aVisualData.w + uTime * aVisualData.y;
  mat3 rot = rotateY(tumble) * rotateX(tumble * 0.7);
  vec3 local = rot * (aPosition * aVisualData.x);

  vWorldPos = center + local;
  vNormal = normalize(rot * aNormal);
  vShade = aVisualData.z;
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}
`;

export const ASTEROID_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in float vShade;

uniform vec3 uSunPos;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  float diff = max(dot(N, L), 0.0);
  vec3 rock = vec3(0.48, 0.44, 0.40) * vShade;
  vec3 col = rock * (0.06 + diff * 1.05);
  fragColor = vec4(col, 1.0);
}
`;

export const ORBIT_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aAngle;

uniform mat4 uModel;
uniform mat4 uViewProj;

out float vAngle;

void main() {
  vAngle = aAngle;
  gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
}
`;

export const ORBIT_FS = `#version 300 es
precision highp float;

in float vAngle;

uniform vec3 uColor;
uniform float uPlanetAngle;
uniform float uHighlight;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  // Brighten trailing arc behind the planet's current position
  float diff = mod(uPlanetAngle - vAngle + 6.2831853, 6.2831853);
  float trail = exp(-diff * 1.15);
  float baseAlpha = mix(0.14, 0.55, trail);
  float alpha = clamp((baseAlpha + uHighlight * 0.42) * uOpacity, 0.0, 0.92);
  vec3 col = mix(uColor * 0.65, uColor * 1.35, max(trail, uHighlight));
  fragColor = vec4(col, alpha);
}
`;

export const POST_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;

out vec2 vUV;

void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BRIGHT_FS = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uSceneTex;

out vec4 fragColor;

void main() {
  vec3 col = texture(uSceneTex, vUV).rgb;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float soft = smoothstep(0.82, 1.35, lum);
  fragColor = vec4(col * soft, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDirection;

out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uTex, 0));
  vec2 stepUV = texel * uDirection;

  vec3 res = texture(uTex, vUV).rgb * 0.227027;
  res += texture(uTex, vUV + stepUV * 1.384615).rgb * 0.316216;
  res += texture(uTex, vUV - stepUV * 1.384615).rgb * 0.316216;
  res += texture(uTex, vUV + stepUV * 3.230769).rgb * 0.070270;
  res += texture(uTex, vUV - stepUV * 3.230769).rgb * 0.070270;

  fragColor = vec4(res, 1.0);
}
`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uSceneTex;
uniform sampler2D uBloomTex;
uniform float uBloomStrength;

out vec4 fragColor;

vec3 acesFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 scene = texture(uSceneTex, vUV).rgb;
  vec3 bloom = texture(uBloomTex, vUV).rgb;
  vec3 hdr = scene + bloom * uBloomStrength;

  // Subtle optical vignette
  vec2 centered = vUV - 0.5;
  float vignette = 1.0 - dot(centered, centered) * 0.35;
  hdr *= vignette;

  vec3 mapped = acesFilm(hdr * 1.05);
  // Subtle gamma lift for rich space contrast
  vec3 finalCol = pow(mapped, vec3(1.0 / 1.08));
  fragColor = vec4(finalCol, 1.0);
}
`;

export const ISS_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aMatType;

uniform mat4 uModel;
uniform mat4 uNormalMatrix;
uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vLocalPos;
out vec3 vNormal;
out vec3 vColor;
out float vMatType;

void main() {
  vLocalPos = aPosition;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uNormalMatrix) * aNormal);
  vColor = aColor;
  vMatType = aMatType;
  gl_Position = uViewProj * world;
}
`;

export const ISS_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vLocalPos;
in vec3 vNormal;
in vec3 vColor;
in float vMatType;

uniform vec3 uCameraPos;
uniform vec3 uSunPos;
uniform vec3 uEarthPos;
uniform float uHover;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L + V);

  vec3 base = vColor;
  float shininess = 24.0;
  float specStrength = 0.35;

  // Solar array cell grid & warm copper-gold/blue sheen
  if (vMatType > 1.5) {
    float gridX = smoothstep(0.86, 0.96, abs(sin(vLocalPos.x * 210.0)));
    float gridZ = smoothstep(0.88, 0.97, abs(sin(vLocalPos.z * 140.0)));
    float grid = max(gridX, gridZ);
    base = mix(vec3(0.11, 0.20, 0.42), vec3(0.68, 0.50, 0.22), grid * 0.65);
    shininess = 72.0;
    specStrength = 0.85;
  } else if (vMatType > 0.5) {
    // Metallic truss
    shininess = 48.0;
    specStrength = 0.55;
  }

  float sunDiff = max(dot(N, L), 0.0);
  float sunSpec = pow(max(dot(N, H), 0.0), shininess) * specStrength * smoothstep(-0.05, 0.2, dot(N, L));

  // Subtle blue Earthshine fill light from Earth below
  vec3 E = normalize(uEarthPos - vWorldPos);
  float earthBounce = max(dot(N, E), 0.0) * 0.24;

  vec3 col = base * (0.09 + sunDiff * 1.25)
           + base * vec3(0.35, 0.62, 1.0) * earthBounce
           + vec3(1.0, 0.96, 0.88) * sunSpec;

  if (uHover > 0.001) {
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2) * uHover;
    col += vec3(0.42, 0.95, 1.0) * rim * 0.8;
  }

  fragColor = vec4(col, 1.0);
}
`;

