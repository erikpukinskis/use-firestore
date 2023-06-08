const path = require("path")

module.exports = {
  mode: "development",
  entry: "./lib/index.ts",
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  devtool: "inline-source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    library: {
      name: "UseFirestore",
      type: "umd",
    },
  },
  externals: ["firebase", "react"],
}
