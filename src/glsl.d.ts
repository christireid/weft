/**
 * Shader chunks import as strings, resolved by vite-plugin-glsl with #include
 * expansion. Declared here so the type checker and the editor agree with the
 * bundler about what a .glsl import is.
 */
declare module '*.glsl' {
  const source: string;
  export default source;
}
declare module '*.vert' {
  const source: string;
  export default source;
}
declare module '*.frag' {
  const source: string;
  export default source;
}
