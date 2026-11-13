# Solar System Observatory (Raw WebGL2 + Plain JavaScript)

An interactive 3D Solar System visualization built from scratch using **plain ES-module JavaScript** and **raw WebGL2** — with zero 3D libraries or frameworks.

## Features

- **Raw WebGL2 Rendering Pipeline**: Custom GLSL ES 3.00 shaders for animated solar granulation, sunlit planetary atmospheres (Fresnel Rayleigh rim glow), Earth day/night city lights + ocean specular + drifting cloud deck, analytical Saturn ring shadows & planet-on-ring penumbra shadows, a procedural 3D **International Space Station (ISS)** in 51.6° Low Earth Orbit with Earthshine lighting, 1,500 instanced 3D rocky asteroids, 4,200 spectral twinkling stars, and an HDR bloom + ACES filmic tone-mapping post-processing pipeline.
- **Interactive Click-to-Inspect Camera**:
  - Click any planet, the Sun, Earth's Moon, or the **ISS** directly in 3D space (ray-sphere picking), via floating 3D-projected labels, or via the bottom quick-navigation bar.
  - Smoothly glides and zooms in to frame the selected body at a sunlit ¾ angle while sliding open a detailed astronomical dossier.
  - Closing the panel (`✕`, **Return to Full Solar System**, or `Esc`) smoothly zooms back out to view the entire Solar System.
- **Simulation & Audio Controls**:
  - Pause/resume (`Space`) and time-scale presets (`0.3×`, `1×`, `4×`, `12×`).
  - Toggle orbital trails and 3D labels.
  - Integrated ambient space soundtrack with play/pause and volume controls.

## Running Locally

Because browsers restrict loading local WebGL textures and ES modules over `file://`, serve the directory with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in a modern browser.

## Credits & Licenses

- **Planetary & Starfield Textures**: [Solar System Scope](https://www.solarsystemscope.com/textures/) (derived from NASA imagery), licensed under **CC BY 4.0**.
- **Ambient Soundtrack**: *"Ambiment"* by Kevin MacLeod ([incompetech.com](https://incompetech.com/)), licensed under **Creative Commons: By Attribution 4.0**.
