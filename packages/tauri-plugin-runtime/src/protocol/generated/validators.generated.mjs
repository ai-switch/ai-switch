// Generated from JSON Schema. Do not edit directly.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// ../../node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "../../node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  }
});

// validators.generated.mjs
var validateManifestSchema = validate10;
var schema11 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/manifest.schema.json", "title": "Manifest", "type": "object", "additionalProperties": false, "required": ["manifestVersion", "id", "name", "version", "description", "license", "engines", "entry", "activation", "requires", "optional", "permissions", "contributes"], "properties": { "manifestVersion": { "const": 1 }, "id": { "type": "string", "minLength": 3, "maxLength": 160, "pattern": "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" }, "name": { "type": "string", "minLength": 1, "maxLength": 160 }, "version": { "type": "string", "minLength": 1, "maxLength": 128 }, "description": { "type": "string", "maxLength": 8192 }, "license": { "type": "string", "minLength": 1, "maxLength": 256 }, "engines": { "type": "object", "additionalProperties": false, "required": ["aplg"], "properties": { "aplg": { "$ref": "#/definitions/range" } } }, "entry": { "type": "string", "minLength": 1, "maxLength": 1024 }, "activation": { "const": "view" }, "requires": { "$ref": "#/definitions/capabilityRanges" }, "optional": { "$ref": "#/definitions/capabilityRanges" }, "permissions": { "type": "object", "additionalProperties": false, "required": ["filesystem", "network", "native"], "properties": { "filesystem": { "type": "array", "maxItems": 2, "items": { "type": "object", "additionalProperties": false, "required": ["root", "access"], "properties": { "root": { "enum": ["plugin-data", "user-selected"] }, "access": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["read", "write"] } } } } }, "network": { "type": "array", "maxItems": 64, "items": { "type": "object", "additionalProperties": false, "required": ["origins", "methods"], "properties": { "origins": { "type": "array", "minItems": 1, "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "minLength": 1, "maxLength": 2048 } }, "methods": { "type": "array", "minItems": 1, "maxItems": 9, "uniqueItems": true, "items": { "enum": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"] } } } } }, "native": { "type": "boolean" } } }, "contributes": { "type": "object", "additionalProperties": false, "required": ["views"], "properties": { "views": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "additionalProperties": false, "required": ["id", "title"], "properties": { "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" }, "title": { "type": "string", "minLength": 1, "maxLength": 160 } } } } } }, "extensions": { "type": "object", "maxProperties": 64, "propertyNames": { "$ref": "#/definitions/capabilityName" }, "additionalProperties": { "$ref": "#/definitions/jsonValue" } } }, "definitions": { "range": { "type": "string", "minLength": 1, "maxLength": 128 }, "capabilityName": { "type": "string", "minLength": 3, "maxLength": 128, "pattern": "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, "capabilityRanges": { "type": "object", "maxProperties": 128, "propertyNames": { "$ref": "#/definitions/capabilityName" }, "additionalProperties": { "$ref": "#/definitions/range" } }, "jsonValue": { "anyOf": [{ "type": "null" }, { "type": "boolean" }, { "type": "number" }, { "type": "string" }, { "type": "array", "items": { "$ref": "#/definitions/jsonValue" } }, { "type": "object", "additionalProperties": { "$ref": "#/definitions/jsonValue" } }] } } };
var func0 = Object.prototype.hasOwnProperty;
var func61 = require_ucs2length().default;
var func32 = require_equal().default;
var pattern0 = new RegExp("^[a-z0-9]+(?:[.-][a-z0-9]+)+$", "u");
var pattern2 = new RegExp("^[a-z0-9][a-z0-9-]{0,63}$", "u");
var pattern1 = new RegExp("^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$", "u");
function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length > 128) {
      const err0 = { instancePath, schemaPath: "#/maxProperties", keyword: "maxProperties", params: { limit: 128 }, message: "must NOT have more than 128 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      const _errs1 = errors;
      if (typeof key0 === "string") {
        if (func61(key0) > 128) {
          const err1 = { instancePath, schemaPath: "#/definitions/capabilityName/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters", propertyName: key0 };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (func61(key0) < 3) {
          const err2 = { instancePath, schemaPath: "#/definitions/capabilityName/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters", propertyName: key0 };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (!pattern1.test(key0)) {
          const err3 = { instancePath, schemaPath: "#/definitions/capabilityName/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$"', propertyName: key0 };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath, schemaPath: "#/definitions/capabilityName/type", keyword: "type", params: { type: "string" }, message: "must be string", propertyName: key0 };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
      var valid0 = _errs1 === errors;
      if (!valid0) {
        const err5 = { instancePath, schemaPath: "#/propertyNames", keyword: "propertyNames", params: { propertyName: key0 }, message: "property name must be valid" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    for (const key1 of Object.keys(data)) {
      let data0 = data[key1];
      if (typeof data0 === "string") {
        if (func61(data0) > 128) {
          const err6 = { instancePath: instancePath + "/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/range/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (func61(data0) < 1) {
          const err7 = { instancePath: instancePath + "/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/range/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/range/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
  } else {
    const err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  }
  validate11.errors = vErrors;
  return errors === 0;
}
var wrapper0 = { validate: validate14 };
function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  const _errs1 = errors;
  if (data !== null) {
    const err0 = { instancePath, schemaPath: "#/anyOf/0/type", keyword: "type", params: { type: "null" }, message: "must be null" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  valid0 = valid0 || _valid0;
  if (!valid0) {
    const _errs3 = errors;
    if (typeof data !== "boolean") {
      const err1 = { instancePath, schemaPath: "#/anyOf/1/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    var _valid0 = _errs3 === errors;
    valid0 = valid0 || _valid0;
    if (!valid0) {
      const _errs5 = errors;
      if (!(typeof data == "number" && isFinite(data))) {
        const err2 = { instancePath, schemaPath: "#/anyOf/2/type", keyword: "type", params: { type: "number" }, message: "must be number" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      var _valid0 = _errs5 === errors;
      valid0 = valid0 || _valid0;
      if (!valid0) {
        const _errs7 = errors;
        if (typeof data !== "string") {
          const err3 = { instancePath, schemaPath: "#/anyOf/3/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        var _valid0 = _errs7 === errors;
        valid0 = valid0 || _valid0;
        if (!valid0) {
          const _errs9 = errors;
          if (Array.isArray(data)) {
            const len0 = data.length;
            for (let i0 = 0; i0 < len0; i0++) {
              if (!wrapper0.validate(data[i0], { instancePath: instancePath + "/" + i0, parentData: data, parentDataProperty: i0, rootData })) {
                vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err4 = { instancePath, schemaPath: "#/anyOf/4/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
          var _valid0 = _errs9 === errors;
          valid0 = valid0 || _valid0;
          if (!valid0) {
            const _errs12 = errors;
            if (data && typeof data == "object" && !Array.isArray(data)) {
              for (const key0 of Object.keys(data)) {
                if (!wrapper0.validate(data[key0], { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data, parentDataProperty: key0, rootData })) {
                  vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
                  errors = vErrors.length;
                }
              }
            } else {
              const err5 = { instancePath, schemaPath: "#/anyOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            var _valid0 = _errs12 === errors;
            valid0 = valid0 || _valid0;
          }
        }
      }
    }
  }
  if (!valid0) {
    const err6 = { instancePath, schemaPath: "#/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate14.errors = vErrors;
  return errors === 0;
}
function validate10(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.manifestVersion === void 0 || !func0.call(data, "manifestVersion")) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "manifestVersion" }, message: "must have required property 'manifestVersion'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.id === void 0 || !func0.call(data, "id")) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.name === void 0 || !func0.call(data, "name")) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.version === void 0 || !func0.call(data, "version")) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.description === void 0 || !func0.call(data, "description")) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "description" }, message: "must have required property 'description'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.license === void 0 || !func0.call(data, "license")) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "license" }, message: "must have required property 'license'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.engines === void 0 || !func0.call(data, "engines")) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "engines" }, message: "must have required property 'engines'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.entry === void 0 || !func0.call(data, "entry")) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entry" }, message: "must have required property 'entry'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.activation === void 0 || !func0.call(data, "activation")) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "activation" }, message: "must have required property 'activation'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.requires === void 0 || !func0.call(data, "requires")) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requires" }, message: "must have required property 'requires'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.optional === void 0 || !func0.call(data, "optional")) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "optional" }, message: "must have required property 'optional'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.permissions === void 0 || !func0.call(data, "permissions")) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "permissions" }, message: "must have required property 'permissions'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    if (data.contributes === void 0 || !func0.call(data, "contributes")) {
      const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contributes" }, message: "must have required property 'contributes'" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!func0.call(schema11.properties, key0)) {
        const err13 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.manifestVersion !== void 0 && func0.call(data, "manifestVersion")) {
      if (1 !== data.manifestVersion) {
        const err14 = { instancePath: instancePath + "/manifestVersion", schemaPath: "#/properties/manifestVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.id !== void 0 && func0.call(data, "id")) {
      let data1 = data.id;
      if (typeof data1 === "string") {
        if (func61(data1) > 160) {
          const err15 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (func61(data1) < 3) {
          const err16 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (!pattern0.test(data1)) {
          const err17 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" }, message: 'must match pattern "^[a-z0-9]+(?:[.-][a-z0-9]+)+$"' };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.name !== void 0 && func0.call(data, "name")) {
      let data2 = data.name;
      if (typeof data2 === "string") {
        if (func61(data2) > 160) {
          const err19 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        if (func61(data2) < 1) {
          const err20 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.version !== void 0 && func0.call(data, "version")) {
      let data3 = data.version;
      if (typeof data3 === "string") {
        if (func61(data3) > 128) {
          const err22 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
        if (func61(data3) < 1) {
          const err23 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
      } else {
        const err24 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.description !== void 0 && func0.call(data, "description")) {
      let data4 = data.description;
      if (typeof data4 === "string") {
        if (func61(data4) > 8192) {
          const err25 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/maxLength", keyword: "maxLength", params: { limit: 8192 }, message: "must NOT have more than 8192 characters" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
      } else {
        const err26 = { instancePath: instancePath + "/description", schemaPath: "#/properties/description/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.license !== void 0 && func0.call(data, "license")) {
      let data5 = data.license;
      if (typeof data5 === "string") {
        if (func61(data5) > 256) {
          const err27 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
        if (func61(data5) < 1) {
          const err28 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.engines !== void 0 && func0.call(data, "engines")) {
      let data6 = data.engines;
      if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
        if (data6.aplg === void 0 || !func0.call(data6, "aplg")) {
          const err30 = { instancePath: instancePath + "/engines", schemaPath: "#/properties/engines/required", keyword: "required", params: { missingProperty: "aplg" }, message: "must have required property 'aplg'" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        for (const key1 of Object.keys(data6)) {
          if (!(key1 === "aplg")) {
            const err31 = { instancePath: instancePath + "/engines", schemaPath: "#/properties/engines/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err31];
            } else {
              vErrors.push(err31);
            }
            errors++;
          }
        }
        if (data6.aplg !== void 0 && func0.call(data6, "aplg")) {
          let data7 = data6.aplg;
          if (typeof data7 === "string") {
            if (func61(data7) > 128) {
              const err32 = { instancePath: instancePath + "/engines/aplg", schemaPath: "#/definitions/range/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
            if (func61(data7) < 1) {
              const err33 = { instancePath: instancePath + "/engines/aplg", schemaPath: "#/definitions/range/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
          } else {
            const err34 = { instancePath: instancePath + "/engines/aplg", schemaPath: "#/definitions/range/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err34];
            } else {
              vErrors.push(err34);
            }
            errors++;
          }
        }
      } else {
        const err35 = { instancePath: instancePath + "/engines", schemaPath: "#/properties/engines/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
    }
    if (data.entry !== void 0 && func0.call(data, "entry")) {
      let data8 = data.entry;
      if (typeof data8 === "string") {
        if (func61(data8) > 1024) {
          const err36 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/maxLength", keyword: "maxLength", params: { limit: 1024 }, message: "must NOT have more than 1024 characters" };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
        if (func61(data8) < 1) {
          const err37 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      } else {
        const err38 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.activation !== void 0 && func0.call(data, "activation")) {
      if ("view" !== data.activation) {
        const err39 = { instancePath: instancePath + "/activation", schemaPath: "#/properties/activation/const", keyword: "const", params: { allowedValue: "view" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.requires !== void 0 && func0.call(data, "requires")) {
      if (!validate11(data.requires, { instancePath: instancePath + "/requires", parentData: data, parentDataProperty: "requires", rootData })) {
        vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
        errors = vErrors.length;
      }
    }
    if (data.optional !== void 0 && func0.call(data, "optional")) {
      if (!validate11(data.optional, { instancePath: instancePath + "/optional", parentData: data, parentDataProperty: "optional", rootData })) {
        vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
        errors = vErrors.length;
      }
    }
    if (data.permissions !== void 0 && func0.call(data, "permissions")) {
      let data12 = data.permissions;
      if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
        if (data12.filesystem === void 0 || !func0.call(data12, "filesystem")) {
          const err40 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/required", keyword: "required", params: { missingProperty: "filesystem" }, message: "must have required property 'filesystem'" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (data12.network === void 0 || !func0.call(data12, "network")) {
          const err41 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/required", keyword: "required", params: { missingProperty: "network" }, message: "must have required property 'network'" };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
        if (data12.native === void 0 || !func0.call(data12, "native")) {
          const err42 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/required", keyword: "required", params: { missingProperty: "native" }, message: "must have required property 'native'" };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
        for (const key2 of Object.keys(data12)) {
          if (!(key2 === "filesystem" || key2 === "network" || key2 === "native")) {
            const err43 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
        }
        if (data12.filesystem !== void 0 && func0.call(data12, "filesystem")) {
          let data13 = data12.filesystem;
          if (Array.isArray(data13)) {
            if (data13.length > 2) {
              const err44 = { instancePath: instancePath + "/permissions/filesystem", schemaPath: "#/properties/permissions/properties/filesystem/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
            const len0 = data13.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data14 = data13[i0];
              if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
                if (data14.root === void 0 || !func0.call(data14, "root")) {
                  const err45 = { instancePath: instancePath + "/permissions/filesystem/" + i0, schemaPath: "#/properties/permissions/properties/filesystem/items/required", keyword: "required", params: { missingProperty: "root" }, message: "must have required property 'root'" };
                  if (vErrors === null) {
                    vErrors = [err45];
                  } else {
                    vErrors.push(err45);
                  }
                  errors++;
                }
                if (data14.access === void 0 || !func0.call(data14, "access")) {
                  const err46 = { instancePath: instancePath + "/permissions/filesystem/" + i0, schemaPath: "#/properties/permissions/properties/filesystem/items/required", keyword: "required", params: { missingProperty: "access" }, message: "must have required property 'access'" };
                  if (vErrors === null) {
                    vErrors = [err46];
                  } else {
                    vErrors.push(err46);
                  }
                  errors++;
                }
                for (const key3 of Object.keys(data14)) {
                  if (!(key3 === "root" || key3 === "access")) {
                    const err47 = { instancePath: instancePath + "/permissions/filesystem/" + i0, schemaPath: "#/properties/permissions/properties/filesystem/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err47];
                    } else {
                      vErrors.push(err47);
                    }
                    errors++;
                  }
                }
                if (data14.root !== void 0 && func0.call(data14, "root")) {
                  let data15 = data14.root;
                  if (!(data15 === "plugin-data" || data15 === "user-selected")) {
                    const err48 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/root", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/root/enum", keyword: "enum", params: { allowedValues: schema11.properties.permissions.properties.filesystem.items.properties.root.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err48];
                    } else {
                      vErrors.push(err48);
                    }
                    errors++;
                  }
                }
                if (data14.access !== void 0 && func0.call(data14, "access")) {
                  let data16 = data14.access;
                  if (Array.isArray(data16)) {
                    if (data16.length > 2) {
                      const err49 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                    if (data16.length < 1) {
                      const err50 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err50];
                      } else {
                        vErrors.push(err50);
                      }
                      errors++;
                    }
                    const len1 = data16.length;
                    for (let i1 = 0; i1 < len1; i1++) {
                      let data17 = data16[i1];
                      if (!(data17 === "read" || data17 === "write")) {
                        const err51 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access/" + i1, schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/items/enum", keyword: "enum", params: { allowedValues: schema11.properties.permissions.properties.filesystem.items.properties.access.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err51];
                        } else {
                          vErrors.push(err51);
                        }
                        errors++;
                      }
                    }
                    let i2 = data16.length;
                    let j0;
                    if (i2 > 1) {
                      outer0: for (; i2--; ) {
                        for (j0 = i2; j0--; ) {
                          if (func32(data16[i2], data16[j0])) {
                            const err52 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/uniqueItems", keyword: "uniqueItems", params: { i: i2, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i2 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err52];
                            } else {
                              vErrors.push(err52);
                            }
                            errors++;
                            break outer0;
                          }
                        }
                      }
                    }
                  } else {
                    const err53 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err53];
                    } else {
                      vErrors.push(err53);
                    }
                    errors++;
                  }
                }
              } else {
                const err54 = { instancePath: instancePath + "/permissions/filesystem/" + i0, schemaPath: "#/properties/permissions/properties/filesystem/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err54];
                } else {
                  vErrors.push(err54);
                }
                errors++;
              }
            }
          } else {
            const err55 = { instancePath: instancePath + "/permissions/filesystem", schemaPath: "#/properties/permissions/properties/filesystem/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err55];
            } else {
              vErrors.push(err55);
            }
            errors++;
          }
        }
        if (data12.network !== void 0 && func0.call(data12, "network")) {
          let data18 = data12.network;
          if (Array.isArray(data18)) {
            if (data18.length > 64) {
              const err56 = { instancePath: instancePath + "/permissions/network", schemaPath: "#/properties/permissions/properties/network/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
              if (vErrors === null) {
                vErrors = [err56];
              } else {
                vErrors.push(err56);
              }
              errors++;
            }
            const len2 = data18.length;
            for (let i3 = 0; i3 < len2; i3++) {
              let data19 = data18[i3];
              if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
                if (data19.origins === void 0 || !func0.call(data19, "origins")) {
                  const err57 = { instancePath: instancePath + "/permissions/network/" + i3, schemaPath: "#/properties/permissions/properties/network/items/required", keyword: "required", params: { missingProperty: "origins" }, message: "must have required property 'origins'" };
                  if (vErrors === null) {
                    vErrors = [err57];
                  } else {
                    vErrors.push(err57);
                  }
                  errors++;
                }
                if (data19.methods === void 0 || !func0.call(data19, "methods")) {
                  const err58 = { instancePath: instancePath + "/permissions/network/" + i3, schemaPath: "#/properties/permissions/properties/network/items/required", keyword: "required", params: { missingProperty: "methods" }, message: "must have required property 'methods'" };
                  if (vErrors === null) {
                    vErrors = [err58];
                  } else {
                    vErrors.push(err58);
                  }
                  errors++;
                }
                for (const key4 of Object.keys(data19)) {
                  if (!(key4 === "origins" || key4 === "methods")) {
                    const err59 = { instancePath: instancePath + "/permissions/network/" + i3, schemaPath: "#/properties/permissions/properties/network/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err59];
                    } else {
                      vErrors.push(err59);
                    }
                    errors++;
                  }
                }
                if (data19.origins !== void 0 && func0.call(data19, "origins")) {
                  let data20 = data19.origins;
                  if (Array.isArray(data20)) {
                    if (data20.length > 64) {
                      const err60 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins", schemaPath: "#/properties/permissions/properties/network/items/properties/origins/maxItems", keyword: "maxItems", params: { limit: 64 }, message: "must NOT have more than 64 items" };
                      if (vErrors === null) {
                        vErrors = [err60];
                      } else {
                        vErrors.push(err60);
                      }
                      errors++;
                    }
                    if (data20.length < 1) {
                      const err61 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins", schemaPath: "#/properties/permissions/properties/network/items/properties/origins/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err61];
                      } else {
                        vErrors.push(err61);
                      }
                      errors++;
                    }
                    const len3 = data20.length;
                    for (let i4 = 0; i4 < len3; i4++) {
                      let data21 = data20[i4];
                      if (typeof data21 === "string") {
                        if (func61(data21) > 2048) {
                          const err62 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins/" + i4, schemaPath: "#/properties/permissions/properties/network/items/properties/origins/items/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
                          if (vErrors === null) {
                            vErrors = [err62];
                          } else {
                            vErrors.push(err62);
                          }
                          errors++;
                        }
                        if (func61(data21) < 1) {
                          const err63 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins/" + i4, schemaPath: "#/properties/permissions/properties/network/items/properties/origins/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          if (vErrors === null) {
                            vErrors = [err63];
                          } else {
                            vErrors.push(err63);
                          }
                          errors++;
                        }
                      } else {
                        const err64 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins/" + i4, schemaPath: "#/properties/permissions/properties/network/items/properties/origins/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err64];
                        } else {
                          vErrors.push(err64);
                        }
                        errors++;
                      }
                    }
                    let i5 = data20.length;
                    let j1;
                    if (i5 > 1) {
                      const indices0 = {};
                      for (; i5--; ) {
                        let item0 = data20[i5];
                        if (typeof item0 !== "string") {
                          continue;
                        }
                        if (typeof indices0[item0] == "number") {
                          j1 = indices0[item0];
                          const err65 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins", schemaPath: "#/properties/permissions/properties/network/items/properties/origins/uniqueItems", keyword: "uniqueItems", params: { i: i5, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i5 + " are identical)" };
                          if (vErrors === null) {
                            vErrors = [err65];
                          } else {
                            vErrors.push(err65);
                          }
                          errors++;
                          break;
                        }
                        indices0[item0] = i5;
                      }
                    }
                  } else {
                    const err66 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins", schemaPath: "#/properties/permissions/properties/network/items/properties/origins/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err66];
                    } else {
                      vErrors.push(err66);
                    }
                    errors++;
                  }
                }
                if (data19.methods !== void 0 && func0.call(data19, "methods")) {
                  let data22 = data19.methods;
                  if (Array.isArray(data22)) {
                    if (data22.length > 9) {
                      const err67 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods", schemaPath: "#/properties/permissions/properties/network/items/properties/methods/maxItems", keyword: "maxItems", params: { limit: 9 }, message: "must NOT have more than 9 items" };
                      if (vErrors === null) {
                        vErrors = [err67];
                      } else {
                        vErrors.push(err67);
                      }
                      errors++;
                    }
                    if (data22.length < 1) {
                      const err68 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods", schemaPath: "#/properties/permissions/properties/network/items/properties/methods/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err68];
                      } else {
                        vErrors.push(err68);
                      }
                      errors++;
                    }
                    const len4 = data22.length;
                    for (let i6 = 0; i6 < len4; i6++) {
                      let data23 = data22[i6];
                      if (!(data23 === "GET" || data23 === "HEAD" || data23 === "POST" || data23 === "PUT" || data23 === "PATCH" || data23 === "DELETE" || data23 === "OPTIONS" || data23 === "CONNECT" || data23 === "TRACE")) {
                        const err69 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods/" + i6, schemaPath: "#/properties/permissions/properties/network/items/properties/methods/items/enum", keyword: "enum", params: { allowedValues: schema11.properties.permissions.properties.network.items.properties.methods.items.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err69];
                        } else {
                          vErrors.push(err69);
                        }
                        errors++;
                      }
                    }
                    let i7 = data22.length;
                    let j2;
                    if (i7 > 1) {
                      outer1: for (; i7--; ) {
                        for (j2 = i7; j2--; ) {
                          if (func32(data22[i7], data22[j2])) {
                            const err70 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods", schemaPath: "#/properties/permissions/properties/network/items/properties/methods/uniqueItems", keyword: "uniqueItems", params: { i: i7, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i7 + " are identical)" };
                            if (vErrors === null) {
                              vErrors = [err70];
                            } else {
                              vErrors.push(err70);
                            }
                            errors++;
                            break outer1;
                          }
                        }
                      }
                    }
                  } else {
                    const err71 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods", schemaPath: "#/properties/permissions/properties/network/items/properties/methods/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err71];
                    } else {
                      vErrors.push(err71);
                    }
                    errors++;
                  }
                }
              } else {
                const err72 = { instancePath: instancePath + "/permissions/network/" + i3, schemaPath: "#/properties/permissions/properties/network/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
          } else {
            const err73 = { instancePath: instancePath + "/permissions/network", schemaPath: "#/properties/permissions/properties/network/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
        }
        if (data12.native !== void 0 && func0.call(data12, "native")) {
          if (typeof data12.native !== "boolean") {
            const err74 = { instancePath: instancePath + "/permissions/native", schemaPath: "#/properties/permissions/properties/native/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err74];
            } else {
              vErrors.push(err74);
            }
            errors++;
          }
        }
      } else {
        const err75 = { instancePath: instancePath + "/permissions", schemaPath: "#/properties/permissions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err75];
        } else {
          vErrors.push(err75);
        }
        errors++;
      }
    }
    if (data.contributes !== void 0 && func0.call(data, "contributes")) {
      let data25 = data.contributes;
      if (data25 && typeof data25 == "object" && !Array.isArray(data25)) {
        if (data25.views === void 0 || !func0.call(data25, "views")) {
          const err76 = { instancePath: instancePath + "/contributes", schemaPath: "#/properties/contributes/required", keyword: "required", params: { missingProperty: "views" }, message: "must have required property 'views'" };
          if (vErrors === null) {
            vErrors = [err76];
          } else {
            vErrors.push(err76);
          }
          errors++;
        }
        for (const key5 of Object.keys(data25)) {
          if (!(key5 === "views")) {
            const err77 = { instancePath: instancePath + "/contributes", schemaPath: "#/properties/contributes/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err77];
            } else {
              vErrors.push(err77);
            }
            errors++;
          }
        }
        if (data25.views !== void 0 && func0.call(data25, "views")) {
          let data26 = data25.views;
          if (Array.isArray(data26)) {
            if (data26.length > 32) {
              const err78 = { instancePath: instancePath + "/contributes/views", schemaPath: "#/properties/contributes/properties/views/maxItems", keyword: "maxItems", params: { limit: 32 }, message: "must NOT have more than 32 items" };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
            if (data26.length < 1) {
              const err79 = { instancePath: instancePath + "/contributes/views", schemaPath: "#/properties/contributes/properties/views/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              if (vErrors === null) {
                vErrors = [err79];
              } else {
                vErrors.push(err79);
              }
              errors++;
            }
            const len5 = data26.length;
            for (let i8 = 0; i8 < len5; i8++) {
              let data27 = data26[i8];
              if (data27 && typeof data27 == "object" && !Array.isArray(data27)) {
                if (data27.id === void 0 || !func0.call(data27, "id")) {
                  const err80 = { instancePath: instancePath + "/contributes/views/" + i8, schemaPath: "#/properties/contributes/properties/views/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                  if (vErrors === null) {
                    vErrors = [err80];
                  } else {
                    vErrors.push(err80);
                  }
                  errors++;
                }
                if (data27.title === void 0 || !func0.call(data27, "title")) {
                  const err81 = { instancePath: instancePath + "/contributes/views/" + i8, schemaPath: "#/properties/contributes/properties/views/items/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
                  if (vErrors === null) {
                    vErrors = [err81];
                  } else {
                    vErrors.push(err81);
                  }
                  errors++;
                }
                for (const key6 of Object.keys(data27)) {
                  if (!(key6 === "id" || key6 === "title")) {
                    const err82 = { instancePath: instancePath + "/contributes/views/" + i8, schemaPath: "#/properties/contributes/properties/views/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err82];
                    } else {
                      vErrors.push(err82);
                    }
                    errors++;
                  }
                }
                if (data27.id !== void 0 && func0.call(data27, "id")) {
                  let data28 = data27.id;
                  if (typeof data28 === "string") {
                    if (!pattern2.test(data28)) {
                      const err83 = { instancePath: instancePath + "/contributes/views/" + i8 + "/id", schemaPath: "#/properties/contributes/properties/views/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]{0,63}$"' };
                      if (vErrors === null) {
                        vErrors = [err83];
                      } else {
                        vErrors.push(err83);
                      }
                      errors++;
                    }
                  } else {
                    const err84 = { instancePath: instancePath + "/contributes/views/" + i8 + "/id", schemaPath: "#/properties/contributes/properties/views/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err84];
                    } else {
                      vErrors.push(err84);
                    }
                    errors++;
                  }
                }
                if (data27.title !== void 0 && func0.call(data27, "title")) {
                  let data29 = data27.title;
                  if (typeof data29 === "string") {
                    if (func61(data29) > 160) {
                      const err85 = { instancePath: instancePath + "/contributes/views/" + i8 + "/title", schemaPath: "#/properties/contributes/properties/views/items/properties/title/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
                      if (vErrors === null) {
                        vErrors = [err85];
                      } else {
                        vErrors.push(err85);
                      }
                      errors++;
                    }
                    if (func61(data29) < 1) {
                      const err86 = { instancePath: instancePath + "/contributes/views/" + i8 + "/title", schemaPath: "#/properties/contributes/properties/views/items/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err86];
                      } else {
                        vErrors.push(err86);
                      }
                      errors++;
                    }
                  } else {
                    const err87 = { instancePath: instancePath + "/contributes/views/" + i8 + "/title", schemaPath: "#/properties/contributes/properties/views/items/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err87];
                    } else {
                      vErrors.push(err87);
                    }
                    errors++;
                  }
                }
              } else {
                const err88 = { instancePath: instancePath + "/contributes/views/" + i8, schemaPath: "#/properties/contributes/properties/views/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err88];
                } else {
                  vErrors.push(err88);
                }
                errors++;
              }
            }
          } else {
            const err89 = { instancePath: instancePath + "/contributes/views", schemaPath: "#/properties/contributes/properties/views/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
        }
      } else {
        const err90 = { instancePath: instancePath + "/contributes", schemaPath: "#/properties/contributes/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err90];
        } else {
          vErrors.push(err90);
        }
        errors++;
      }
    }
    if (data.extensions !== void 0 && func0.call(data, "extensions")) {
      let data30 = data.extensions;
      if (data30 && typeof data30 == "object" && !Array.isArray(data30)) {
        if (Object.keys(data30).length > 64) {
          const err91 = { instancePath: instancePath + "/extensions", schemaPath: "#/properties/extensions/maxProperties", keyword: "maxProperties", params: { limit: 64 }, message: "must NOT have more than 64 properties" };
          if (vErrors === null) {
            vErrors = [err91];
          } else {
            vErrors.push(err91);
          }
          errors++;
        }
        for (const key7 of Object.keys(data30)) {
          const _errs64 = errors;
          if (typeof key7 === "string") {
            if (func61(key7) > 128) {
              const err92 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters", propertyName: key7 };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
            if (func61(key7) < 3) {
              const err93 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters", propertyName: key7 };
              if (vErrors === null) {
                vErrors = [err93];
              } else {
                vErrors.push(err93);
              }
              errors++;
            }
            if (!pattern1.test(key7)) {
              const err94 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$"', propertyName: key7 };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
          } else {
            const err95 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/type", keyword: "type", params: { type: "string" }, message: "must be string", propertyName: key7 };
            if (vErrors === null) {
              vErrors = [err95];
            } else {
              vErrors.push(err95);
            }
            errors++;
          }
          var valid23 = _errs64 === errors;
          if (!valid23) {
            const err96 = { instancePath: instancePath + "/extensions", schemaPath: "#/properties/extensions/propertyNames", keyword: "propertyNames", params: { propertyName: key7 }, message: "property name must be valid" };
            if (vErrors === null) {
              vErrors = [err96];
            } else {
              vErrors.push(err96);
            }
            errors++;
          }
        }
        for (const key8 of Object.keys(data30)) {
          if (!validate14(data30[key8], { instancePath: instancePath + "/extensions/" + key8.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data30, parentDataProperty: key8, rootData })) {
            vErrors = vErrors === null ? validate14.errors : vErrors.concat(validate14.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err97 = { instancePath: instancePath + "/extensions", schemaPath: "#/properties/extensions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err97];
        } else {
          vErrors.push(err97);
        }
        errors++;
      }
    }
  } else {
    const err98 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err98];
    } else {
      vErrors.push(err98);
    }
    errors++;
  }
  validate10.errors = vErrors;
  return errors === 0;
}
export {
  validateManifestSchema
};
