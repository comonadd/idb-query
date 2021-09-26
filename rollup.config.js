import path from "path";
import { terser } from "rollup-plugin-terser";
import resolve from "rollup-plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import del from "del";
import typescript from "@rollup/plugin-typescript";

const PROD = process.env.NODE_ENV === "production";
const DEV = !PROD;
const PROFILE = process.env.PROFILE === "1";

export default async function ({ watch }) {
  await del("build");

  const builds = [];

  builds.push({
    plugins: [typescript()],
    input: ["src/orm.ts"],
    output: [
      {
        dir: path.resolve(__dirname, "build"),
        format: "esm",
        entryFileNames: "[name]-esm.js",
        chunkFileNames: "[name]-esm.js",
      },
      {
        dir: path.resolve(__dirname, "build"),
        format: "cjs",
        entryFileNames: "[name]-cjs.js",
        chunkFileNames: "[name]-cjs.js",
      },
      {
        dir: path.resolve(__dirname, "build"),
        format: "iife",
        entryFileNames: "[name]-iife.js",
        chunkFileNames: "[name]-iife.js",
        inlineDynamicImports: true,
      },
    ],
  });

  if (PROFILE) {
    builds.push({
      plugins: [typescript()],
      input: ["test/prof.ts"],
      output: [
        {
          dir: path.resolve(__dirname, "build"),
          format: "iife",
          entryFileNames: "[name]-iife.js",
        },
      ],
    });
  }

  if (PROD) {
    builds.push({
      input: "build/orm-cjs.js",
      plugins: [
        terser({
          compress: { ecma: 2019 },
        }),
      ],
      output: {
        file: "build/orm.min.js",
        format: "iife",
        esModule: false,
        name: "IDBORM",
      },
    });
  }

  return builds;
}
