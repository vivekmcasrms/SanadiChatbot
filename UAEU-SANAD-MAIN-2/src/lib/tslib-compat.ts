/**
 * pdf-lib 1.x mixes default CommonJS and named ESM imports from tslib.
 * The Worker bundler needs one module that deliberately exposes both shapes.
 */
import * as tslib from "tslib/tslib.es6.mjs";

export * from "tslib/tslib.es6.mjs";
export default tslib;