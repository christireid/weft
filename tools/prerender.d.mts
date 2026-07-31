/**
 * Types for the prerender plugin. It is authored as .mjs because Vite loads the
 * config through Node before TypeScript is in play, and a .ts plugin imported
 * from vite.config.ts would need its own transform step to exist first.
 */
import type { Plugin } from 'vite';

export declare function renderDocument(root: string): Promise<string>;
export declare function prerenderPlugin(): Plugin;
