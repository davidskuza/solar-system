/**
 * Smooth orbital + cinematic focus camera for raw WebGL.
 */
import { clamp, damp, mat4, vec3 } from './math.js';

export class CameraController {
  constructor() {
    this.mode = 'overview'; // 'overview' | 'focus'
    this.focusedId = null;

    // Current interpolated spherical coordinates
    this.target = vec3.create(0, 0, 0);
    this.yaw = 0.65;
    this.pitch = 0.48;
    this.distance = 225;
    this.frustumOffsetX = 0;
    this.frustumOffsetY = 0;

    // Desired spherical coordinates
    this.desiredTarget = vec3.create(0, 0, 0);
    this.desiredYaw = 0.65;
    this.desiredPitch = 0.48;
    this.desiredDistance = 225;
    this.desiredFrustumOffsetX = 0;
    this.desiredFrustumOffsetY = 0;
    this.panelCollapsed = false;

    // Saved overview state to restore when closing planet description
    this.savedOverview = {
      yaw: 0.65,
      pitch: 0.48,
      distance: 225,
    };

    this.fovRad = (45 * Math.PI) / 180;
    this.near = 0.1;
    this.far = 1800;
    this.aspect = 16 / 9;

    // Output matrices & vectors
    this.position = vec3.create();
    this.right = vec3.create(1, 0, 0);
    this.up = vec3.create(0, 1, 0);
    this.view = mat4.create();
    this.viewNoTranslate = mat4.create();
    this.projection = mat4.create();
    this.viewProj = mat4.create();
    this.invViewProj = mat4.create();

    this._minDist = 14;
    this._maxDist = 280;
    this._focusRadius = 1.0;
    this._transitionElapsed = 1.0;
    this._transitionDuration = 1.05;
    this._transitionStartTarget = vec3.create(0, 0, 0);
  }

  setAspect(width, height) {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this._updateFrustumOffsets(width);
  }

  setPanelCollapsed(collapsed, viewportWidth) {
    this.panelCollapsed = collapsed;
    this._updateFrustumOffsets(viewportWidth);
  }

  _updateFrustumOffsets(width) {
    if (this.mode !== 'focus') {
      this.desiredFrustumOffsetX = 0.0;
      this.desiredFrustumOffsetY = 0.0;
      return;
    }
    this.desiredFrustumOffsetX = width >= 900 ? 0.23 : 0.0;
    this.desiredFrustumOffsetY = width < 900 && !this.panelCollapsed ? 0.25 : 0.0;
  }

  focusBody(body, worldPos, viewportWidth) {
    if (this.mode === 'overview') {
      this.savedOverview = {
        yaw: this.desiredYaw,
        pitch: this.desiredPitch,
        distance: this.desiredDistance,
      };
    }

    this.mode = 'focus';
    this.focusedId = body.id;
    this._focusRadius = body.radius;
    this._minDist = body.isSpacecraft ? 0.25 : Math.max(body.radius * 1.55, 0.7);
    this._maxDist = body.isSpacecraft ? 6.0 : Math.max(body.radius * 14.0, 22.0);
    this._transitionElapsed = 0;
    this._transitionDuration = 1.05;
    vec3.copy(this._transitionStartTarget, this.target);

    // Choose a flattering sunlit 3/4 angle
    if (body.id === 'sun') {
      this.desiredPitch = 0.22;
      this.desiredYaw = this.yaw;
    } else if (body.isSpacecraft) {
      const planetToSunAngle = Math.atan2(-worldPos[0], -worldPos[2]);
      const targetYaw = planetToSunAngle + 0.65;
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.desiredYaw = this.yaw + diff;
      this.desiredPitch = 0.42;
    } else {
      // Direction from planet back toward the Sun so the sunlit hemisphere faces the camera
      const planetToSunAngle = Math.atan2(-worldPos[0], -worldPos[2]);
      // Offset ~45 deg to showcase the sunlit globe, twilight terminator, and night side
      const targetYaw = planetToSunAngle + 0.82;
      // Pick closest equivalent angle to avoid spinning 360 degrees
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.desiredYaw = this.yaw + diff;
      this.desiredPitch = body.ringTexture ? 0.34 : 0.24;
    }

    const portraitScale =
      this.aspect < 0.7 ? 1.18 : 1.0;
    this.desiredDistance = (body.focusDistance || body.radius * 3.8) * portraitScale;
    vec3.copy(this.desiredTarget, worldPos);
    this._updateFrustumOffsets(viewportWidth);
  }

