declare module "tslib/tslib.es6.mjs" {
  export * from "tslib";
  const tslib: typeof import("tslib");
  export default tslib;
}