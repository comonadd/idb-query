module.exports = {
  // preset: "jest-puppeteer",
  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": "ts-jest",
  },
  // setupFilesAfterEnv: ["expect-puppeteer"],
  // testTimeout: 100000,
  // globals: {
  //   "ts-jest": {
  //     tsconfig: "<rootDir>/tsconfig.json",
  //   },
  // },
  transformIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
};