  returnToOverview() {
    this.mode = 'overview';
    this.focusedId = null;
    this.panelCollapsed = false;
    this._minDist = 14;
    this._maxDist = 360;
    this._transitionElapsed = 0;
    this._transitionDuration = 1.05;
    vec3.copy(this._transitionStartTarget, this.target);

    vec3.set(this.desiredTarget, 0, 0, 0);
    this.desiredYaw = this.savedOverview.yaw;
    this.desiredPitch = this.savedOverview.pitch;
    // Always zoom out cleanly to show the full solar system
    this.desiredDistance = clamp(Math.max(this.savedOverview.distance, 200), 160, 320);
    this.desiredFrustumOffsetX = 0.0;
    this.desiredFrustumOffsetY = 0.0;
  }

  rotateBy(deltaYaw, deltaPitch) {
    this.desiredYaw += deltaYaw;
    this.desiredPitch = clamp(this.desiredPitch + deltaPitch, -1.42, 1.42);
  }

  zoomBy(scaleFactor) {
    this.desiredDistance = clamp(this.desiredDistance * scaleFactor, this._minDist, this._maxDist);
  }

  update(dt, focusedWorldPos = null) {
    const safeDt = Math.min(dt, 0.05);

    if (this.mode === 'focus' && focusedWorldPos) {
      vec3.copy(this.desiredTarget, focusedWorldPos);
    }

    const orbitLambda = 7.5;
    const distLambda = 5.4;

    this.yaw = damp(this.yaw, this.desiredYaw, orbitLambda, safeDt);
    this.pitch = damp(this.pitch, this.desiredPitch, orbitLambda, safeDt);
    this.distance = damp(this.distance, this.desiredDistance, distLambda, safeDt);
    this.frustumOffsetX = damp(this.frustumOffsetX, this.desiredFrustumOffsetX, 5.5, safeDt);
    this.frustumOffsetY = damp(this.frustumOffsetY, this.desiredFrustumOffsetY, 5.5, safeDt);

    if (this._transitionElapsed < this._transitionDuration) {
      this._transitionElapsed = Math.min(this._transitionDuration, this._transitionElapsed + safeDt);
      const u = this._transitionElapsed / this._transitionDuration;
      // Smooth quintic ease-in-out
      const ease = u < 0.5 ? 16 * u * u * u * u * u : 1 - Math.pow(-2 * u + 2, 5) / 2;
      vec3.lerp(this.target, this._transitionStartTarget, this.desiredTarget, ease);
    } else {
      vec3.copy(this.target, this.desiredTarget);
    }

    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    const offsetX = this.distance * cosPitch * sinYaw;
    const offsetY = this.distance * sinPitch;
    const offsetZ = this.distance * cosPitch * cosYaw;

    vec3.set(
      this.position,
      this.target[0] + offsetX,
      this.target[1] + offsetY,
      this.target[2] + offsetZ
    );

    const worldUp = [0, 1, 0];
    mat4.lookAt(this.view, this.position, this.target, worldUp);

    // Extract camera right and up vectors from view matrix for billboards
    vec3.set(this.right, this.view[0], this.view[4], this.view[8]);
    vec3.set(this.up, this.view[1], this.view[5], this.view[9]);

    mat4.copy(this.viewNoTranslate, this.view);
    this.viewNoTranslate[12] = 0;
    this.viewNoTranslate[13] = 0;
    this.viewNoTranslate[14] = 0;

    const activeNear = this.mode === 'focus' && this._focusRadius < 0.35 ? 0.02 : 0.1;
    // Adapt vertical FOV on narrow portrait viewports (iOS/mobile) so horizontal framing stays wide
    const effectiveFov =
      this.aspect < 1.0
        ? 2 * Math.atan(Math.tan(this.fovRad * 0.5) / Math.max(0.5, this.aspect * 1.12))
        : this.fovRad;
    mat4.perspective(this.projection, effectiveFov, this.aspect, activeNear, this.far);
    // Apply subtle frustum shift so drawer/bottom-sheet never covers the focused body
    this.projection[8] += this.frustumOffsetX;
    this.projection[9] -= this.frustumOffsetY;

    mat4.multiply(this.viewProj, this.projection, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
  }
}
