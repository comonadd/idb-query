const webpack = require("webpack");
const path = require("path");

const DEV = process.env.NODE_ENV === "development";
const SRC = path.resolve(__dirname, "src");
const BUILD = path.resolve(__dirname, "build");

module.exports = {
  mode: DEV ? "development" : "production",
  entry: {
    "idb-orm": path.resolve(SRC, "orm.ts"),
  },
  output: {
    path: BUILD,
    filename: "[name].min.js", // string (default)
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: [SRC],
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    modules: ["node_modules", SRC],
    extensions: [".ts"],
    alias: {
      "~": SRC,
    },
  },
  devtool: "source-map",
  context: __dirname,
  target: "web",
  plugins: [],
};
