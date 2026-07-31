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

_Not yet selected. It will be a CC0 macro photograph (botanical or mineral) and its source,
photographer and licence will be recorded here before it is committed. Until then there is
no photograph in this repository._

---

## Libraries

`three` · `@react-three/fiber` · `@react-three/drei` · `@react-three/postprocessing` ·
`postprocessing` · `lenis` · `gsap` · `zustand` · `react` — see `package.json` for pinned
versions and each project's own licence.

`leva` is a development dependency and is tree-shaken out of the production bundle (§5.1).

---

\* Bodoni Moda's upstream repository credits indestructible type* for the revival; the
design derives from Giambattista Bodoni's late-18th-century originals.
