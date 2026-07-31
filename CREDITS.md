# CREDITS

Every borrowed technique and every third-party asset in WEFT.

Per §0.4: no unlicensed imagery. Every pixel shipped is either procedurally generated or
carries a licence recorded here.

---

## Typefaces

All three are self-hosted from the Fontsource distributions of the upstream releases, latin
subset only. See `src/styles/fonts.css` and `tools/sync-fonts.mjs`.

| Face                                                     | Designer                        | Licence                   |
| -------------------------------------------------------- | ------------------------------- | ------------------------- |
| **Bodoni Moda** (variable, `opsz` 6–96 · `wght` 400–900) | Owen Earl, indestructible type* | SIL Open Font License 1.1 |
| **Geist** (variable, `wght` 100–900)                     | Vercel                          | SIL Open Font License 1.1 |
| **Geist Mono** (variable, `wght` 100–900)                | Vercel                          | SIL Open Font License 1.1 |

---

## Techniques

Adapted, not copied. Where an implementation was read, the file and lines are recorded in
`RESEARCH.md`.

| Technique                                              | Source                                                                                | Licence / status     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------- |
| Screen-space ribbon expansion with `clip.w` correction | three.js `examples/jsm/lines/LineMaterial.js`                                         | MIT                  |
| GPGPU ping-pong ordering                               | three.js `examples/jsm/misc/GPUComputationRenderer.js`                                | MIT                  |
| Textureless 3D simplex noise                           | `webgl-noise` — Ian McEwan, Ashima Arts; maintained by Stefan Gustavson               | MIT                  |
| Divergence-free curl noise                             | Bridson, Hourihan & Nordenstam, _Curl-Noise for Procedural Fluid Flow_, SIGGRAPH 2007 | Published research   |
| Analytic CIE XYZ colour-matching fit                   | Wyman, Sloan & Shirley, JCGT 2(2), 2013                                               | Published research   |
| Wavelength-dependent IOR                               | Cauchy's equation                                                                     | Public domain (1836) |
| Verlet + constraint-projection cloth                   | Jakobsen, _Advanced Character Physics_, GDC 2001                                      | Published research   |
| Thin-film iridescence                                  | Belcour & Barla, SIGGRAPH 2017                                                        | Published research   |
| 8×8 ordered dither matrix                              | Bayer, 1973                                                                           | Published research   |
| Blue-noise dither rationale                            | Ulichney, _Digital Halftoning_, 1987                                                  | Published research   |
| ACES filmic tone-mapping fit                           | Narkowicz, 2015                                                                       | Public               |
| Radial slit-scan                                       | Trumbull's slit-scan photography, _2001: A Space Odyssey_, 1968                       | Technique, not asset |

---

## Photography

§10 permits exactly one photograph in the entire site: the specimen refracted through the
cloth in Plate IV.

**`public/specimen/gravel.png`** — a macro photograph of gravel. 512×512, greyscale.

| | |
| --- | --- |
| Original | "Gravel 04", ambientCG (formerly CC0Textures) |
| Licence | **CC0 1.0 Universal** — no rights reserved |
| Obtained from | `scikit-image` v0.22.0, `skimage/data/gravel.png` |
| Documented at | `skimage/data/_fetchers.py`, `gravel()` |

Fetched through scikit-image rather than from ambientCG directly because this build sandbox
cannot reach `cdn.struffelproductions.com` — or `upload.wikimedia.org`, or any other image
host. `raw.githubusercontent.com` is the only route out, so the image had to come from a
repository that both hosts the file and documents its provenance in the same tree.
scikit-image does: its `gravel()` docstring names CC0Textures as the source, states the CC0
licence, and records the transformation it applied (rescaled to 1024², top-left 512² cropped,
converted to greyscale uint8). That chain is recorded here in full because a licence claim
with no traceable origin is worth nothing.

The image is used as the specimen refracted through Plate IV's cloth. It is the only
photograph in the site, per §10.

---

## Libraries

`three` · `@react-three/fiber` · `@react-three/drei` · `@react-three/postprocessing` ·
`postprocessing` · `lenis` · `gsap` · `zustand` · `react` — see `package.json` for pinned
versions and each project's own licence.

`leva` is a development dependency and is tree-shaken out of the production bundle (§5.1).

---

\* Bodoni Moda's upstream repository credits indestructible type* for the revival; the
design derives from Giambattista Bodoni's late-18th-century originals.
