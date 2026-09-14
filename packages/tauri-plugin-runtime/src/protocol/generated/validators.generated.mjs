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
var validateStandardCapabilityMessageSchema = validate10;
var schema11 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/capabilities.schema.json", "title": "StandardCapabilityMessage", "oneOf": [{ "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "get" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["key"], "properties": { "key": { "type": "string", "minLength": 1, "maxLength": 1024 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "get" }, "direction": { "const": "result" }, "value": { "$ref": "#/definitions/jsonValue" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "set" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["key", "value"], "properties": { "key": { "type": "string", "minLength": 1, "maxLength": 1024 }, "value": { "$ref": "#/definitions/jsonValue" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "set" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "remove" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["key"], "properties": { "key": { "type": "string", "minLength": 1, "maxLength": 1024 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.storage" }, "method": { "const": "remove" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.dialog" }, "method": { "const": "pickDirectory" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": [], "properties": { "access": { "enum": ["read", "readwrite"] } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.dialog" }, "method": { "const": "pickDirectory" }, "direction": { "const": "result" }, "value": { "anyOf": [{ "type": "null" }, { "type": "object", "additionalProperties": false, "required": ["path", "access"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 }, "access": { "enum": ["read", "readwrite"] } } }] } } }], "definitions": { "jsonValue": { "anyOf": [{ "type": "null" }, { "type": "boolean" }, { "type": "number" }, { "type": "string" }, { "type": "array", "items": { "$ref": "#/definitions/jsonValue" } }, { "type": "object", "additionalProperties": { "$ref": "#/definitions/jsonValue" } }] } } };
var func0 = Object.prototype.hasOwnProperty;
var func55 = require_ucs2length().default;
var wrapper0 = { validate: validate11 };
function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
  validate11.errors = vErrors;
  return errors === 0;
}
function validate10(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.capability === void 0 || !func0.call(data, "capability")) {
      const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.method === void 0 || !func0.call(data, "method")) {
      const err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.direction === void 0 || !func0.call(data, "direction")) {
      const err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.value === void 0 || !func0.call(data, "value")) {
      const err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "capability" || key0 === "method" || key0 === "direction" || key0 === "value")) {
        const err4 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.capability !== void 0 && func0.call(data, "capability")) {
      if ("aplg.storage" !== data.capability) {
        const err5 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/0/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.method !== void 0 && func0.call(data, "method")) {
      if ("get" !== data.method) {
        const err6 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/0/properties/method/const", keyword: "const", params: { allowedValue: "get" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.direction !== void 0 && func0.call(data, "direction")) {
      if ("request" !== data.direction) {
        const err7 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/0/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.value !== void 0 && func0.call(data, "value")) {
      let data3 = data.value;
      if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
        if (data3.key === void 0 || !func0.call(data3, "key")) {
          const err8 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        for (const key1 of Object.keys(data3)) {
          if (!(key1 === "key")) {
            const err9 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data3.key !== void 0 && func0.call(data3, "key")) {
          let data4 = data3.key;
          if (typeof data4 === "string") {
            if (func55(data4) > 1024) {
              const err10 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/0/properties/value/properties/key/maxLength", keyword: "maxLength", params: { limit: 1024 }, message: "must NOT have more than 1024 characters" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
            if (func55(data4) < 1) {
              const err11 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/0/properties/value/properties/key/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          } else {
            const err12 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/0/properties/value/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
      } else {
        const err13 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.capability === void 0 || !func0.call(data, "capability")) {
      const err15 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.method === void 0 || !func0.call(data, "method")) {
      const err16 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.direction === void 0 || !func0.call(data, "direction")) {
      const err17 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.value === void 0 || !func0.call(data, "value")) {
      const err18 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    for (const key2 of Object.keys(data)) {
      if (!(key2 === "capability" || key2 === "method" || key2 === "direction" || key2 === "value")) {
        const err19 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.capability !== void 0 && func0.call(data, "capability")) {
      if ("aplg.storage" !== data.capability) {
        const err20 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/1/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.method !== void 0 && func0.call(data, "method")) {
      if ("get" !== data.method) {
        const err21 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/1/properties/method/const", keyword: "const", params: { allowedValue: "get" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.direction !== void 0 && func0.call(data, "direction")) {
      if ("result" !== data.direction) {
        const err22 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/1/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.value !== void 0 && func0.call(data, "value")) {
      if (!validate11(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData })) {
        vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err23 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err23];
    } else {
      vErrors.push(err23);
    }
    errors++;
  }
  var _valid0 = _errs12 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs19 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.capability === void 0 || !func0.call(data, "capability")) {
        const err24 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
      if (data.method === void 0 || !func0.call(data, "method")) {
        const err25 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
      if (data.direction === void 0 || !func0.call(data, "direction")) {
        const err26 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
      if (data.value === void 0 || !func0.call(data, "value")) {
        const err27 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      for (const key3 of Object.keys(data)) {
        if (!(key3 === "capability" || key3 === "method" || key3 === "direction" || key3 === "value")) {
          const err28 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      }
      if (data.capability !== void 0 && func0.call(data, "capability")) {
        if ("aplg.storage" !== data.capability) {
          const err29 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/2/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
      }
      if (data.method !== void 0 && func0.call(data, "method")) {
        if ("set" !== data.method) {
          const err30 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/2/properties/method/const", keyword: "const", params: { allowedValue: "set" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
      if (data.direction !== void 0 && func0.call(data, "direction")) {
        if ("request" !== data.direction) {
          const err31 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/2/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
      }
      if (data.value !== void 0 && func0.call(data, "value")) {
        let data12 = data.value;
        if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
          if (data12.key === void 0 || !func0.call(data12, "key")) {
            const err32 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
          if (data12.value === void 0 || !func0.call(data12, "value")) {
            const err33 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
            if (vErrors === null) {
              vErrors = [err33];
            } else {
              vErrors.push(err33);
            }
            errors++;
          }
          for (const key4 of Object.keys(data12)) {
            if (!(key4 === "key" || key4 === "value")) {
              const err34 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err34];
              } else {
                vErrors.push(err34);
              }
              errors++;
            }
          }
          if (data12.key !== void 0 && func0.call(data12, "key")) {
            let data13 = data12.key;
            if (typeof data13 === "string") {
              if (func55(data13) > 1024) {
                const err35 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/2/properties/value/properties/key/maxLength", keyword: "maxLength", params: { limit: 1024 }, message: "must NOT have more than 1024 characters" };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
              }
              if (func55(data13) < 1) {
                const err36 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/2/properties/value/properties/key/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err36];
                } else {
                  vErrors.push(err36);
                }
                errors++;
              }
            } else {
              const err37 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/2/properties/value/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err37];
              } else {
                vErrors.push(err37);
              }
              errors++;
            }
          }
          if (data12.value !== void 0 && func0.call(data12, "value")) {
            if (!validate11(data12.value, { instancePath: instancePath + "/value/value", parentData: data12, parentDataProperty: "value", rootData })) {
              vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
              errors = vErrors.length;
            }
          }
        } else {
          const err38 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
      }
    } else {
      const err39 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err39];
      } else {
        vErrors.push(err39);
      }
      errors++;
    }
    var _valid0 = _errs19 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
      const _errs31 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.capability === void 0 || !func0.call(data, "capability")) {
          const err40 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (data.method === void 0 || !func0.call(data, "method")) {
          const err41 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
        if (data.direction === void 0 || !func0.call(data, "direction")) {
          const err42 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
        if (data.value === void 0 || !func0.call(data, "value")) {
          const err43 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
        for (const key5 of Object.keys(data)) {
          if (!(key5 === "capability" || key5 === "method" || key5 === "direction" || key5 === "value")) {
            const err44 = { instancePath, schemaPath: "#/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
        }
        if (data.capability !== void 0 && func0.call(data, "capability")) {
          if ("aplg.storage" !== data.capability) {
            const err45 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/3/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
        if (data.method !== void 0 && func0.call(data, "method")) {
          if ("set" !== data.method) {
            const err46 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/3/properties/method/const", keyword: "const", params: { allowedValue: "set" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
        }
        if (data.direction !== void 0 && func0.call(data, "direction")) {
          if ("result" !== data.direction) {
            const err47 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/3/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err47];
            } else {
              vErrors.push(err47);
            }
            errors++;
          }
        }
        if (data.value !== void 0 && func0.call(data, "value")) {
          if (data.value !== null) {
            const err48 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/3/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
        }
      } else {
        const err49 = { instancePath, schemaPath: "#/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
      var _valid0 = _errs31 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
        }
        const _errs39 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.capability === void 0 || !func0.call(data, "capability")) {
            const err50 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
          if (data.method === void 0 || !func0.call(data, "method")) {
            const err51 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
            if (vErrors === null) {
              vErrors = [err51];
            } else {
              vErrors.push(err51);
            }
            errors++;
          }
          if (data.direction === void 0 || !func0.call(data, "direction")) {
            const err52 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
            if (vErrors === null) {
              vErrors = [err52];
            } else {
              vErrors.push(err52);
            }
            errors++;
          }
          if (data.value === void 0 || !func0.call(data, "value")) {
            const err53 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
            if (vErrors === null) {
              vErrors = [err53];
            } else {
              vErrors.push(err53);
            }
            errors++;
          }
          for (const key6 of Object.keys(data)) {
            if (!(key6 === "capability" || key6 === "method" || key6 === "direction" || key6 === "value")) {
              const err54 = { instancePath, schemaPath: "#/oneOf/4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err54];
              } else {
                vErrors.push(err54);
              }
              errors++;
            }
          }
          if (data.capability !== void 0 && func0.call(data, "capability")) {
            if ("aplg.storage" !== data.capability) {
              const err55 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/4/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          }
          if (data.method !== void 0 && func0.call(data, "method")) {
            if ("remove" !== data.method) {
              const err56 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/4/properties/method/const", keyword: "const", params: { allowedValue: "remove" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err56];
              } else {
                vErrors.push(err56);
              }
              errors++;
            }
          }
          if (data.direction !== void 0 && func0.call(data, "direction")) {
            if ("request" !== data.direction) {
              const err57 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/4/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err57];
              } else {
                vErrors.push(err57);
              }
              errors++;
            }
          }
          if (data.value !== void 0 && func0.call(data, "value")) {
            let data22 = data.value;
            if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
              if (data22.key === void 0 || !func0.call(data22, "key")) {
                const err58 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/required", keyword: "required", params: { missingProperty: "key" }, message: "must have required property 'key'" };
                if (vErrors === null) {
                  vErrors = [err58];
                } else {
                  vErrors.push(err58);
                }
                errors++;
              }
              for (const key7 of Object.keys(data22)) {
                if (!(key7 === "key")) {
                  const err59 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err59];
                  } else {
                    vErrors.push(err59);
                  }
                  errors++;
                }
              }
              if (data22.key !== void 0 && func0.call(data22, "key")) {
                let data23 = data22.key;
                if (typeof data23 === "string") {
                  if (func55(data23) > 1024) {
                    const err60 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/4/properties/value/properties/key/maxLength", keyword: "maxLength", params: { limit: 1024 }, message: "must NOT have more than 1024 characters" };
                    if (vErrors === null) {
                      vErrors = [err60];
                    } else {
                      vErrors.push(err60);
                    }
                    errors++;
                  }
                  if (func55(data23) < 1) {
                    const err61 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/4/properties/value/properties/key/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err61];
                    } else {
                      vErrors.push(err61);
                    }
                    errors++;
                  }
                } else {
                  const err62 = { instancePath: instancePath + "/value/key", schemaPath: "#/oneOf/4/properties/value/properties/key/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err62];
                  } else {
                    vErrors.push(err62);
                  }
                  errors++;
                }
              }
            } else {
              const err63 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err63];
              } else {
                vErrors.push(err63);
              }
              errors++;
            }
          }
        } else {
          const err64 = { instancePath, schemaPath: "#/oneOf/4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
        var _valid0 = _errs39 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
          }
          const _errs50 = errors;
          if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.capability === void 0 || !func0.call(data, "capability")) {
              const err65 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
              if (vErrors === null) {
                vErrors = [err65];
              } else {
                vErrors.push(err65);
              }
              errors++;
            }
            if (data.method === void 0 || !func0.call(data, "method")) {
              const err66 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            if (data.direction === void 0 || !func0.call(data, "direction")) {
              const err67 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data.value === void 0 || !func0.call(data, "value")) {
              const err68 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
            for (const key8 of Object.keys(data)) {
              if (!(key8 === "capability" || key8 === "method" || key8 === "direction" || key8 === "value")) {
                const err69 = { instancePath, schemaPath: "#/oneOf/5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
            }
            if (data.capability !== void 0 && func0.call(data, "capability")) {
              if ("aplg.storage" !== data.capability) {
                const err70 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/5/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.storage" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err70];
                } else {
                  vErrors.push(err70);
                }
                errors++;
              }
            }
            if (data.method !== void 0 && func0.call(data, "method")) {
              if ("remove" !== data.method) {
                const err71 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/5/properties/method/const", keyword: "const", params: { allowedValue: "remove" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err71];
                } else {
                  vErrors.push(err71);
                }
                errors++;
              }
            }
            if (data.direction !== void 0 && func0.call(data, "direction")) {
              if ("result" !== data.direction) {
                const err72 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/5/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
            }
            if (data.value !== void 0 && func0.call(data, "value")) {
              if (data.value !== null) {
                const err73 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/5/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                if (vErrors === null) {
                  vErrors = [err73];
                } else {
                  vErrors.push(err73);
                }
                errors++;
              }
            }
          } else {
            const err74 = { instancePath, schemaPath: "#/oneOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err74];
            } else {
              vErrors.push(err74);
            }
            errors++;
          }
          var _valid0 = _errs50 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
            }
            const _errs58 = errors;
            if (data && typeof data == "object" && !Array.isArray(data)) {
              if (data.capability === void 0 || !func0.call(data, "capability")) {
                const err75 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                if (vErrors === null) {
                  vErrors = [err75];
                } else {
                  vErrors.push(err75);
                }
                errors++;
              }
              if (data.method === void 0 || !func0.call(data, "method")) {
                const err76 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
              if (data.direction === void 0 || !func0.call(data, "direction")) {
                const err77 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                if (vErrors === null) {
                  vErrors = [err77];
                } else {
                  vErrors.push(err77);
                }
                errors++;
              }
              if (data.value === void 0 || !func0.call(data, "value")) {
                const err78 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                if (vErrors === null) {
                  vErrors = [err78];
                } else {
                  vErrors.push(err78);
                }
                errors++;
              }
              for (const key9 of Object.keys(data)) {
                if (!(key9 === "capability" || key9 === "method" || key9 === "direction" || key9 === "value")) {
                  const err79 = { instancePath, schemaPath: "#/oneOf/6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err79];
                  } else {
                    vErrors.push(err79);
                  }
                  errors++;
                }
              }
              if (data.capability !== void 0 && func0.call(data, "capability")) {
                if ("aplg.dialog" !== data.capability) {
                  const err80 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/6/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.dialog" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err80];
                  } else {
                    vErrors.push(err80);
                  }
                  errors++;
                }
              }
              if (data.method !== void 0 && func0.call(data, "method")) {
                if ("pickDirectory" !== data.method) {
                  const err81 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/6/properties/method/const", keyword: "const", params: { allowedValue: "pickDirectory" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err81];
                  } else {
                    vErrors.push(err81);
                  }
                  errors++;
                }
              }
              if (data.direction !== void 0 && func0.call(data, "direction")) {
                if ("request" !== data.direction) {
                  const err82 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/6/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err82];
                  } else {
                    vErrors.push(err82);
                  }
                  errors++;
                }
              }
              if (data.value !== void 0 && func0.call(data, "value")) {
                let data31 = data.value;
                if (data31 && typeof data31 == "object" && !Array.isArray(data31)) {
                  for (const key10 of Object.keys(data31)) {
                    if (!(key10 === "access")) {
                      const err83 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                      if (vErrors === null) {
                        vErrors = [err83];
                      } else {
                        vErrors.push(err83);
                      }
                      errors++;
                    }
                  }
                  if (data31.access !== void 0 && func0.call(data31, "access")) {
                    let data32 = data31.access;
                    if (!(data32 === "read" || data32 === "readwrite")) {
                      const err84 = { instancePath: instancePath + "/value/access", schemaPath: "#/oneOf/6/properties/value/properties/access/enum", keyword: "enum", params: { allowedValues: schema11.oneOf[6].properties.value.properties.access.enum }, message: "must be equal to one of the allowed values" };
                      if (vErrors === null) {
                        vErrors = [err84];
                      } else {
                        vErrors.push(err84);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err85 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err85];
                  } else {
                    vErrors.push(err85);
                  }
                  errors++;
                }
              }
            } else {
              const err86 = { instancePath, schemaPath: "#/oneOf/6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err86];
              } else {
                vErrors.push(err86);
              }
              errors++;
            }
            var _valid0 = _errs58 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
              }
              const _errs68 = errors;
              if (data && typeof data == "object" && !Array.isArray(data)) {
                if (data.capability === void 0 || !func0.call(data, "capability")) {
                  const err87 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                  if (vErrors === null) {
                    vErrors = [err87];
                  } else {
                    vErrors.push(err87);
                  }
                  errors++;
                }
                if (data.method === void 0 || !func0.call(data, "method")) {
                  const err88 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                  if (vErrors === null) {
                    vErrors = [err88];
                  } else {
                    vErrors.push(err88);
                  }
                  errors++;
                }
                if (data.direction === void 0 || !func0.call(data, "direction")) {
                  const err89 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                  if (vErrors === null) {
                    vErrors = [err89];
                  } else {
                    vErrors.push(err89);
                  }
                  errors++;
                }
                if (data.value === void 0 || !func0.call(data, "value")) {
                  const err90 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                  if (vErrors === null) {
                    vErrors = [err90];
                  } else {
                    vErrors.push(err90);
                  }
                  errors++;
                }
                for (const key11 of Object.keys(data)) {
                  if (!(key11 === "capability" || key11 === "method" || key11 === "direction" || key11 === "value")) {
                    const err91 = { instancePath, schemaPath: "#/oneOf/7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err91];
                    } else {
                      vErrors.push(err91);
                    }
                    errors++;
                  }
                }
                if (data.capability !== void 0 && func0.call(data, "capability")) {
                  if ("aplg.dialog" !== data.capability) {
                    const err92 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/7/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.dialog" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err92];
                    } else {
                      vErrors.push(err92);
                    }
                    errors++;
                  }
                }
                if (data.method !== void 0 && func0.call(data, "method")) {
                  if ("pickDirectory" !== data.method) {
                    const err93 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/7/properties/method/const", keyword: "const", params: { allowedValue: "pickDirectory" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err93];
                    } else {
                      vErrors.push(err93);
                    }
                    errors++;
                  }
                }
                if (data.direction !== void 0 && func0.call(data, "direction")) {
                  if ("result" !== data.direction) {
                    const err94 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/7/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err94];
                    } else {
                      vErrors.push(err94);
                    }
                    errors++;
                  }
                }
                if (data.value !== void 0 && func0.call(data, "value")) {
                  let data36 = data.value;
                  const _errs75 = errors;
                  let valid13 = false;
                  const _errs76 = errors;
                  if (data36 !== null) {
                    const err95 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf/0/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                    if (vErrors === null) {
                      vErrors = [err95];
                    } else {
                      vErrors.push(err95);
                    }
                    errors++;
                  }
                  var _valid1 = _errs76 === errors;
                  valid13 = valid13 || _valid1;
                  if (!valid13) {
                    const _errs78 = errors;
                    if (data36 && typeof data36 == "object" && !Array.isArray(data36)) {
                      if (data36.path === void 0 || !func0.call(data36, "path")) {
                        const err96 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf/1/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                        if (vErrors === null) {
                          vErrors = [err96];
                        } else {
                          vErrors.push(err96);
                        }
                        errors++;
                      }
                      if (data36.access === void 0 || !func0.call(data36, "access")) {
                        const err97 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf/1/required", keyword: "required", params: { missingProperty: "access" }, message: "must have required property 'access'" };
                        if (vErrors === null) {
                          vErrors = [err97];
                        } else {
                          vErrors.push(err97);
                        }
                        errors++;
                      }
                      for (const key12 of Object.keys(data36)) {
                        if (!(key12 === "path" || key12 === "access")) {
                          const err98 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                          if (vErrors === null) {
                            vErrors = [err98];
                          } else {
                            vErrors.push(err98);
                          }
                          errors++;
                        }
                      }
                      if (data36.path !== void 0 && func0.call(data36, "path")) {
                        let data37 = data36.path;
                        if (typeof data37 === "string") {
                          if (func55(data37) > 4096) {
                            const err99 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/7/properties/value/anyOf/1/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                            if (vErrors === null) {
                              vErrors = [err99];
                            } else {
                              vErrors.push(err99);
                            }
                            errors++;
                          }
                          if (func55(data37) < 1) {
                            const err100 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/7/properties/value/anyOf/1/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                            if (vErrors === null) {
                              vErrors = [err100];
                            } else {
                              vErrors.push(err100);
                            }
                            errors++;
                          }
                        } else {
                          const err101 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/7/properties/value/anyOf/1/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                          if (vErrors === null) {
                            vErrors = [err101];
                          } else {
                            vErrors.push(err101);
                          }
                          errors++;
                        }
                      }
                      if (data36.access !== void 0 && func0.call(data36, "access")) {
                        let data38 = data36.access;
                        if (!(data38 === "read" || data38 === "readwrite")) {
                          const err102 = { instancePath: instancePath + "/value/access", schemaPath: "#/oneOf/7/properties/value/anyOf/1/properties/access/enum", keyword: "enum", params: { allowedValues: schema11.oneOf[7].properties.value.anyOf[1].properties.access.enum }, message: "must be equal to one of the allowed values" };
                          if (vErrors === null) {
                            vErrors = [err102];
                          } else {
                            vErrors.push(err102);
                          }
                          errors++;
                        }
                      }
                    } else {
                      const err103 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                      if (vErrors === null) {
                        vErrors = [err103];
                      } else {
                        vErrors.push(err103);
                      }
                      errors++;
                    }
                    var _valid1 = _errs78 === errors;
                    valid13 = valid13 || _valid1;
                  }
                  if (!valid13) {
                    const err104 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                    if (vErrors === null) {
                      vErrors = [err104];
                    } else {
                      vErrors.push(err104);
                    }
                    errors++;
                  } else {
                    errors = _errs75;
                    if (vErrors !== null) {
                      if (_errs75) {
                        vErrors.length = _errs75;
                      } else {
                        vErrors = null;
                      }
                    }
                  }
                }
              } else {
                const err105 = { instancePath, schemaPath: "#/oneOf/7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err105];
                } else {
                  vErrors.push(err105);
                }
                errors++;
              }
              var _valid0 = _errs68 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err106 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err106];
    } else {
      vErrors.push(err106);
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
  validate10.errors = vErrors;
  return errors === 0;
}
var validateFsCapabilityMessageSchema = validate14;
var schema13 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/fs.schema.json", "title": "FsCapabilityMessage", "oneOf": [{ "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.openRead" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.openRead" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle", "size"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "size": { "type": "integer", "minimum": 0, "maximum": 8388608 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.openWrite" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path", "size", "mode"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 }, "size": { "type": "integer", "minimum": 0, "maximum": 8388608 }, "mode": { "enum": ["w", "wx", "a", "ax"] } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.openWrite" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.pull" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle", "offset", "length"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "offset": { "type": "integer", "minimum": 0, "maximum": 8388608 }, "length": { "type": "integer", "minimum": 1, "maximum": 262144 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.pull" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["offset", "dataBase64"], "properties": { "offset": { "type": "integer", "minimum": 0, "maximum": 8388608 }, "dataBase64": { "type": "string", "maxLength": 349528 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.push" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle", "offset", "dataBase64"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "offset": { "type": "integer", "minimum": 0, "maximum": 8388608 }, "dataBase64": { "type": "string", "maxLength": 349528 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.push" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["written"], "properties": { "written": { "type": "integer", "minimum": 0, "maximum": 262144 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.finish" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.finish" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.abort" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["handle"], "properties": { "handle": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "transfer.abort" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "stat" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "stat" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["kind", "size", "mtimeMs"], "properties": { "kind": { "enum": ["file", "directory"] }, "size": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "mtimeMs": { "type": "number" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "readdir" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "readdir" }, "direction": { "const": "result" }, "value": { "type": "array", "maxItems": 1e4, "items": { "type": "object", "additionalProperties": false, "required": ["name", "kind"], "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 255 }, "kind": { "enum": ["file", "directory"] } } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "mkdir" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path", "recursive"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 }, "recursive": { "type": "boolean" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "mkdir" }, "direction": { "const": "result" }, "value": { "type": "object", "additionalProperties": false, "required": ["createdPath"], "properties": { "createdPath": { "anyOf": [{ "type": "null" }, { "type": "string", "minLength": 1, "maxLength": 4096 }] } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "rename" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["from", "to"], "properties": { "from": { "type": "string", "minLength": 1, "maxLength": 4096 }, "to": { "type": "string", "minLength": 1, "maxLength": 4096 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "rename" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "copyFile" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["from", "to"], "properties": { "from": { "type": "string", "minLength": 1, "maxLength": 4096 }, "to": { "type": "string", "minLength": 1, "maxLength": 4096 } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "copyFile" }, "direction": { "const": "result" }, "value": { "type": "null" } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "rm" }, "direction": { "const": "request" }, "value": { "type": "object", "additionalProperties": false, "required": ["path", "recursive", "force"], "properties": { "path": { "type": "string", "minLength": 1, "maxLength": 4096 }, "recursive": { "type": "boolean" }, "force": { "type": "boolean" } } } } }, { "type": "object", "additionalProperties": false, "required": ["capability", "method", "direction", "value"], "properties": { "capability": { "const": "aplg.fs" }, "method": { "const": "rm" }, "direction": { "const": "result" }, "value": { "type": "null" } } }] };
var pattern0 = new RegExp("^[\\x21-\\x7e]+$", "u");
function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.capability === void 0 || !func0.call(data, "capability")) {
      const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.method === void 0 || !func0.call(data, "method")) {
      const err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.direction === void 0 || !func0.call(data, "direction")) {
      const err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.value === void 0 || !func0.call(data, "value")) {
      const err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "capability" || key0 === "method" || key0 === "direction" || key0 === "value")) {
        const err4 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.capability !== void 0 && func0.call(data, "capability")) {
      if ("aplg.fs" !== data.capability) {
        const err5 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/0/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.method !== void 0 && func0.call(data, "method")) {
      if ("transfer.openRead" !== data.method) {
        const err6 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/0/properties/method/const", keyword: "const", params: { allowedValue: "transfer.openRead" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.direction !== void 0 && func0.call(data, "direction")) {
      if ("request" !== data.direction) {
        const err7 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/0/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.value !== void 0 && func0.call(data, "value")) {
      let data3 = data.value;
      if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
        if (data3.path === void 0 || !func0.call(data3, "path")) {
          const err8 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        for (const key1 of Object.keys(data3)) {
          if (!(key1 === "path")) {
            const err9 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data3.path !== void 0 && func0.call(data3, "path")) {
          let data4 = data3.path;
          if (typeof data4 === "string") {
            if (func55(data4) > 4096) {
              const err10 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/0/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
            if (func55(data4) < 1) {
              const err11 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/0/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          } else {
            const err12 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/0/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
      } else {
        const err13 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/0/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.capability === void 0 || !func0.call(data, "capability")) {
      const err15 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.method === void 0 || !func0.call(data, "method")) {
      const err16 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.direction === void 0 || !func0.call(data, "direction")) {
      const err17 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.value === void 0 || !func0.call(data, "value")) {
      const err18 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    for (const key2 of Object.keys(data)) {
      if (!(key2 === "capability" || key2 === "method" || key2 === "direction" || key2 === "value")) {
        const err19 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.capability !== void 0 && func0.call(data, "capability")) {
      if ("aplg.fs" !== data.capability) {
        const err20 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/1/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.method !== void 0 && func0.call(data, "method")) {
      if ("transfer.openRead" !== data.method) {
        const err21 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/1/properties/method/const", keyword: "const", params: { allowedValue: "transfer.openRead" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.direction !== void 0 && func0.call(data, "direction")) {
      if ("result" !== data.direction) {
        const err22 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/1/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.value !== void 0 && func0.call(data, "value")) {
      let data8 = data.value;
      if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
        if (data8.handle === void 0 || !func0.call(data8, "handle")) {
          const err23 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/1/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
        if (data8.size === void 0 || !func0.call(data8, "size")) {
          const err24 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/1/properties/value/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        for (const key3 of Object.keys(data8)) {
          if (!(key3 === "handle" || key3 === "size")) {
            const err25 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/1/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err25];
            } else {
              vErrors.push(err25);
            }
            errors++;
          }
        }
        if (data8.handle !== void 0 && func0.call(data8, "handle")) {
          let data9 = data8.handle;
          if (typeof data9 === "string") {
            if (func55(data9) > 128) {
              const err26 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/1/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err26];
              } else {
                vErrors.push(err26);
              }
              errors++;
            }
            if (func55(data9) < 1) {
              const err27 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/1/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err27];
              } else {
                vErrors.push(err27);
              }
              errors++;
            }
            if (!pattern0.test(data9)) {
              const err28 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/1/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
              if (vErrors === null) {
                vErrors = [err28];
              } else {
                vErrors.push(err28);
              }
              errors++;
            }
          } else {
            const err29 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/1/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err29];
            } else {
              vErrors.push(err29);
            }
            errors++;
          }
        }
        if (data8.size !== void 0 && func0.call(data8, "size")) {
          let data10 = data8.size;
          if (!(typeof data10 == "number" && (!(data10 % 1) && !isNaN(data10)) && isFinite(data10))) {
            const err30 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/1/properties/value/properties/size/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
          if (typeof data10 == "number" && isFinite(data10)) {
            if (data10 > 8388608 || isNaN(data10)) {
              const err31 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/1/properties/value/properties/size/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
              if (vErrors === null) {
                vErrors = [err31];
              } else {
                vErrors.push(err31);
              }
              errors++;
            }
            if (data10 < 0 || isNaN(data10)) {
              const err32 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/1/properties/value/properties/size/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
          }
        }
      } else {
        const err33 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/1/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
  } else {
    const err34 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err34];
    } else {
      vErrors.push(err34);
    }
    errors++;
  }
  var _valid0 = _errs12 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs25 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.capability === void 0 || !func0.call(data, "capability")) {
        const err35 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
      if (data.method === void 0 || !func0.call(data, "method")) {
        const err36 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
      if (data.direction === void 0 || !func0.call(data, "direction")) {
        const err37 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
      if (data.value === void 0 || !func0.call(data, "value")) {
        const err38 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
      for (const key4 of Object.keys(data)) {
        if (!(key4 === "capability" || key4 === "method" || key4 === "direction" || key4 === "value")) {
          const err39 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
          if (vErrors === null) {
            vErrors = [err39];
          } else {
            vErrors.push(err39);
          }
          errors++;
        }
      }
      if (data.capability !== void 0 && func0.call(data, "capability")) {
        if ("aplg.fs" !== data.capability) {
          const err40 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/2/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
      if (data.method !== void 0 && func0.call(data, "method")) {
        if ("transfer.openWrite" !== data.method) {
          const err41 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/2/properties/method/const", keyword: "const", params: { allowedValue: "transfer.openWrite" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      }
      if (data.direction !== void 0 && func0.call(data, "direction")) {
        if ("request" !== data.direction) {
          const err42 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/2/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      }
      if (data.value !== void 0 && func0.call(data, "value")) {
        let data14 = data.value;
        if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
          if (data14.path === void 0 || !func0.call(data14, "path")) {
            const err43 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
            if (vErrors === null) {
              vErrors = [err43];
            } else {
              vErrors.push(err43);
            }
            errors++;
          }
          if (data14.size === void 0 || !func0.call(data14, "size")) {
            const err44 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
            if (vErrors === null) {
              vErrors = [err44];
            } else {
              vErrors.push(err44);
            }
            errors++;
          }
          if (data14.mode === void 0 || !func0.call(data14, "mode")) {
            const err45 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/required", keyword: "required", params: { missingProperty: "mode" }, message: "must have required property 'mode'" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
          for (const key5 of Object.keys(data14)) {
            if (!(key5 === "path" || key5 === "size" || key5 === "mode")) {
              const err46 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err46];
              } else {
                vErrors.push(err46);
              }
              errors++;
            }
          }
          if (data14.path !== void 0 && func0.call(data14, "path")) {
            let data15 = data14.path;
            if (typeof data15 === "string") {
              if (func55(data15) > 4096) {
                const err47 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/2/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                if (vErrors === null) {
                  vErrors = [err47];
                } else {
                  vErrors.push(err47);
                }
                errors++;
              }
              if (func55(data15) < 1) {
                const err48 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/2/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err48];
                } else {
                  vErrors.push(err48);
                }
                errors++;
              }
            } else {
              const err49 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/2/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err49];
              } else {
                vErrors.push(err49);
              }
              errors++;
            }
          }
          if (data14.size !== void 0 && func0.call(data14, "size")) {
            let data16 = data14.size;
            if (!(typeof data16 == "number" && (!(data16 % 1) && !isNaN(data16)) && isFinite(data16))) {
              const err50 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/2/properties/value/properties/size/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
              if (vErrors === null) {
                vErrors = [err50];
              } else {
                vErrors.push(err50);
              }
              errors++;
            }
            if (typeof data16 == "number" && isFinite(data16)) {
              if (data16 > 8388608 || isNaN(data16)) {
                const err51 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/2/properties/value/properties/size/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
                if (vErrors === null) {
                  vErrors = [err51];
                } else {
                  vErrors.push(err51);
                }
                errors++;
              }
              if (data16 < 0 || isNaN(data16)) {
                const err52 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/2/properties/value/properties/size/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                if (vErrors === null) {
                  vErrors = [err52];
                } else {
                  vErrors.push(err52);
                }
                errors++;
              }
            }
          }
          if (data14.mode !== void 0 && func0.call(data14, "mode")) {
            let data17 = data14.mode;
            if (!(data17 === "w" || data17 === "wx" || data17 === "a" || data17 === "ax")) {
              const err53 = { instancePath: instancePath + "/value/mode", schemaPath: "#/oneOf/2/properties/value/properties/mode/enum", keyword: "enum", params: { allowedValues: schema13.oneOf[2].properties.value.properties.mode.enum }, message: "must be equal to one of the allowed values" };
              if (vErrors === null) {
                vErrors = [err53];
              } else {
                vErrors.push(err53);
              }
              errors++;
            }
          }
        } else {
          const err54 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/2/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
      }
    } else {
      const err55 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err55];
      } else {
        vErrors.push(err55);
      }
      errors++;
    }
    var _valid0 = _errs25 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
      const _errs39 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.capability === void 0 || !func0.call(data, "capability")) {
          const err56 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
        if (data.method === void 0 || !func0.call(data, "method")) {
          const err57 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
        if (data.direction === void 0 || !func0.call(data, "direction")) {
          const err58 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
        if (data.value === void 0 || !func0.call(data, "value")) {
          const err59 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
        for (const key6 of Object.keys(data)) {
          if (!(key6 === "capability" || key6 === "method" || key6 === "direction" || key6 === "value")) {
            const err60 = { instancePath, schemaPath: "#/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data.capability !== void 0 && func0.call(data, "capability")) {
          if ("aplg.fs" !== data.capability) {
            const err61 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/3/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
        if (data.method !== void 0 && func0.call(data, "method")) {
          if ("transfer.openWrite" !== data.method) {
            const err62 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/3/properties/method/const", keyword: "const", params: { allowedValue: "transfer.openWrite" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data.direction !== void 0 && func0.call(data, "direction")) {
          if ("result" !== data.direction) {
            const err63 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/3/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data.value !== void 0 && func0.call(data, "value")) {
          let data21 = data.value;
          if (data21 && typeof data21 == "object" && !Array.isArray(data21)) {
            if (data21.handle === void 0 || !func0.call(data21, "handle")) {
              const err64 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/3/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
            for (const key7 of Object.keys(data21)) {
              if (!(key7 === "handle")) {
                const err65 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/3/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err65];
                } else {
                  vErrors.push(err65);
                }
                errors++;
              }
            }
            if (data21.handle !== void 0 && func0.call(data21, "handle")) {
              let data22 = data21.handle;
              if (typeof data22 === "string") {
                if (func55(data22) > 128) {
                  const err66 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/3/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                  if (vErrors === null) {
                    vErrors = [err66];
                  } else {
                    vErrors.push(err66);
                  }
                  errors++;
                }
                if (func55(data22) < 1) {
                  const err67 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/3/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err67];
                  } else {
                    vErrors.push(err67);
                  }
                  errors++;
                }
                if (!pattern0.test(data22)) {
                  const err68 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/3/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                  if (vErrors === null) {
                    vErrors = [err68];
                  } else {
                    vErrors.push(err68);
                  }
                  errors++;
                }
              } else {
                const err69 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/3/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
            }
          } else {
            const err70 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/3/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err70];
            } else {
              vErrors.push(err70);
            }
            errors++;
          }
        }
      } else {
        const err71 = { instancePath, schemaPath: "#/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err71];
        } else {
          vErrors.push(err71);
        }
        errors++;
      }
      var _valid0 = _errs39 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
        }
        const _errs50 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.capability === void 0 || !func0.call(data, "capability")) {
            const err72 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
            if (vErrors === null) {
              vErrors = [err72];
            } else {
              vErrors.push(err72);
            }
            errors++;
          }
          if (data.method === void 0 || !func0.call(data, "method")) {
            const err73 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
          if (data.direction === void 0 || !func0.call(data, "direction")) {
            const err74 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
            if (vErrors === null) {
              vErrors = [err74];
            } else {
              vErrors.push(err74);
            }
            errors++;
          }
          if (data.value === void 0 || !func0.call(data, "value")) {
            const err75 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
          for (const key8 of Object.keys(data)) {
            if (!(key8 === "capability" || key8 === "method" || key8 === "direction" || key8 === "value")) {
              const err76 = { instancePath, schemaPath: "#/oneOf/4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
          }
          if (data.capability !== void 0 && func0.call(data, "capability")) {
            if ("aplg.fs" !== data.capability) {
              const err77 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/4/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err77];
              } else {
                vErrors.push(err77);
              }
              errors++;
            }
          }
          if (data.method !== void 0 && func0.call(data, "method")) {
            if ("transfer.pull" !== data.method) {
              const err78 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/4/properties/method/const", keyword: "const", params: { allowedValue: "transfer.pull" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
          }
          if (data.direction !== void 0 && func0.call(data, "direction")) {
            if ("request" !== data.direction) {
              const err79 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/4/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err79];
              } else {
                vErrors.push(err79);
              }
              errors++;
            }
          }
          if (data.value !== void 0 && func0.call(data, "value")) {
            let data26 = data.value;
            if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
              if (data26.handle === void 0 || !func0.call(data26, "handle")) {
                const err80 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
                if (vErrors === null) {
                  vErrors = [err80];
                } else {
                  vErrors.push(err80);
                }
                errors++;
              }
              if (data26.offset === void 0 || !func0.call(data26, "offset")) {
                const err81 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
                if (vErrors === null) {
                  vErrors = [err81];
                } else {
                  vErrors.push(err81);
                }
                errors++;
              }
              if (data26.length === void 0 || !func0.call(data26, "length")) {
                const err82 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/required", keyword: "required", params: { missingProperty: "length" }, message: "must have required property 'length'" };
                if (vErrors === null) {
                  vErrors = [err82];
                } else {
                  vErrors.push(err82);
                }
                errors++;
              }
              for (const key9 of Object.keys(data26)) {
                if (!(key9 === "handle" || key9 === "offset" || key9 === "length")) {
                  const err83 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err83];
                  } else {
                    vErrors.push(err83);
                  }
                  errors++;
                }
              }
              if (data26.handle !== void 0 && func0.call(data26, "handle")) {
                let data27 = data26.handle;
                if (typeof data27 === "string") {
                  if (func55(data27) > 128) {
                    const err84 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/4/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                    if (vErrors === null) {
                      vErrors = [err84];
                    } else {
                      vErrors.push(err84);
                    }
                    errors++;
                  }
                  if (func55(data27) < 1) {
                    const err85 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/4/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err85];
                    } else {
                      vErrors.push(err85);
                    }
                    errors++;
                  }
                  if (!pattern0.test(data27)) {
                    const err86 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/4/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                    if (vErrors === null) {
                      vErrors = [err86];
                    } else {
                      vErrors.push(err86);
                    }
                    errors++;
                  }
                } else {
                  const err87 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/4/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err87];
                  } else {
                    vErrors.push(err87);
                  }
                  errors++;
                }
              }
              if (data26.offset !== void 0 && func0.call(data26, "offset")) {
                let data28 = data26.offset;
                if (!(typeof data28 == "number" && (!(data28 % 1) && !isNaN(data28)) && isFinite(data28))) {
                  const err88 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/4/properties/value/properties/offset/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                  if (vErrors === null) {
                    vErrors = [err88];
                  } else {
                    vErrors.push(err88);
                  }
                  errors++;
                }
                if (typeof data28 == "number" && isFinite(data28)) {
                  if (data28 > 8388608 || isNaN(data28)) {
                    const err89 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/4/properties/value/properties/offset/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
                    if (vErrors === null) {
                      vErrors = [err89];
                    } else {
                      vErrors.push(err89);
                    }
                    errors++;
                  }
                  if (data28 < 0 || isNaN(data28)) {
                    const err90 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/4/properties/value/properties/offset/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                    if (vErrors === null) {
                      vErrors = [err90];
                    } else {
                      vErrors.push(err90);
                    }
                    errors++;
                  }
                }
              }
              if (data26.length !== void 0 && func0.call(data26, "length")) {
                let data29 = data26.length;
                if (!(typeof data29 == "number" && (!(data29 % 1) && !isNaN(data29)) && isFinite(data29))) {
                  const err91 = { instancePath: instancePath + "/value/length", schemaPath: "#/oneOf/4/properties/value/properties/length/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                  if (vErrors === null) {
                    vErrors = [err91];
                  } else {
                    vErrors.push(err91);
                  }
                  errors++;
                }
                if (typeof data29 == "number" && isFinite(data29)) {
                  if (data29 > 262144 || isNaN(data29)) {
                    const err92 = { instancePath: instancePath + "/value/length", schemaPath: "#/oneOf/4/properties/value/properties/length/maximum", keyword: "maximum", params: { comparison: "<=", limit: 262144 }, message: "must be <= 262144" };
                    if (vErrors === null) {
                      vErrors = [err92];
                    } else {
                      vErrors.push(err92);
                    }
                    errors++;
                  }
                  if (data29 < 1 || isNaN(data29)) {
                    const err93 = { instancePath: instancePath + "/value/length", schemaPath: "#/oneOf/4/properties/value/properties/length/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                    if (vErrors === null) {
                      vErrors = [err93];
                    } else {
                      vErrors.push(err93);
                    }
                    errors++;
                  }
                }
              }
            } else {
              const err94 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/4/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
          }
        } else {
          const err95 = { instancePath, schemaPath: "#/oneOf/4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err95];
          } else {
            vErrors.push(err95);
          }
          errors++;
        }
        var _valid0 = _errs50 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
          }
          const _errs65 = errors;
          if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.capability === void 0 || !func0.call(data, "capability")) {
              const err96 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
              if (vErrors === null) {
                vErrors = [err96];
              } else {
                vErrors.push(err96);
              }
              errors++;
            }
            if (data.method === void 0 || !func0.call(data, "method")) {
              const err97 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
              if (vErrors === null) {
                vErrors = [err97];
              } else {
                vErrors.push(err97);
              }
              errors++;
            }
            if (data.direction === void 0 || !func0.call(data, "direction")) {
              const err98 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
              if (vErrors === null) {
                vErrors = [err98];
              } else {
                vErrors.push(err98);
              }
              errors++;
            }
            if (data.value === void 0 || !func0.call(data, "value")) {
              const err99 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
              if (vErrors === null) {
                vErrors = [err99];
              } else {
                vErrors.push(err99);
              }
              errors++;
            }
            for (const key10 of Object.keys(data)) {
              if (!(key10 === "capability" || key10 === "method" || key10 === "direction" || key10 === "value")) {
                const err100 = { instancePath, schemaPath: "#/oneOf/5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err100];
                } else {
                  vErrors.push(err100);
                }
                errors++;
              }
            }
            if (data.capability !== void 0 && func0.call(data, "capability")) {
              if ("aplg.fs" !== data.capability) {
                const err101 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/5/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err101];
                } else {
                  vErrors.push(err101);
                }
                errors++;
              }
            }
            if (data.method !== void 0 && func0.call(data, "method")) {
              if ("transfer.pull" !== data.method) {
                const err102 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/5/properties/method/const", keyword: "const", params: { allowedValue: "transfer.pull" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err102];
                } else {
                  vErrors.push(err102);
                }
                errors++;
              }
            }
            if (data.direction !== void 0 && func0.call(data, "direction")) {
              if ("result" !== data.direction) {
                const err103 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/5/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err103];
                } else {
                  vErrors.push(err103);
                }
                errors++;
              }
            }
            if (data.value !== void 0 && func0.call(data, "value")) {
              let data33 = data.value;
              if (data33 && typeof data33 == "object" && !Array.isArray(data33)) {
                if (data33.offset === void 0 || !func0.call(data33, "offset")) {
                  const err104 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/5/properties/value/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
                  if (vErrors === null) {
                    vErrors = [err104];
                  } else {
                    vErrors.push(err104);
                  }
                  errors++;
                }
                if (data33.dataBase64 === void 0 || !func0.call(data33, "dataBase64")) {
                  const err105 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/5/properties/value/required", keyword: "required", params: { missingProperty: "dataBase64" }, message: "must have required property 'dataBase64'" };
                  if (vErrors === null) {
                    vErrors = [err105];
                  } else {
                    vErrors.push(err105);
                  }
                  errors++;
                }
                for (const key11 of Object.keys(data33)) {
                  if (!(key11 === "offset" || key11 === "dataBase64")) {
                    const err106 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/5/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err106];
                    } else {
                      vErrors.push(err106);
                    }
                    errors++;
                  }
                }
                if (data33.offset !== void 0 && func0.call(data33, "offset")) {
                  let data34 = data33.offset;
                  if (!(typeof data34 == "number" && (!(data34 % 1) && !isNaN(data34)) && isFinite(data34))) {
                    const err107 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/5/properties/value/properties/offset/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err107];
                    } else {
                      vErrors.push(err107);
                    }
                    errors++;
                  }
                  if (typeof data34 == "number" && isFinite(data34)) {
                    if (data34 > 8388608 || isNaN(data34)) {
                      const err108 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/5/properties/value/properties/offset/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
                      if (vErrors === null) {
                        vErrors = [err108];
                      } else {
                        vErrors.push(err108);
                      }
                      errors++;
                    }
                    if (data34 < 0 || isNaN(data34)) {
                      const err109 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/5/properties/value/properties/offset/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err109];
                      } else {
                        vErrors.push(err109);
                      }
                      errors++;
                    }
                  }
                }
                if (data33.dataBase64 !== void 0 && func0.call(data33, "dataBase64")) {
                  let data35 = data33.dataBase64;
                  if (typeof data35 === "string") {
                    if (func55(data35) > 349528) {
                      const err110 = { instancePath: instancePath + "/value/dataBase64", schemaPath: "#/oneOf/5/properties/value/properties/dataBase64/maxLength", keyword: "maxLength", params: { limit: 349528 }, message: "must NOT have more than 349528 characters" };
                      if (vErrors === null) {
                        vErrors = [err110];
                      } else {
                        vErrors.push(err110);
                      }
                      errors++;
                    }
                  } else {
                    const err111 = { instancePath: instancePath + "/value/dataBase64", schemaPath: "#/oneOf/5/properties/value/properties/dataBase64/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err111];
                    } else {
                      vErrors.push(err111);
                    }
                    errors++;
                  }
                }
              } else {
                const err112 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/5/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err112];
                } else {
                  vErrors.push(err112);
                }
                errors++;
              }
            }
          } else {
            const err113 = { instancePath, schemaPath: "#/oneOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err113];
            } else {
              vErrors.push(err113);
            }
            errors++;
          }
          var _valid0 = _errs65 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
            }
            const _errs78 = errors;
            if (data && typeof data == "object" && !Array.isArray(data)) {
              if (data.capability === void 0 || !func0.call(data, "capability")) {
                const err114 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                if (vErrors === null) {
                  vErrors = [err114];
                } else {
                  vErrors.push(err114);
                }
                errors++;
              }
              if (data.method === void 0 || !func0.call(data, "method")) {
                const err115 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                if (vErrors === null) {
                  vErrors = [err115];
                } else {
                  vErrors.push(err115);
                }
                errors++;
              }
              if (data.direction === void 0 || !func0.call(data, "direction")) {
                const err116 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                if (vErrors === null) {
                  vErrors = [err116];
                } else {
                  vErrors.push(err116);
                }
                errors++;
              }
              if (data.value === void 0 || !func0.call(data, "value")) {
                const err117 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                if (vErrors === null) {
                  vErrors = [err117];
                } else {
                  vErrors.push(err117);
                }
                errors++;
              }
              for (const key12 of Object.keys(data)) {
                if (!(key12 === "capability" || key12 === "method" || key12 === "direction" || key12 === "value")) {
                  const err118 = { instancePath, schemaPath: "#/oneOf/6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err118];
                  } else {
                    vErrors.push(err118);
                  }
                  errors++;
                }
              }
              if (data.capability !== void 0 && func0.call(data, "capability")) {
                if ("aplg.fs" !== data.capability) {
                  const err119 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/6/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err119];
                  } else {
                    vErrors.push(err119);
                  }
                  errors++;
                }
              }
              if (data.method !== void 0 && func0.call(data, "method")) {
                if ("transfer.push" !== data.method) {
                  const err120 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/6/properties/method/const", keyword: "const", params: { allowedValue: "transfer.push" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err120];
                  } else {
                    vErrors.push(err120);
                  }
                  errors++;
                }
              }
              if (data.direction !== void 0 && func0.call(data, "direction")) {
                if ("request" !== data.direction) {
                  const err121 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/6/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err121];
                  } else {
                    vErrors.push(err121);
                  }
                  errors++;
                }
              }
              if (data.value !== void 0 && func0.call(data, "value")) {
                let data39 = data.value;
                if (data39 && typeof data39 == "object" && !Array.isArray(data39)) {
                  if (data39.handle === void 0 || !func0.call(data39, "handle")) {
                    const err122 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
                    if (vErrors === null) {
                      vErrors = [err122];
                    } else {
                      vErrors.push(err122);
                    }
                    errors++;
                  }
                  if (data39.offset === void 0 || !func0.call(data39, "offset")) {
                    const err123 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
                    if (vErrors === null) {
                      vErrors = [err123];
                    } else {
                      vErrors.push(err123);
                    }
                    errors++;
                  }
                  if (data39.dataBase64 === void 0 || !func0.call(data39, "dataBase64")) {
                    const err124 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/required", keyword: "required", params: { missingProperty: "dataBase64" }, message: "must have required property 'dataBase64'" };
                    if (vErrors === null) {
                      vErrors = [err124];
                    } else {
                      vErrors.push(err124);
                    }
                    errors++;
                  }
                  for (const key13 of Object.keys(data39)) {
                    if (!(key13 === "handle" || key13 === "offset" || key13 === "dataBase64")) {
                      const err125 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key13 }, message: "must NOT have additional properties" };
                      if (vErrors === null) {
                        vErrors = [err125];
                      } else {
                        vErrors.push(err125);
                      }
                      errors++;
                    }
                  }
                  if (data39.handle !== void 0 && func0.call(data39, "handle")) {
                    let data40 = data39.handle;
                    if (typeof data40 === "string") {
                      if (func55(data40) > 128) {
                        const err126 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/6/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                        if (vErrors === null) {
                          vErrors = [err126];
                        } else {
                          vErrors.push(err126);
                        }
                        errors++;
                      }
                      if (func55(data40) < 1) {
                        const err127 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/6/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                        if (vErrors === null) {
                          vErrors = [err127];
                        } else {
                          vErrors.push(err127);
                        }
                        errors++;
                      }
                      if (!pattern0.test(data40)) {
                        const err128 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/6/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                        if (vErrors === null) {
                          vErrors = [err128];
                        } else {
                          vErrors.push(err128);
                        }
                        errors++;
                      }
                    } else {
                      const err129 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/6/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err129];
                      } else {
                        vErrors.push(err129);
                      }
                      errors++;
                    }
                  }
                  if (data39.offset !== void 0 && func0.call(data39, "offset")) {
                    let data41 = data39.offset;
                    if (!(typeof data41 == "number" && (!(data41 % 1) && !isNaN(data41)) && isFinite(data41))) {
                      const err130 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/6/properties/value/properties/offset/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                      if (vErrors === null) {
                        vErrors = [err130];
                      } else {
                        vErrors.push(err130);
                      }
                      errors++;
                    }
                    if (typeof data41 == "number" && isFinite(data41)) {
                      if (data41 > 8388608 || isNaN(data41)) {
                        const err131 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/6/properties/value/properties/offset/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
                        if (vErrors === null) {
                          vErrors = [err131];
                        } else {
                          vErrors.push(err131);
                        }
                        errors++;
                      }
                      if (data41 < 0 || isNaN(data41)) {
                        const err132 = { instancePath: instancePath + "/value/offset", schemaPath: "#/oneOf/6/properties/value/properties/offset/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                        if (vErrors === null) {
                          vErrors = [err132];
                        } else {
                          vErrors.push(err132);
                        }
                        errors++;
                      }
                    }
                  }
                  if (data39.dataBase64 !== void 0 && func0.call(data39, "dataBase64")) {
                    let data42 = data39.dataBase64;
                    if (typeof data42 === "string") {
                      if (func55(data42) > 349528) {
                        const err133 = { instancePath: instancePath + "/value/dataBase64", schemaPath: "#/oneOf/6/properties/value/properties/dataBase64/maxLength", keyword: "maxLength", params: { limit: 349528 }, message: "must NOT have more than 349528 characters" };
                        if (vErrors === null) {
                          vErrors = [err133];
                        } else {
                          vErrors.push(err133);
                        }
                        errors++;
                      }
                    } else {
                      const err134 = { instancePath: instancePath + "/value/dataBase64", schemaPath: "#/oneOf/6/properties/value/properties/dataBase64/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err134];
                      } else {
                        vErrors.push(err134);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err135 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/6/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err135];
                  } else {
                    vErrors.push(err135);
                  }
                  errors++;
                }
              }
            } else {
              const err136 = { instancePath, schemaPath: "#/oneOf/6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err136];
              } else {
                vErrors.push(err136);
              }
              errors++;
            }
            var _valid0 = _errs78 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
              }
              const _errs93 = errors;
              if (data && typeof data == "object" && !Array.isArray(data)) {
                if (data.capability === void 0 || !func0.call(data, "capability")) {
                  const err137 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                  if (vErrors === null) {
                    vErrors = [err137];
                  } else {
                    vErrors.push(err137);
                  }
                  errors++;
                }
                if (data.method === void 0 || !func0.call(data, "method")) {
                  const err138 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                  if (vErrors === null) {
                    vErrors = [err138];
                  } else {
                    vErrors.push(err138);
                  }
                  errors++;
                }
                if (data.direction === void 0 || !func0.call(data, "direction")) {
                  const err139 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                  if (vErrors === null) {
                    vErrors = [err139];
                  } else {
                    vErrors.push(err139);
                  }
                  errors++;
                }
                if (data.value === void 0 || !func0.call(data, "value")) {
                  const err140 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                  if (vErrors === null) {
                    vErrors = [err140];
                  } else {
                    vErrors.push(err140);
                  }
                  errors++;
                }
                for (const key14 of Object.keys(data)) {
                  if (!(key14 === "capability" || key14 === "method" || key14 === "direction" || key14 === "value")) {
                    const err141 = { instancePath, schemaPath: "#/oneOf/7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key14 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err141];
                    } else {
                      vErrors.push(err141);
                    }
                    errors++;
                  }
                }
                if (data.capability !== void 0 && func0.call(data, "capability")) {
                  if ("aplg.fs" !== data.capability) {
                    const err142 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/7/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err142];
                    } else {
                      vErrors.push(err142);
                    }
                    errors++;
                  }
                }
                if (data.method !== void 0 && func0.call(data, "method")) {
                  if ("transfer.push" !== data.method) {
                    const err143 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/7/properties/method/const", keyword: "const", params: { allowedValue: "transfer.push" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err143];
                    } else {
                      vErrors.push(err143);
                    }
                    errors++;
                  }
                }
                if (data.direction !== void 0 && func0.call(data, "direction")) {
                  if ("result" !== data.direction) {
                    const err144 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/7/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err144];
                    } else {
                      vErrors.push(err144);
                    }
                    errors++;
                  }
                }
                if (data.value !== void 0 && func0.call(data, "value")) {
                  let data46 = data.value;
                  if (data46 && typeof data46 == "object" && !Array.isArray(data46)) {
                    if (data46.written === void 0 || !func0.call(data46, "written")) {
                      const err145 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/required", keyword: "required", params: { missingProperty: "written" }, message: "must have required property 'written'" };
                      if (vErrors === null) {
                        vErrors = [err145];
                      } else {
                        vErrors.push(err145);
                      }
                      errors++;
                    }
                    for (const key15 of Object.keys(data46)) {
                      if (!(key15 === "written")) {
                        const err146 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key15 }, message: "must NOT have additional properties" };
                        if (vErrors === null) {
                          vErrors = [err146];
                        } else {
                          vErrors.push(err146);
                        }
                        errors++;
                      }
                    }
                    if (data46.written !== void 0 && func0.call(data46, "written")) {
                      let data47 = data46.written;
                      if (!(typeof data47 == "number" && (!(data47 % 1) && !isNaN(data47)) && isFinite(data47))) {
                        const err147 = { instancePath: instancePath + "/value/written", schemaPath: "#/oneOf/7/properties/value/properties/written/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                        if (vErrors === null) {
                          vErrors = [err147];
                        } else {
                          vErrors.push(err147);
                        }
                        errors++;
                      }
                      if (typeof data47 == "number" && isFinite(data47)) {
                        if (data47 > 262144 || isNaN(data47)) {
                          const err148 = { instancePath: instancePath + "/value/written", schemaPath: "#/oneOf/7/properties/value/properties/written/maximum", keyword: "maximum", params: { comparison: "<=", limit: 262144 }, message: "must be <= 262144" };
                          if (vErrors === null) {
                            vErrors = [err148];
                          } else {
                            vErrors.push(err148);
                          }
                          errors++;
                        }
                        if (data47 < 0 || isNaN(data47)) {
                          const err149 = { instancePath: instancePath + "/value/written", schemaPath: "#/oneOf/7/properties/value/properties/written/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                          if (vErrors === null) {
                            vErrors = [err149];
                          } else {
                            vErrors.push(err149);
                          }
                          errors++;
                        }
                      }
                    }
                  } else {
                    const err150 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/7/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    if (vErrors === null) {
                      vErrors = [err150];
                    } else {
                      vErrors.push(err150);
                    }
                    errors++;
                  }
                }
              } else {
                const err151 = { instancePath, schemaPath: "#/oneOf/7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err151];
                } else {
                  vErrors.push(err151);
                }
                errors++;
              }
              var _valid0 = _errs93 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                }
                const _errs104 = errors;
                if (data && typeof data == "object" && !Array.isArray(data)) {
                  if (data.capability === void 0 || !func0.call(data, "capability")) {
                    const err152 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                    if (vErrors === null) {
                      vErrors = [err152];
                    } else {
                      vErrors.push(err152);
                    }
                    errors++;
                  }
                  if (data.method === void 0 || !func0.call(data, "method")) {
                    const err153 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                    if (vErrors === null) {
                      vErrors = [err153];
                    } else {
                      vErrors.push(err153);
                    }
                    errors++;
                  }
                  if (data.direction === void 0 || !func0.call(data, "direction")) {
                    const err154 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                    if (vErrors === null) {
                      vErrors = [err154];
                    } else {
                      vErrors.push(err154);
                    }
                    errors++;
                  }
                  if (data.value === void 0 || !func0.call(data, "value")) {
                    const err155 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                    if (vErrors === null) {
                      vErrors = [err155];
                    } else {
                      vErrors.push(err155);
                    }
                    errors++;
                  }
                  for (const key16 of Object.keys(data)) {
                    if (!(key16 === "capability" || key16 === "method" || key16 === "direction" || key16 === "value")) {
                      const err156 = { instancePath, schemaPath: "#/oneOf/8/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key16 }, message: "must NOT have additional properties" };
                      if (vErrors === null) {
                        vErrors = [err156];
                      } else {
                        vErrors.push(err156);
                      }
                      errors++;
                    }
                  }
                  if (data.capability !== void 0 && func0.call(data, "capability")) {
                    if ("aplg.fs" !== data.capability) {
                      const err157 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/8/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err157];
                      } else {
                        vErrors.push(err157);
                      }
                      errors++;
                    }
                  }
                  if (data.method !== void 0 && func0.call(data, "method")) {
                    if ("transfer.finish" !== data.method) {
                      const err158 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/8/properties/method/const", keyword: "const", params: { allowedValue: "transfer.finish" }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err158];
                      } else {
                        vErrors.push(err158);
                      }
                      errors++;
                    }
                  }
                  if (data.direction !== void 0 && func0.call(data, "direction")) {
                    if ("request" !== data.direction) {
                      const err159 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/8/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err159];
                      } else {
                        vErrors.push(err159);
                      }
                      errors++;
                    }
                  }
                  if (data.value !== void 0 && func0.call(data, "value")) {
                    let data51 = data.value;
                    if (data51 && typeof data51 == "object" && !Array.isArray(data51)) {
                      if (data51.handle === void 0 || !func0.call(data51, "handle")) {
                        const err160 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/8/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
                        if (vErrors === null) {
                          vErrors = [err160];
                        } else {
                          vErrors.push(err160);
                        }
                        errors++;
                      }
                      for (const key17 of Object.keys(data51)) {
                        if (!(key17 === "handle")) {
                          const err161 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/8/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key17 }, message: "must NOT have additional properties" };
                          if (vErrors === null) {
                            vErrors = [err161];
                          } else {
                            vErrors.push(err161);
                          }
                          errors++;
                        }
                      }
                      if (data51.handle !== void 0 && func0.call(data51, "handle")) {
                        let data52 = data51.handle;
                        if (typeof data52 === "string") {
                          if (func55(data52) > 128) {
                            const err162 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/8/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                            if (vErrors === null) {
                              vErrors = [err162];
                            } else {
                              vErrors.push(err162);
                            }
                            errors++;
                          }
                          if (func55(data52) < 1) {
                            const err163 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/8/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                            if (vErrors === null) {
                              vErrors = [err163];
                            } else {
                              vErrors.push(err163);
                            }
                            errors++;
                          }
                          if (!pattern0.test(data52)) {
                            const err164 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/8/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                            if (vErrors === null) {
                              vErrors = [err164];
                            } else {
                              vErrors.push(err164);
                            }
                            errors++;
                          }
                        } else {
                          const err165 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/8/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                          if (vErrors === null) {
                            vErrors = [err165];
                          } else {
                            vErrors.push(err165);
                          }
                          errors++;
                        }
                      }
                    } else {
                      const err166 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/8/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                      if (vErrors === null) {
                        vErrors = [err166];
                      } else {
                        vErrors.push(err166);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err167 = { instancePath, schemaPath: "#/oneOf/8/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err167];
                  } else {
                    vErrors.push(err167);
                  }
                  errors++;
                }
                var _valid0 = _errs104 === errors;
                if (_valid0 && valid0) {
                  valid0 = false;
                  passing0 = [passing0, 8];
                } else {
                  if (_valid0) {
                    valid0 = true;
                    passing0 = 8;
                  }
                  const _errs115 = errors;
                  if (data && typeof data == "object" && !Array.isArray(data)) {
                    if (data.capability === void 0 || !func0.call(data, "capability")) {
                      const err168 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                      if (vErrors === null) {
                        vErrors = [err168];
                      } else {
                        vErrors.push(err168);
                      }
                      errors++;
                    }
                    if (data.method === void 0 || !func0.call(data, "method")) {
                      const err169 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                      if (vErrors === null) {
                        vErrors = [err169];
                      } else {
                        vErrors.push(err169);
                      }
                      errors++;
                    }
                    if (data.direction === void 0 || !func0.call(data, "direction")) {
                      const err170 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                      if (vErrors === null) {
                        vErrors = [err170];
                      } else {
                        vErrors.push(err170);
                      }
                      errors++;
                    }
                    if (data.value === void 0 || !func0.call(data, "value")) {
                      const err171 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                      if (vErrors === null) {
                        vErrors = [err171];
                      } else {
                        vErrors.push(err171);
                      }
                      errors++;
                    }
                    for (const key18 of Object.keys(data)) {
                      if (!(key18 === "capability" || key18 === "method" || key18 === "direction" || key18 === "value")) {
                        const err172 = { instancePath, schemaPath: "#/oneOf/9/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key18 }, message: "must NOT have additional properties" };
                        if (vErrors === null) {
                          vErrors = [err172];
                        } else {
                          vErrors.push(err172);
                        }
                        errors++;
                      }
                    }
                    if (data.capability !== void 0 && func0.call(data, "capability")) {
                      if ("aplg.fs" !== data.capability) {
                        const err173 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/9/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                        if (vErrors === null) {
                          vErrors = [err173];
                        } else {
                          vErrors.push(err173);
                        }
                        errors++;
                      }
                    }
                    if (data.method !== void 0 && func0.call(data, "method")) {
                      if ("transfer.finish" !== data.method) {
                        const err174 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/9/properties/method/const", keyword: "const", params: { allowedValue: "transfer.finish" }, message: "must be equal to constant" };
                        if (vErrors === null) {
                          vErrors = [err174];
                        } else {
                          vErrors.push(err174);
                        }
                        errors++;
                      }
                    }
                    if (data.direction !== void 0 && func0.call(data, "direction")) {
                      if ("result" !== data.direction) {
                        const err175 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/9/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                        if (vErrors === null) {
                          vErrors = [err175];
                        } else {
                          vErrors.push(err175);
                        }
                        errors++;
                      }
                    }
                    if (data.value !== void 0 && func0.call(data, "value")) {
                      if (data.value !== null) {
                        const err176 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/9/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                        if (vErrors === null) {
                          vErrors = [err176];
                        } else {
                          vErrors.push(err176);
                        }
                        errors++;
                      }
                    }
                  } else {
                    const err177 = { instancePath, schemaPath: "#/oneOf/9/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    if (vErrors === null) {
                      vErrors = [err177];
                    } else {
                      vErrors.push(err177);
                    }
                    errors++;
                  }
                  var _valid0 = _errs115 === errors;
                  if (_valid0 && valid0) {
                    valid0 = false;
                    passing0 = [passing0, 9];
                  } else {
                    if (_valid0) {
                      valid0 = true;
                      passing0 = 9;
                    }
                    const _errs123 = errors;
                    if (data && typeof data == "object" && !Array.isArray(data)) {
                      if (data.capability === void 0 || !func0.call(data, "capability")) {
                        const err178 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                        if (vErrors === null) {
                          vErrors = [err178];
                        } else {
                          vErrors.push(err178);
                        }
                        errors++;
                      }
                      if (data.method === void 0 || !func0.call(data, "method")) {
                        const err179 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                        if (vErrors === null) {
                          vErrors = [err179];
                        } else {
                          vErrors.push(err179);
                        }
                        errors++;
                      }
                      if (data.direction === void 0 || !func0.call(data, "direction")) {
                        const err180 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                        if (vErrors === null) {
                          vErrors = [err180];
                        } else {
                          vErrors.push(err180);
                        }
                        errors++;
                      }
                      if (data.value === void 0 || !func0.call(data, "value")) {
                        const err181 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                        if (vErrors === null) {
                          vErrors = [err181];
                        } else {
                          vErrors.push(err181);
                        }
                        errors++;
                      }
                      for (const key19 of Object.keys(data)) {
                        if (!(key19 === "capability" || key19 === "method" || key19 === "direction" || key19 === "value")) {
                          const err182 = { instancePath, schemaPath: "#/oneOf/10/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key19 }, message: "must NOT have additional properties" };
                          if (vErrors === null) {
                            vErrors = [err182];
                          } else {
                            vErrors.push(err182);
                          }
                          errors++;
                        }
                      }
                      if (data.capability !== void 0 && func0.call(data, "capability")) {
                        if ("aplg.fs" !== data.capability) {
                          const err183 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/10/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                          if (vErrors === null) {
                            vErrors = [err183];
                          } else {
                            vErrors.push(err183);
                          }
                          errors++;
                        }
                      }
                      if (data.method !== void 0 && func0.call(data, "method")) {
                        if ("transfer.abort" !== data.method) {
                          const err184 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/10/properties/method/const", keyword: "const", params: { allowedValue: "transfer.abort" }, message: "must be equal to constant" };
                          if (vErrors === null) {
                            vErrors = [err184];
                          } else {
                            vErrors.push(err184);
                          }
                          errors++;
                        }
                      }
                      if (data.direction !== void 0 && func0.call(data, "direction")) {
                        if ("request" !== data.direction) {
                          const err185 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/10/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                          if (vErrors === null) {
                            vErrors = [err185];
                          } else {
                            vErrors.push(err185);
                          }
                          errors++;
                        }
                      }
                      if (data.value !== void 0 && func0.call(data, "value")) {
                        let data60 = data.value;
                        if (data60 && typeof data60 == "object" && !Array.isArray(data60)) {
                          if (data60.handle === void 0 || !func0.call(data60, "handle")) {
                            const err186 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/10/properties/value/required", keyword: "required", params: { missingProperty: "handle" }, message: "must have required property 'handle'" };
                            if (vErrors === null) {
                              vErrors = [err186];
                            } else {
                              vErrors.push(err186);
                            }
                            errors++;
                          }
                          for (const key20 of Object.keys(data60)) {
                            if (!(key20 === "handle")) {
                              const err187 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/10/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key20 }, message: "must NOT have additional properties" };
                              if (vErrors === null) {
                                vErrors = [err187];
                              } else {
                                vErrors.push(err187);
                              }
                              errors++;
                            }
                          }
                          if (data60.handle !== void 0 && func0.call(data60, "handle")) {
                            let data61 = data60.handle;
                            if (typeof data61 === "string") {
                              if (func55(data61) > 128) {
                                const err188 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/10/properties/value/properties/handle/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                                if (vErrors === null) {
                                  vErrors = [err188];
                                } else {
                                  vErrors.push(err188);
                                }
                                errors++;
                              }
                              if (func55(data61) < 1) {
                                const err189 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/10/properties/value/properties/handle/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                if (vErrors === null) {
                                  vErrors = [err189];
                                } else {
                                  vErrors.push(err189);
                                }
                                errors++;
                              }
                              if (!pattern0.test(data61)) {
                                const err190 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/10/properties/value/properties/handle/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                                if (vErrors === null) {
                                  vErrors = [err190];
                                } else {
                                  vErrors.push(err190);
                                }
                                errors++;
                              }
                            } else {
                              const err191 = { instancePath: instancePath + "/value/handle", schemaPath: "#/oneOf/10/properties/value/properties/handle/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                              if (vErrors === null) {
                                vErrors = [err191];
                              } else {
                                vErrors.push(err191);
                              }
                              errors++;
                            }
                          }
                        } else {
                          const err192 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/10/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                          if (vErrors === null) {
                            vErrors = [err192];
                          } else {
                            vErrors.push(err192);
                          }
                          errors++;
                        }
                      }
                    } else {
                      const err193 = { instancePath, schemaPath: "#/oneOf/10/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                      if (vErrors === null) {
                        vErrors = [err193];
                      } else {
                        vErrors.push(err193);
                      }
                      errors++;
                    }
                    var _valid0 = _errs123 === errors;
                    if (_valid0 && valid0) {
                      valid0 = false;
                      passing0 = [passing0, 10];
                    } else {
                      if (_valid0) {
                        valid0 = true;
                        passing0 = 10;
                      }
                      const _errs134 = errors;
                      if (data && typeof data == "object" && !Array.isArray(data)) {
                        if (data.capability === void 0 || !func0.call(data, "capability")) {
                          const err194 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                          if (vErrors === null) {
                            vErrors = [err194];
                          } else {
                            vErrors.push(err194);
                          }
                          errors++;
                        }
                        if (data.method === void 0 || !func0.call(data, "method")) {
                          const err195 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                          if (vErrors === null) {
                            vErrors = [err195];
                          } else {
                            vErrors.push(err195);
                          }
                          errors++;
                        }
                        if (data.direction === void 0 || !func0.call(data, "direction")) {
                          const err196 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                          if (vErrors === null) {
                            vErrors = [err196];
                          } else {
                            vErrors.push(err196);
                          }
                          errors++;
                        }
                        if (data.value === void 0 || !func0.call(data, "value")) {
                          const err197 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                          if (vErrors === null) {
                            vErrors = [err197];
                          } else {
                            vErrors.push(err197);
                          }
                          errors++;
                        }
                        for (const key21 of Object.keys(data)) {
                          if (!(key21 === "capability" || key21 === "method" || key21 === "direction" || key21 === "value")) {
                            const err198 = { instancePath, schemaPath: "#/oneOf/11/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key21 }, message: "must NOT have additional properties" };
                            if (vErrors === null) {
                              vErrors = [err198];
                            } else {
                              vErrors.push(err198);
                            }
                            errors++;
                          }
                        }
                        if (data.capability !== void 0 && func0.call(data, "capability")) {
                          if ("aplg.fs" !== data.capability) {
                            const err199 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/11/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                            if (vErrors === null) {
                              vErrors = [err199];
                            } else {
                              vErrors.push(err199);
                            }
                            errors++;
                          }
                        }
                        if (data.method !== void 0 && func0.call(data, "method")) {
                          if ("transfer.abort" !== data.method) {
                            const err200 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/11/properties/method/const", keyword: "const", params: { allowedValue: "transfer.abort" }, message: "must be equal to constant" };
                            if (vErrors === null) {
                              vErrors = [err200];
                            } else {
                              vErrors.push(err200);
                            }
                            errors++;
                          }
                        }
                        if (data.direction !== void 0 && func0.call(data, "direction")) {
                          if ("result" !== data.direction) {
                            const err201 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/11/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                            if (vErrors === null) {
                              vErrors = [err201];
                            } else {
                              vErrors.push(err201);
                            }
                            errors++;
                          }
                        }
                        if (data.value !== void 0 && func0.call(data, "value")) {
                          if (data.value !== null) {
                            const err202 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/11/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                            if (vErrors === null) {
                              vErrors = [err202];
                            } else {
                              vErrors.push(err202);
                            }
                            errors++;
                          }
                        }
                      } else {
                        const err203 = { instancePath, schemaPath: "#/oneOf/11/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                        if (vErrors === null) {
                          vErrors = [err203];
                        } else {
                          vErrors.push(err203);
                        }
                        errors++;
                      }
                      var _valid0 = _errs134 === errors;
                      if (_valid0 && valid0) {
                        valid0 = false;
                        passing0 = [passing0, 11];
                      } else {
                        if (_valid0) {
                          valid0 = true;
                          passing0 = 11;
                        }
                        const _errs142 = errors;
                        if (data && typeof data == "object" && !Array.isArray(data)) {
                          if (data.capability === void 0 || !func0.call(data, "capability")) {
                            const err204 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                            if (vErrors === null) {
                              vErrors = [err204];
                            } else {
                              vErrors.push(err204);
                            }
                            errors++;
                          }
                          if (data.method === void 0 || !func0.call(data, "method")) {
                            const err205 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                            if (vErrors === null) {
                              vErrors = [err205];
                            } else {
                              vErrors.push(err205);
                            }
                            errors++;
                          }
                          if (data.direction === void 0 || !func0.call(data, "direction")) {
                            const err206 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                            if (vErrors === null) {
                              vErrors = [err206];
                            } else {
                              vErrors.push(err206);
                            }
                            errors++;
                          }
                          if (data.value === void 0 || !func0.call(data, "value")) {
                            const err207 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                            if (vErrors === null) {
                              vErrors = [err207];
                            } else {
                              vErrors.push(err207);
                            }
                            errors++;
                          }
                          for (const key22 of Object.keys(data)) {
                            if (!(key22 === "capability" || key22 === "method" || key22 === "direction" || key22 === "value")) {
                              const err208 = { instancePath, schemaPath: "#/oneOf/12/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key22 }, message: "must NOT have additional properties" };
                              if (vErrors === null) {
                                vErrors = [err208];
                              } else {
                                vErrors.push(err208);
                              }
                              errors++;
                            }
                          }
                          if (data.capability !== void 0 && func0.call(data, "capability")) {
                            if ("aplg.fs" !== data.capability) {
                              const err209 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/12/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                              if (vErrors === null) {
                                vErrors = [err209];
                              } else {
                                vErrors.push(err209);
                              }
                              errors++;
                            }
                          }
                          if (data.method !== void 0 && func0.call(data, "method")) {
                            if ("stat" !== data.method) {
                              const err210 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/12/properties/method/const", keyword: "const", params: { allowedValue: "stat" }, message: "must be equal to constant" };
                              if (vErrors === null) {
                                vErrors = [err210];
                              } else {
                                vErrors.push(err210);
                              }
                              errors++;
                            }
                          }
                          if (data.direction !== void 0 && func0.call(data, "direction")) {
                            if ("request" !== data.direction) {
                              const err211 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/12/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                              if (vErrors === null) {
                                vErrors = [err211];
                              } else {
                                vErrors.push(err211);
                              }
                              errors++;
                            }
                          }
                          if (data.value !== void 0 && func0.call(data, "value")) {
                            let data69 = data.value;
                            if (data69 && typeof data69 == "object" && !Array.isArray(data69)) {
                              if (data69.path === void 0 || !func0.call(data69, "path")) {
                                const err212 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/12/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                                if (vErrors === null) {
                                  vErrors = [err212];
                                } else {
                                  vErrors.push(err212);
                                }
                                errors++;
                              }
                              for (const key23 of Object.keys(data69)) {
                                if (!(key23 === "path")) {
                                  const err213 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/12/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key23 }, message: "must NOT have additional properties" };
                                  if (vErrors === null) {
                                    vErrors = [err213];
                                  } else {
                                    vErrors.push(err213);
                                  }
                                  errors++;
                                }
                              }
                              if (data69.path !== void 0 && func0.call(data69, "path")) {
                                let data70 = data69.path;
                                if (typeof data70 === "string") {
                                  if (func55(data70) > 4096) {
                                    const err214 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/12/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err214];
                                    } else {
                                      vErrors.push(err214);
                                    }
                                    errors++;
                                  }
                                  if (func55(data70) < 1) {
                                    const err215 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/12/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err215];
                                    } else {
                                      vErrors.push(err215);
                                    }
                                    errors++;
                                  }
                                } else {
                                  const err216 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/12/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                  if (vErrors === null) {
                                    vErrors = [err216];
                                  } else {
                                    vErrors.push(err216);
                                  }
                                  errors++;
                                }
                              }
                            } else {
                              const err217 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/12/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                              if (vErrors === null) {
                                vErrors = [err217];
                              } else {
                                vErrors.push(err217);
                              }
                              errors++;
                            }
                          }
                        } else {
                          const err218 = { instancePath, schemaPath: "#/oneOf/12/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                          if (vErrors === null) {
                            vErrors = [err218];
                          } else {
                            vErrors.push(err218);
                          }
                          errors++;
                        }
                        var _valid0 = _errs142 === errors;
                        if (_valid0 && valid0) {
                          valid0 = false;
                          passing0 = [passing0, 12];
                        } else {
                          if (_valid0) {
                            valid0 = true;
                            passing0 = 12;
                          }
                          const _errs153 = errors;
                          if (data && typeof data == "object" && !Array.isArray(data)) {
                            if (data.capability === void 0 || !func0.call(data, "capability")) {
                              const err219 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                              if (vErrors === null) {
                                vErrors = [err219];
                              } else {
                                vErrors.push(err219);
                              }
                              errors++;
                            }
                            if (data.method === void 0 || !func0.call(data, "method")) {
                              const err220 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                              if (vErrors === null) {
                                vErrors = [err220];
                              } else {
                                vErrors.push(err220);
                              }
                              errors++;
                            }
                            if (data.direction === void 0 || !func0.call(data, "direction")) {
                              const err221 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                              if (vErrors === null) {
                                vErrors = [err221];
                              } else {
                                vErrors.push(err221);
                              }
                              errors++;
                            }
                            if (data.value === void 0 || !func0.call(data, "value")) {
                              const err222 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                              if (vErrors === null) {
                                vErrors = [err222];
                              } else {
                                vErrors.push(err222);
                              }
                              errors++;
                            }
                            for (const key24 of Object.keys(data)) {
                              if (!(key24 === "capability" || key24 === "method" || key24 === "direction" || key24 === "value")) {
                                const err223 = { instancePath, schemaPath: "#/oneOf/13/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key24 }, message: "must NOT have additional properties" };
                                if (vErrors === null) {
                                  vErrors = [err223];
                                } else {
                                  vErrors.push(err223);
                                }
                                errors++;
                              }
                            }
                            if (data.capability !== void 0 && func0.call(data, "capability")) {
                              if ("aplg.fs" !== data.capability) {
                                const err224 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/13/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                if (vErrors === null) {
                                  vErrors = [err224];
                                } else {
                                  vErrors.push(err224);
                                }
                                errors++;
                              }
                            }
                            if (data.method !== void 0 && func0.call(data, "method")) {
                              if ("stat" !== data.method) {
                                const err225 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/13/properties/method/const", keyword: "const", params: { allowedValue: "stat" }, message: "must be equal to constant" };
                                if (vErrors === null) {
                                  vErrors = [err225];
                                } else {
                                  vErrors.push(err225);
                                }
                                errors++;
                              }
                            }
                            if (data.direction !== void 0 && func0.call(data, "direction")) {
                              if ("result" !== data.direction) {
                                const err226 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/13/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                if (vErrors === null) {
                                  vErrors = [err226];
                                } else {
                                  vErrors.push(err226);
                                }
                                errors++;
                              }
                            }
                            if (data.value !== void 0 && func0.call(data, "value")) {
                              let data74 = data.value;
                              if (data74 && typeof data74 == "object" && !Array.isArray(data74)) {
                                if (data74.kind === void 0 || !func0.call(data74, "kind")) {
                                  const err227 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/13/properties/value/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                                  if (vErrors === null) {
                                    vErrors = [err227];
                                  } else {
                                    vErrors.push(err227);
                                  }
                                  errors++;
                                }
                                if (data74.size === void 0 || !func0.call(data74, "size")) {
                                  const err228 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/13/properties/value/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
                                  if (vErrors === null) {
                                    vErrors = [err228];
                                  } else {
                                    vErrors.push(err228);
                                  }
                                  errors++;
                                }
                                if (data74.mtimeMs === void 0 || !func0.call(data74, "mtimeMs")) {
                                  const err229 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/13/properties/value/required", keyword: "required", params: { missingProperty: "mtimeMs" }, message: "must have required property 'mtimeMs'" };
                                  if (vErrors === null) {
                                    vErrors = [err229];
                                  } else {
                                    vErrors.push(err229);
                                  }
                                  errors++;
                                }
                                for (const key25 of Object.keys(data74)) {
                                  if (!(key25 === "kind" || key25 === "size" || key25 === "mtimeMs")) {
                                    const err230 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/13/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key25 }, message: "must NOT have additional properties" };
                                    if (vErrors === null) {
                                      vErrors = [err230];
                                    } else {
                                      vErrors.push(err230);
                                    }
                                    errors++;
                                  }
                                }
                                if (data74.kind !== void 0 && func0.call(data74, "kind")) {
                                  let data75 = data74.kind;
                                  if (!(data75 === "file" || data75 === "directory")) {
                                    const err231 = { instancePath: instancePath + "/value/kind", schemaPath: "#/oneOf/13/properties/value/properties/kind/enum", keyword: "enum", params: { allowedValues: schema13.oneOf[13].properties.value.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                                    if (vErrors === null) {
                                      vErrors = [err231];
                                    } else {
                                      vErrors.push(err231);
                                    }
                                    errors++;
                                  }
                                }
                                if (data74.size !== void 0 && func0.call(data74, "size")) {
                                  let data76 = data74.size;
                                  if (!(typeof data76 == "number" && (!(data76 % 1) && !isNaN(data76)) && isFinite(data76))) {
                                    const err232 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/13/properties/value/properties/size/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                    if (vErrors === null) {
                                      vErrors = [err232];
                                    } else {
                                      vErrors.push(err232);
                                    }
                                    errors++;
                                  }
                                  if (typeof data76 == "number" && isFinite(data76)) {
                                    if (data76 > 9007199254740991 || isNaN(data76)) {
                                      const err233 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/13/properties/value/properties/size/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
                                      if (vErrors === null) {
                                        vErrors = [err233];
                                      } else {
                                        vErrors.push(err233);
                                      }
                                      errors++;
                                    }
                                    if (data76 < 0 || isNaN(data76)) {
                                      const err234 = { instancePath: instancePath + "/value/size", schemaPath: "#/oneOf/13/properties/value/properties/size/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                                      if (vErrors === null) {
                                        vErrors = [err234];
                                      } else {
                                        vErrors.push(err234);
                                      }
                                      errors++;
                                    }
                                  }
                                }
                                if (data74.mtimeMs !== void 0 && func0.call(data74, "mtimeMs")) {
                                  let data77 = data74.mtimeMs;
                                  if (!(typeof data77 == "number" && isFinite(data77))) {
                                    const err235 = { instancePath: instancePath + "/value/mtimeMs", schemaPath: "#/oneOf/13/properties/value/properties/mtimeMs/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                                    if (vErrors === null) {
                                      vErrors = [err235];
                                    } else {
                                      vErrors.push(err235);
                                    }
                                    errors++;
                                  }
                                }
                              } else {
                                const err236 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/13/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err236];
                                } else {
                                  vErrors.push(err236);
                                }
                                errors++;
                              }
                            }
                          } else {
                            const err237 = { instancePath, schemaPath: "#/oneOf/13/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                            if (vErrors === null) {
                              vErrors = [err237];
                            } else {
                              vErrors.push(err237);
                            }
                            errors++;
                          }
                          var _valid0 = _errs153 === errors;
                          if (_valid0 && valid0) {
                            valid0 = false;
                            passing0 = [passing0, 13];
                          } else {
                            if (_valid0) {
                              valid0 = true;
                              passing0 = 13;
                            }
                            const _errs167 = errors;
                            if (data && typeof data == "object" && !Array.isArray(data)) {
                              if (data.capability === void 0 || !func0.call(data, "capability")) {
                                const err238 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                if (vErrors === null) {
                                  vErrors = [err238];
                                } else {
                                  vErrors.push(err238);
                                }
                                errors++;
                              }
                              if (data.method === void 0 || !func0.call(data, "method")) {
                                const err239 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                if (vErrors === null) {
                                  vErrors = [err239];
                                } else {
                                  vErrors.push(err239);
                                }
                                errors++;
                              }
                              if (data.direction === void 0 || !func0.call(data, "direction")) {
                                const err240 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                if (vErrors === null) {
                                  vErrors = [err240];
                                } else {
                                  vErrors.push(err240);
                                }
                                errors++;
                              }
                              if (data.value === void 0 || !func0.call(data, "value")) {
                                const err241 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                if (vErrors === null) {
                                  vErrors = [err241];
                                } else {
                                  vErrors.push(err241);
                                }
                                errors++;
                              }
                              for (const key26 of Object.keys(data)) {
                                if (!(key26 === "capability" || key26 === "method" || key26 === "direction" || key26 === "value")) {
                                  const err242 = { instancePath, schemaPath: "#/oneOf/14/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key26 }, message: "must NOT have additional properties" };
                                  if (vErrors === null) {
                                    vErrors = [err242];
                                  } else {
                                    vErrors.push(err242);
                                  }
                                  errors++;
                                }
                              }
                              if (data.capability !== void 0 && func0.call(data, "capability")) {
                                if ("aplg.fs" !== data.capability) {
                                  const err243 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/14/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err243];
                                  } else {
                                    vErrors.push(err243);
                                  }
                                  errors++;
                                }
                              }
                              if (data.method !== void 0 && func0.call(data, "method")) {
                                if ("readdir" !== data.method) {
                                  const err244 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/14/properties/method/const", keyword: "const", params: { allowedValue: "readdir" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err244];
                                  } else {
                                    vErrors.push(err244);
                                  }
                                  errors++;
                                }
                              }
                              if (data.direction !== void 0 && func0.call(data, "direction")) {
                                if ("request" !== data.direction) {
                                  const err245 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/14/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err245];
                                  } else {
                                    vErrors.push(err245);
                                  }
                                  errors++;
                                }
                              }
                              if (data.value !== void 0 && func0.call(data, "value")) {
                                let data81 = data.value;
                                if (data81 && typeof data81 == "object" && !Array.isArray(data81)) {
                                  if (data81.path === void 0 || !func0.call(data81, "path")) {
                                    const err246 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/14/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                                    if (vErrors === null) {
                                      vErrors = [err246];
                                    } else {
                                      vErrors.push(err246);
                                    }
                                    errors++;
                                  }
                                  for (const key27 of Object.keys(data81)) {
                                    if (!(key27 === "path")) {
                                      const err247 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/14/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key27 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err247];
                                      } else {
                                        vErrors.push(err247);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data81.path !== void 0 && func0.call(data81, "path")) {
                                    let data82 = data81.path;
                                    if (typeof data82 === "string") {
                                      if (func55(data82) > 4096) {
                                        const err248 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/14/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                        if (vErrors === null) {
                                          vErrors = [err248];
                                        } else {
                                          vErrors.push(err248);
                                        }
                                        errors++;
                                      }
                                      if (func55(data82) < 1) {
                                        const err249 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/14/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                        if (vErrors === null) {
                                          vErrors = [err249];
                                        } else {
                                          vErrors.push(err249);
                                        }
                                        errors++;
                                      }
                                    } else {
                                      const err250 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/14/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                      if (vErrors === null) {
                                        vErrors = [err250];
                                      } else {
                                        vErrors.push(err250);
                                      }
                                      errors++;
                                    }
                                  }
                                } else {
                                  const err251 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/14/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                  if (vErrors === null) {
                                    vErrors = [err251];
                                  } else {
                                    vErrors.push(err251);
                                  }
                                  errors++;
                                }
                              }
                            } else {
                              const err252 = { instancePath, schemaPath: "#/oneOf/14/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                              if (vErrors === null) {
                                vErrors = [err252];
                              } else {
                                vErrors.push(err252);
                              }
                              errors++;
                            }
                            var _valid0 = _errs167 === errors;
                            if (_valid0 && valid0) {
                              valid0 = false;
                              passing0 = [passing0, 14];
                            } else {
                              if (_valid0) {
                                valid0 = true;
                                passing0 = 14;
                              }
                              const _errs178 = errors;
                              if (data && typeof data == "object" && !Array.isArray(data)) {
                                if (data.capability === void 0 || !func0.call(data, "capability")) {
                                  const err253 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                  if (vErrors === null) {
                                    vErrors = [err253];
                                  } else {
                                    vErrors.push(err253);
                                  }
                                  errors++;
                                }
                                if (data.method === void 0 || !func0.call(data, "method")) {
                                  const err254 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                  if (vErrors === null) {
                                    vErrors = [err254];
                                  } else {
                                    vErrors.push(err254);
                                  }
                                  errors++;
                                }
                                if (data.direction === void 0 || !func0.call(data, "direction")) {
                                  const err255 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                  if (vErrors === null) {
                                    vErrors = [err255];
                                  } else {
                                    vErrors.push(err255);
                                  }
                                  errors++;
                                }
                                if (data.value === void 0 || !func0.call(data, "value")) {
                                  const err256 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                  if (vErrors === null) {
                                    vErrors = [err256];
                                  } else {
                                    vErrors.push(err256);
                                  }
                                  errors++;
                                }
                                for (const key28 of Object.keys(data)) {
                                  if (!(key28 === "capability" || key28 === "method" || key28 === "direction" || key28 === "value")) {
                                    const err257 = { instancePath, schemaPath: "#/oneOf/15/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key28 }, message: "must NOT have additional properties" };
                                    if (vErrors === null) {
                                      vErrors = [err257];
                                    } else {
                                      vErrors.push(err257);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.capability !== void 0 && func0.call(data, "capability")) {
                                  if ("aplg.fs" !== data.capability) {
                                    const err258 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/15/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err258];
                                    } else {
                                      vErrors.push(err258);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.method !== void 0 && func0.call(data, "method")) {
                                  if ("readdir" !== data.method) {
                                    const err259 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/15/properties/method/const", keyword: "const", params: { allowedValue: "readdir" }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err259];
                                    } else {
                                      vErrors.push(err259);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.direction !== void 0 && func0.call(data, "direction")) {
                                  if ("result" !== data.direction) {
                                    const err260 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/15/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err260];
                                    } else {
                                      vErrors.push(err260);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.value !== void 0 && func0.call(data, "value")) {
                                  let data86 = data.value;
                                  if (Array.isArray(data86)) {
                                    if (data86.length > 1e4) {
                                      const err261 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/15/properties/value/maxItems", keyword: "maxItems", params: { limit: 1e4 }, message: "must NOT have more than 10000 items" };
                                      if (vErrors === null) {
                                        vErrors = [err261];
                                      } else {
                                        vErrors.push(err261);
                                      }
                                      errors++;
                                    }
                                    const len0 = data86.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                      let data87 = data86[i0];
                                      if (data87 && typeof data87 == "object" && !Array.isArray(data87)) {
                                        if (data87.name === void 0 || !func0.call(data87, "name")) {
                                          const err262 = { instancePath: instancePath + "/value/" + i0, schemaPath: "#/oneOf/15/properties/value/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                                          if (vErrors === null) {
                                            vErrors = [err262];
                                          } else {
                                            vErrors.push(err262);
                                          }
                                          errors++;
                                        }
                                        if (data87.kind === void 0 || !func0.call(data87, "kind")) {
                                          const err263 = { instancePath: instancePath + "/value/" + i0, schemaPath: "#/oneOf/15/properties/value/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                                          if (vErrors === null) {
                                            vErrors = [err263];
                                          } else {
                                            vErrors.push(err263);
                                          }
                                          errors++;
                                        }
                                        for (const key29 of Object.keys(data87)) {
                                          if (!(key29 === "name" || key29 === "kind")) {
                                            const err264 = { instancePath: instancePath + "/value/" + i0, schemaPath: "#/oneOf/15/properties/value/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key29 }, message: "must NOT have additional properties" };
                                            if (vErrors === null) {
                                              vErrors = [err264];
                                            } else {
                                              vErrors.push(err264);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data87.name !== void 0 && func0.call(data87, "name")) {
                                          let data88 = data87.name;
                                          if (typeof data88 === "string") {
                                            if (func55(data88) > 255) {
                                              const err265 = { instancePath: instancePath + "/value/" + i0 + "/name", schemaPath: "#/oneOf/15/properties/value/items/properties/name/maxLength", keyword: "maxLength", params: { limit: 255 }, message: "must NOT have more than 255 characters" };
                                              if (vErrors === null) {
                                                vErrors = [err265];
                                              } else {
                                                vErrors.push(err265);
                                              }
                                              errors++;
                                            }
                                            if (func55(data88) < 1) {
                                              const err266 = { instancePath: instancePath + "/value/" + i0 + "/name", schemaPath: "#/oneOf/15/properties/value/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                              if (vErrors === null) {
                                                vErrors = [err266];
                                              } else {
                                                vErrors.push(err266);
                                              }
                                              errors++;
                                            }
                                          } else {
                                            const err267 = { instancePath: instancePath + "/value/" + i0 + "/name", schemaPath: "#/oneOf/15/properties/value/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                            if (vErrors === null) {
                                              vErrors = [err267];
                                            } else {
                                              vErrors.push(err267);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data87.kind !== void 0 && func0.call(data87, "kind")) {
                                          let data89 = data87.kind;
                                          if (!(data89 === "file" || data89 === "directory")) {
                                            const err268 = { instancePath: instancePath + "/value/" + i0 + "/kind", schemaPath: "#/oneOf/15/properties/value/items/properties/kind/enum", keyword: "enum", params: { allowedValues: schema13.oneOf[15].properties.value.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                                            if (vErrors === null) {
                                              vErrors = [err268];
                                            } else {
                                              vErrors.push(err268);
                                            }
                                            errors++;
                                          }
                                        }
                                      } else {
                                        const err269 = { instancePath: instancePath + "/value/" + i0, schemaPath: "#/oneOf/15/properties/value/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                        if (vErrors === null) {
                                          vErrors = [err269];
                                        } else {
                                          vErrors.push(err269);
                                        }
                                        errors++;
                                      }
                                    }
                                  } else {
                                    const err270 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/15/properties/value/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                    if (vErrors === null) {
                                      vErrors = [err270];
                                    } else {
                                      vErrors.push(err270);
                                    }
                                    errors++;
                                  }
                                }
                              } else {
                                const err271 = { instancePath, schemaPath: "#/oneOf/15/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err271];
                                } else {
                                  vErrors.push(err271);
                                }
                                errors++;
                              }
                              var _valid0 = _errs178 === errors;
                              if (_valid0 && valid0) {
                                valid0 = false;
                                passing0 = [passing0, 15];
                              } else {
                                if (_valid0) {
                                  valid0 = true;
                                  passing0 = 15;
                                }
                                const _errs192 = errors;
                                if (data && typeof data == "object" && !Array.isArray(data)) {
                                  if (data.capability === void 0 || !func0.call(data, "capability")) {
                                    const err272 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                    if (vErrors === null) {
                                      vErrors = [err272];
                                    } else {
                                      vErrors.push(err272);
                                    }
                                    errors++;
                                  }
                                  if (data.method === void 0 || !func0.call(data, "method")) {
                                    const err273 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                    if (vErrors === null) {
                                      vErrors = [err273];
                                    } else {
                                      vErrors.push(err273);
                                    }
                                    errors++;
                                  }
                                  if (data.direction === void 0 || !func0.call(data, "direction")) {
                                    const err274 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                    if (vErrors === null) {
                                      vErrors = [err274];
                                    } else {
                                      vErrors.push(err274);
                                    }
                                    errors++;
                                  }
                                  if (data.value === void 0 || !func0.call(data, "value")) {
                                    const err275 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                    if (vErrors === null) {
                                      vErrors = [err275];
                                    } else {
                                      vErrors.push(err275);
                                    }
                                    errors++;
                                  }
                                  for (const key30 of Object.keys(data)) {
                                    if (!(key30 === "capability" || key30 === "method" || key30 === "direction" || key30 === "value")) {
                                      const err276 = { instancePath, schemaPath: "#/oneOf/16/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key30 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err276];
                                      } else {
                                        vErrors.push(err276);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.capability !== void 0 && func0.call(data, "capability")) {
                                    if ("aplg.fs" !== data.capability) {
                                      const err277 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/16/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err277];
                                      } else {
                                        vErrors.push(err277);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.method !== void 0 && func0.call(data, "method")) {
                                    if ("mkdir" !== data.method) {
                                      const err278 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/16/properties/method/const", keyword: "const", params: { allowedValue: "mkdir" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err278];
                                      } else {
                                        vErrors.push(err278);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.direction !== void 0 && func0.call(data, "direction")) {
                                    if ("request" !== data.direction) {
                                      const err279 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/16/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err279];
                                      } else {
                                        vErrors.push(err279);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.value !== void 0 && func0.call(data, "value")) {
                                    let data93 = data.value;
                                    if (data93 && typeof data93 == "object" && !Array.isArray(data93)) {
                                      if (data93.path === void 0 || !func0.call(data93, "path")) {
                                        const err280 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/16/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                                        if (vErrors === null) {
                                          vErrors = [err280];
                                        } else {
                                          vErrors.push(err280);
                                        }
                                        errors++;
                                      }
                                      if (data93.recursive === void 0 || !func0.call(data93, "recursive")) {
                                        const err281 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/16/properties/value/required", keyword: "required", params: { missingProperty: "recursive" }, message: "must have required property 'recursive'" };
                                        if (vErrors === null) {
                                          vErrors = [err281];
                                        } else {
                                          vErrors.push(err281);
                                        }
                                        errors++;
                                      }
                                      for (const key31 of Object.keys(data93)) {
                                        if (!(key31 === "path" || key31 === "recursive")) {
                                          const err282 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/16/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key31 }, message: "must NOT have additional properties" };
                                          if (vErrors === null) {
                                            vErrors = [err282];
                                          } else {
                                            vErrors.push(err282);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data93.path !== void 0 && func0.call(data93, "path")) {
                                        let data94 = data93.path;
                                        if (typeof data94 === "string") {
                                          if (func55(data94) > 4096) {
                                            const err283 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/16/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                            if (vErrors === null) {
                                              vErrors = [err283];
                                            } else {
                                              vErrors.push(err283);
                                            }
                                            errors++;
                                          }
                                          if (func55(data94) < 1) {
                                            const err284 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/16/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                            if (vErrors === null) {
                                              vErrors = [err284];
                                            } else {
                                              vErrors.push(err284);
                                            }
                                            errors++;
                                          }
                                        } else {
                                          const err285 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/16/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                          if (vErrors === null) {
                                            vErrors = [err285];
                                          } else {
                                            vErrors.push(err285);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data93.recursive !== void 0 && func0.call(data93, "recursive")) {
                                        if (typeof data93.recursive !== "boolean") {
                                          const err286 = { instancePath: instancePath + "/value/recursive", schemaPath: "#/oneOf/16/properties/value/properties/recursive/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                          if (vErrors === null) {
                                            vErrors = [err286];
                                          } else {
                                            vErrors.push(err286);
                                          }
                                          errors++;
                                        }
                                      }
                                    } else {
                                      const err287 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/16/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                      if (vErrors === null) {
                                        vErrors = [err287];
                                      } else {
                                        vErrors.push(err287);
                                      }
                                      errors++;
                                    }
                                  }
                                } else {
                                  const err288 = { instancePath, schemaPath: "#/oneOf/16/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                  if (vErrors === null) {
                                    vErrors = [err288];
                                  } else {
                                    vErrors.push(err288);
                                  }
                                  errors++;
                                }
                                var _valid0 = _errs192 === errors;
                                if (_valid0 && valid0) {
                                  valid0 = false;
                                  passing0 = [passing0, 16];
                                } else {
                                  if (_valid0) {
                                    valid0 = true;
                                    passing0 = 16;
                                  }
                                  const _errs205 = errors;
                                  if (data && typeof data == "object" && !Array.isArray(data)) {
                                    if (data.capability === void 0 || !func0.call(data, "capability")) {
                                      const err289 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                      if (vErrors === null) {
                                        vErrors = [err289];
                                      } else {
                                        vErrors.push(err289);
                                      }
                                      errors++;
                                    }
                                    if (data.method === void 0 || !func0.call(data, "method")) {
                                      const err290 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                      if (vErrors === null) {
                                        vErrors = [err290];
                                      } else {
                                        vErrors.push(err290);
                                      }
                                      errors++;
                                    }
                                    if (data.direction === void 0 || !func0.call(data, "direction")) {
                                      const err291 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                      if (vErrors === null) {
                                        vErrors = [err291];
                                      } else {
                                        vErrors.push(err291);
                                      }
                                      errors++;
                                    }
                                    if (data.value === void 0 || !func0.call(data, "value")) {
                                      const err292 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                      if (vErrors === null) {
                                        vErrors = [err292];
                                      } else {
                                        vErrors.push(err292);
                                      }
                                      errors++;
                                    }
                                    for (const key32 of Object.keys(data)) {
                                      if (!(key32 === "capability" || key32 === "method" || key32 === "direction" || key32 === "value")) {
                                        const err293 = { instancePath, schemaPath: "#/oneOf/17/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key32 }, message: "must NOT have additional properties" };
                                        if (vErrors === null) {
                                          vErrors = [err293];
                                        } else {
                                          vErrors.push(err293);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.capability !== void 0 && func0.call(data, "capability")) {
                                      if ("aplg.fs" !== data.capability) {
                                        const err294 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/17/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err294];
                                        } else {
                                          vErrors.push(err294);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.method !== void 0 && func0.call(data, "method")) {
                                      if ("mkdir" !== data.method) {
                                        const err295 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/17/properties/method/const", keyword: "const", params: { allowedValue: "mkdir" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err295];
                                        } else {
                                          vErrors.push(err295);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.direction !== void 0 && func0.call(data, "direction")) {
                                      if ("result" !== data.direction) {
                                        const err296 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/17/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err296];
                                        } else {
                                          vErrors.push(err296);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.value !== void 0 && func0.call(data, "value")) {
                                      let data99 = data.value;
                                      if (data99 && typeof data99 == "object" && !Array.isArray(data99)) {
                                        if (data99.createdPath === void 0 || !func0.call(data99, "createdPath")) {
                                          const err297 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/17/properties/value/required", keyword: "required", params: { missingProperty: "createdPath" }, message: "must have required property 'createdPath'" };
                                          if (vErrors === null) {
                                            vErrors = [err297];
                                          } else {
                                            vErrors.push(err297);
                                          }
                                          errors++;
                                        }
                                        for (const key33 of Object.keys(data99)) {
                                          if (!(key33 === "createdPath")) {
                                            const err298 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/17/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key33 }, message: "must NOT have additional properties" };
                                            if (vErrors === null) {
                                              vErrors = [err298];
                                            } else {
                                              vErrors.push(err298);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data99.createdPath !== void 0 && func0.call(data99, "createdPath")) {
                                          let data100 = data99.createdPath;
                                          const _errs215 = errors;
                                          let valid37 = false;
                                          const _errs216 = errors;
                                          if (data100 !== null) {
                                            const err299 = { instancePath: instancePath + "/value/createdPath", schemaPath: "#/oneOf/17/properties/value/properties/createdPath/anyOf/0/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err299];
                                            } else {
                                              vErrors.push(err299);
                                            }
                                            errors++;
                                          }
                                          var _valid1 = _errs216 === errors;
                                          valid37 = valid37 || _valid1;
                                          if (!valid37) {
                                            const _errs218 = errors;
                                            if (typeof data100 === "string") {
                                              if (func55(data100) > 4096) {
                                                const err300 = { instancePath: instancePath + "/value/createdPath", schemaPath: "#/oneOf/17/properties/value/properties/createdPath/anyOf/1/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err300];
                                                } else {
                                                  vErrors.push(err300);
                                                }
                                                errors++;
                                              }
                                              if (func55(data100) < 1) {
                                                const err301 = { instancePath: instancePath + "/value/createdPath", schemaPath: "#/oneOf/17/properties/value/properties/createdPath/anyOf/1/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err301];
                                                } else {
                                                  vErrors.push(err301);
                                                }
                                                errors++;
                                              }
                                            } else {
                                              const err302 = { instancePath: instancePath + "/value/createdPath", schemaPath: "#/oneOf/17/properties/value/properties/createdPath/anyOf/1/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                              if (vErrors === null) {
                                                vErrors = [err302];
                                              } else {
                                                vErrors.push(err302);
                                              }
                                              errors++;
                                            }
                                            var _valid1 = _errs218 === errors;
                                            valid37 = valid37 || _valid1;
                                          }
                                          if (!valid37) {
                                            const err303 = { instancePath: instancePath + "/value/createdPath", schemaPath: "#/oneOf/17/properties/value/properties/createdPath/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                                            if (vErrors === null) {
                                              vErrors = [err303];
                                            } else {
                                              vErrors.push(err303);
                                            }
                                            errors++;
                                          } else {
                                            errors = _errs215;
                                            if (vErrors !== null) {
                                              if (_errs215) {
                                                vErrors.length = _errs215;
                                              } else {
                                                vErrors = null;
                                              }
                                            }
                                          }
                                        }
                                      } else {
                                        const err304 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/17/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                        if (vErrors === null) {
                                          vErrors = [err304];
                                        } else {
                                          vErrors.push(err304);
                                        }
                                        errors++;
                                      }
                                    }
                                  } else {
                                    const err305 = { instancePath, schemaPath: "#/oneOf/17/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                    if (vErrors === null) {
                                      vErrors = [err305];
                                    } else {
                                      vErrors.push(err305);
                                    }
                                    errors++;
                                  }
                                  var _valid0 = _errs205 === errors;
                                  if (_valid0 && valid0) {
                                    valid0 = false;
                                    passing0 = [passing0, 17];
                                  } else {
                                    if (_valid0) {
                                      valid0 = true;
                                      passing0 = 17;
                                    }
                                    const _errs220 = errors;
                                    if (data && typeof data == "object" && !Array.isArray(data)) {
                                      if (data.capability === void 0 || !func0.call(data, "capability")) {
                                        const err306 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                        if (vErrors === null) {
                                          vErrors = [err306];
                                        } else {
                                          vErrors.push(err306);
                                        }
                                        errors++;
                                      }
                                      if (data.method === void 0 || !func0.call(data, "method")) {
                                        const err307 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                        if (vErrors === null) {
                                          vErrors = [err307];
                                        } else {
                                          vErrors.push(err307);
                                        }
                                        errors++;
                                      }
                                      if (data.direction === void 0 || !func0.call(data, "direction")) {
                                        const err308 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                        if (vErrors === null) {
                                          vErrors = [err308];
                                        } else {
                                          vErrors.push(err308);
                                        }
                                        errors++;
                                      }
                                      if (data.value === void 0 || !func0.call(data, "value")) {
                                        const err309 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                        if (vErrors === null) {
                                          vErrors = [err309];
                                        } else {
                                          vErrors.push(err309);
                                        }
                                        errors++;
                                      }
                                      for (const key34 of Object.keys(data)) {
                                        if (!(key34 === "capability" || key34 === "method" || key34 === "direction" || key34 === "value")) {
                                          const err310 = { instancePath, schemaPath: "#/oneOf/18/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key34 }, message: "must NOT have additional properties" };
                                          if (vErrors === null) {
                                            vErrors = [err310];
                                          } else {
                                            vErrors.push(err310);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.capability !== void 0 && func0.call(data, "capability")) {
                                        if ("aplg.fs" !== data.capability) {
                                          const err311 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/18/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err311];
                                          } else {
                                            vErrors.push(err311);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.method !== void 0 && func0.call(data, "method")) {
                                        if ("rename" !== data.method) {
                                          const err312 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/18/properties/method/const", keyword: "const", params: { allowedValue: "rename" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err312];
                                          } else {
                                            vErrors.push(err312);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.direction !== void 0 && func0.call(data, "direction")) {
                                        if ("request" !== data.direction) {
                                          const err313 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/18/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err313];
                                          } else {
                                            vErrors.push(err313);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.value !== void 0 && func0.call(data, "value")) {
                                        let data104 = data.value;
                                        if (data104 && typeof data104 == "object" && !Array.isArray(data104)) {
                                          if (data104.from === void 0 || !func0.call(data104, "from")) {
                                            const err314 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/18/properties/value/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
                                            if (vErrors === null) {
                                              vErrors = [err314];
                                            } else {
                                              vErrors.push(err314);
                                            }
                                            errors++;
                                          }
                                          if (data104.to === void 0 || !func0.call(data104, "to")) {
                                            const err315 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/18/properties/value/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
                                            if (vErrors === null) {
                                              vErrors = [err315];
                                            } else {
                                              vErrors.push(err315);
                                            }
                                            errors++;
                                          }
                                          for (const key35 of Object.keys(data104)) {
                                            if (!(key35 === "from" || key35 === "to")) {
                                              const err316 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/18/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key35 }, message: "must NOT have additional properties" };
                                              if (vErrors === null) {
                                                vErrors = [err316];
                                              } else {
                                                vErrors.push(err316);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data104.from !== void 0 && func0.call(data104, "from")) {
                                            let data105 = data104.from;
                                            if (typeof data105 === "string") {
                                              if (func55(data105) > 4096) {
                                                const err317 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/18/properties/value/properties/from/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err317];
                                                } else {
                                                  vErrors.push(err317);
                                                }
                                                errors++;
                                              }
                                              if (func55(data105) < 1) {
                                                const err318 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/18/properties/value/properties/from/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err318];
                                                } else {
                                                  vErrors.push(err318);
                                                }
                                                errors++;
                                              }
                                            } else {
                                              const err319 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/18/properties/value/properties/from/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                              if (vErrors === null) {
                                                vErrors = [err319];
                                              } else {
                                                vErrors.push(err319);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data104.to !== void 0 && func0.call(data104, "to")) {
                                            let data106 = data104.to;
                                            if (typeof data106 === "string") {
                                              if (func55(data106) > 4096) {
                                                const err320 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/18/properties/value/properties/to/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err320];
                                                } else {
                                                  vErrors.push(err320);
                                                }
                                                errors++;
                                              }
                                              if (func55(data106) < 1) {
                                                const err321 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/18/properties/value/properties/to/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err321];
                                                } else {
                                                  vErrors.push(err321);
                                                }
                                                errors++;
                                              }
                                            } else {
                                              const err322 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/18/properties/value/properties/to/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                              if (vErrors === null) {
                                                vErrors = [err322];
                                              } else {
                                                vErrors.push(err322);
                                              }
                                              errors++;
                                            }
                                          }
                                        } else {
                                          const err323 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/18/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                          if (vErrors === null) {
                                            vErrors = [err323];
                                          } else {
                                            vErrors.push(err323);
                                          }
                                          errors++;
                                        }
                                      }
                                    } else {
                                      const err324 = { instancePath, schemaPath: "#/oneOf/18/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                      if (vErrors === null) {
                                        vErrors = [err324];
                                      } else {
                                        vErrors.push(err324);
                                      }
                                      errors++;
                                    }
                                    var _valid0 = _errs220 === errors;
                                    if (_valid0 && valid0) {
                                      valid0 = false;
                                      passing0 = [passing0, 18];
                                    } else {
                                      if (_valid0) {
                                        valid0 = true;
                                        passing0 = 18;
                                      }
                                      const _errs233 = errors;
                                      if (data && typeof data == "object" && !Array.isArray(data)) {
                                        if (data.capability === void 0 || !func0.call(data, "capability")) {
                                          const err325 = { instancePath, schemaPath: "#/oneOf/19/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                          if (vErrors === null) {
                                            vErrors = [err325];
                                          } else {
                                            vErrors.push(err325);
                                          }
                                          errors++;
                                        }
                                        if (data.method === void 0 || !func0.call(data, "method")) {
                                          const err326 = { instancePath, schemaPath: "#/oneOf/19/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                          if (vErrors === null) {
                                            vErrors = [err326];
                                          } else {
                                            vErrors.push(err326);
                                          }
                                          errors++;
                                        }
                                        if (data.direction === void 0 || !func0.call(data, "direction")) {
                                          const err327 = { instancePath, schemaPath: "#/oneOf/19/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                          if (vErrors === null) {
                                            vErrors = [err327];
                                          } else {
                                            vErrors.push(err327);
                                          }
                                          errors++;
                                        }
                                        if (data.value === void 0 || !func0.call(data, "value")) {
                                          const err328 = { instancePath, schemaPath: "#/oneOf/19/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                          if (vErrors === null) {
                                            vErrors = [err328];
                                          } else {
                                            vErrors.push(err328);
                                          }
                                          errors++;
                                        }
                                        for (const key36 of Object.keys(data)) {
                                          if (!(key36 === "capability" || key36 === "method" || key36 === "direction" || key36 === "value")) {
                                            const err329 = { instancePath, schemaPath: "#/oneOf/19/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key36 }, message: "must NOT have additional properties" };
                                            if (vErrors === null) {
                                              vErrors = [err329];
                                            } else {
                                              vErrors.push(err329);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data.capability !== void 0 && func0.call(data, "capability")) {
                                          if ("aplg.fs" !== data.capability) {
                                            const err330 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/19/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                            if (vErrors === null) {
                                              vErrors = [err330];
                                            } else {
                                              vErrors.push(err330);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data.method !== void 0 && func0.call(data, "method")) {
                                          if ("rename" !== data.method) {
                                            const err331 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/19/properties/method/const", keyword: "const", params: { allowedValue: "rename" }, message: "must be equal to constant" };
                                            if (vErrors === null) {
                                              vErrors = [err331];
                                            } else {
                                              vErrors.push(err331);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data.direction !== void 0 && func0.call(data, "direction")) {
                                          if ("result" !== data.direction) {
                                            const err332 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/19/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                            if (vErrors === null) {
                                              vErrors = [err332];
                                            } else {
                                              vErrors.push(err332);
                                            }
                                            errors++;
                                          }
                                        }
                                        if (data.value !== void 0 && func0.call(data, "value")) {
                                          if (data.value !== null) {
                                            const err333 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/19/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err333];
                                            } else {
                                              vErrors.push(err333);
                                            }
                                            errors++;
                                          }
                                        }
                                      } else {
                                        const err334 = { instancePath, schemaPath: "#/oneOf/19/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                        if (vErrors === null) {
                                          vErrors = [err334];
                                        } else {
                                          vErrors.push(err334);
                                        }
                                        errors++;
                                      }
                                      var _valid0 = _errs233 === errors;
                                      if (_valid0 && valid0) {
                                        valid0 = false;
                                        passing0 = [passing0, 19];
                                      } else {
                                        if (_valid0) {
                                          valid0 = true;
                                          passing0 = 19;
                                        }
                                        const _errs241 = errors;
                                        if (data && typeof data == "object" && !Array.isArray(data)) {
                                          if (data.capability === void 0 || !func0.call(data, "capability")) {
                                            const err335 = { instancePath, schemaPath: "#/oneOf/20/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                            if (vErrors === null) {
                                              vErrors = [err335];
                                            } else {
                                              vErrors.push(err335);
                                            }
                                            errors++;
                                          }
                                          if (data.method === void 0 || !func0.call(data, "method")) {
                                            const err336 = { instancePath, schemaPath: "#/oneOf/20/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                            if (vErrors === null) {
                                              vErrors = [err336];
                                            } else {
                                              vErrors.push(err336);
                                            }
                                            errors++;
                                          }
                                          if (data.direction === void 0 || !func0.call(data, "direction")) {
                                            const err337 = { instancePath, schemaPath: "#/oneOf/20/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                            if (vErrors === null) {
                                              vErrors = [err337];
                                            } else {
                                              vErrors.push(err337);
                                            }
                                            errors++;
                                          }
                                          if (data.value === void 0 || !func0.call(data, "value")) {
                                            const err338 = { instancePath, schemaPath: "#/oneOf/20/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                            if (vErrors === null) {
                                              vErrors = [err338];
                                            } else {
                                              vErrors.push(err338);
                                            }
                                            errors++;
                                          }
                                          for (const key37 of Object.keys(data)) {
                                            if (!(key37 === "capability" || key37 === "method" || key37 === "direction" || key37 === "value")) {
                                              const err339 = { instancePath, schemaPath: "#/oneOf/20/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key37 }, message: "must NOT have additional properties" };
                                              if (vErrors === null) {
                                                vErrors = [err339];
                                              } else {
                                                vErrors.push(err339);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data.capability !== void 0 && func0.call(data, "capability")) {
                                            if ("aplg.fs" !== data.capability) {
                                              const err340 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/20/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                              if (vErrors === null) {
                                                vErrors = [err340];
                                              } else {
                                                vErrors.push(err340);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data.method !== void 0 && func0.call(data, "method")) {
                                            if ("copyFile" !== data.method) {
                                              const err341 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/20/properties/method/const", keyword: "const", params: { allowedValue: "copyFile" }, message: "must be equal to constant" };
                                              if (vErrors === null) {
                                                vErrors = [err341];
                                              } else {
                                                vErrors.push(err341);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data.direction !== void 0 && func0.call(data, "direction")) {
                                            if ("request" !== data.direction) {
                                              const err342 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/20/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                                              if (vErrors === null) {
                                                vErrors = [err342];
                                              } else {
                                                vErrors.push(err342);
                                              }
                                              errors++;
                                            }
                                          }
                                          if (data.value !== void 0 && func0.call(data, "value")) {
                                            let data114 = data.value;
                                            if (data114 && typeof data114 == "object" && !Array.isArray(data114)) {
                                              if (data114.from === void 0 || !func0.call(data114, "from")) {
                                                const err343 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/20/properties/value/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
                                                if (vErrors === null) {
                                                  vErrors = [err343];
                                                } else {
                                                  vErrors.push(err343);
                                                }
                                                errors++;
                                              }
                                              if (data114.to === void 0 || !func0.call(data114, "to")) {
                                                const err344 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/20/properties/value/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
                                                if (vErrors === null) {
                                                  vErrors = [err344];
                                                } else {
                                                  vErrors.push(err344);
                                                }
                                                errors++;
                                              }
                                              for (const key38 of Object.keys(data114)) {
                                                if (!(key38 === "from" || key38 === "to")) {
                                                  const err345 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/20/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key38 }, message: "must NOT have additional properties" };
                                                  if (vErrors === null) {
                                                    vErrors = [err345];
                                                  } else {
                                                    vErrors.push(err345);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data114.from !== void 0 && func0.call(data114, "from")) {
                                                let data115 = data114.from;
                                                if (typeof data115 === "string") {
                                                  if (func55(data115) > 4096) {
                                                    const err346 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/20/properties/value/properties/from/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                    if (vErrors === null) {
                                                      vErrors = [err346];
                                                    } else {
                                                      vErrors.push(err346);
                                                    }
                                                    errors++;
                                                  }
                                                  if (func55(data115) < 1) {
                                                    const err347 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/20/properties/value/properties/from/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                    if (vErrors === null) {
                                                      vErrors = [err347];
                                                    } else {
                                                      vErrors.push(err347);
                                                    }
                                                    errors++;
                                                  }
                                                } else {
                                                  const err348 = { instancePath: instancePath + "/value/from", schemaPath: "#/oneOf/20/properties/value/properties/from/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                  if (vErrors === null) {
                                                    vErrors = [err348];
                                                  } else {
                                                    vErrors.push(err348);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data114.to !== void 0 && func0.call(data114, "to")) {
                                                let data116 = data114.to;
                                                if (typeof data116 === "string") {
                                                  if (func55(data116) > 4096) {
                                                    const err349 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/20/properties/value/properties/to/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                    if (vErrors === null) {
                                                      vErrors = [err349];
                                                    } else {
                                                      vErrors.push(err349);
                                                    }
                                                    errors++;
                                                  }
                                                  if (func55(data116) < 1) {
                                                    const err350 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/20/properties/value/properties/to/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                    if (vErrors === null) {
                                                      vErrors = [err350];
                                                    } else {
                                                      vErrors.push(err350);
                                                    }
                                                    errors++;
                                                  }
                                                } else {
                                                  const err351 = { instancePath: instancePath + "/value/to", schemaPath: "#/oneOf/20/properties/value/properties/to/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                  if (vErrors === null) {
                                                    vErrors = [err351];
                                                  } else {
                                                    vErrors.push(err351);
                                                  }
                                                  errors++;
                                                }
                                              }
                                            } else {
                                              const err352 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/20/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                              if (vErrors === null) {
                                                vErrors = [err352];
                                              } else {
                                                vErrors.push(err352);
                                              }
                                              errors++;
                                            }
                                          }
                                        } else {
                                          const err353 = { instancePath, schemaPath: "#/oneOf/20/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                          if (vErrors === null) {
                                            vErrors = [err353];
                                          } else {
                                            vErrors.push(err353);
                                          }
                                          errors++;
                                        }
                                        var _valid0 = _errs241 === errors;
                                        if (_valid0 && valid0) {
                                          valid0 = false;
                                          passing0 = [passing0, 20];
                                        } else {
                                          if (_valid0) {
                                            valid0 = true;
                                            passing0 = 20;
                                          }
                                          const _errs254 = errors;
                                          if (data && typeof data == "object" && !Array.isArray(data)) {
                                            if (data.capability === void 0 || !func0.call(data, "capability")) {
                                              const err354 = { instancePath, schemaPath: "#/oneOf/21/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                              if (vErrors === null) {
                                                vErrors = [err354];
                                              } else {
                                                vErrors.push(err354);
                                              }
                                              errors++;
                                            }
                                            if (data.method === void 0 || !func0.call(data, "method")) {
                                              const err355 = { instancePath, schemaPath: "#/oneOf/21/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                              if (vErrors === null) {
                                                vErrors = [err355];
                                              } else {
                                                vErrors.push(err355);
                                              }
                                              errors++;
                                            }
                                            if (data.direction === void 0 || !func0.call(data, "direction")) {
                                              const err356 = { instancePath, schemaPath: "#/oneOf/21/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                              if (vErrors === null) {
                                                vErrors = [err356];
                                              } else {
                                                vErrors.push(err356);
                                              }
                                              errors++;
                                            }
                                            if (data.value === void 0 || !func0.call(data, "value")) {
                                              const err357 = { instancePath, schemaPath: "#/oneOf/21/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                              if (vErrors === null) {
                                                vErrors = [err357];
                                              } else {
                                                vErrors.push(err357);
                                              }
                                              errors++;
                                            }
                                            for (const key39 of Object.keys(data)) {
                                              if (!(key39 === "capability" || key39 === "method" || key39 === "direction" || key39 === "value")) {
                                                const err358 = { instancePath, schemaPath: "#/oneOf/21/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key39 }, message: "must NOT have additional properties" };
                                                if (vErrors === null) {
                                                  vErrors = [err358];
                                                } else {
                                                  vErrors.push(err358);
                                                }
                                                errors++;
                                              }
                                            }
                                            if (data.capability !== void 0 && func0.call(data, "capability")) {
                                              if ("aplg.fs" !== data.capability) {
                                                const err359 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/21/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                                if (vErrors === null) {
                                                  vErrors = [err359];
                                                } else {
                                                  vErrors.push(err359);
                                                }
                                                errors++;
                                              }
                                            }
                                            if (data.method !== void 0 && func0.call(data, "method")) {
                                              if ("copyFile" !== data.method) {
                                                const err360 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/21/properties/method/const", keyword: "const", params: { allowedValue: "copyFile" }, message: "must be equal to constant" };
                                                if (vErrors === null) {
                                                  vErrors = [err360];
                                                } else {
                                                  vErrors.push(err360);
                                                }
                                                errors++;
                                              }
                                            }
                                            if (data.direction !== void 0 && func0.call(data, "direction")) {
                                              if ("result" !== data.direction) {
                                                const err361 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/21/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                                if (vErrors === null) {
                                                  vErrors = [err361];
                                                } else {
                                                  vErrors.push(err361);
                                                }
                                                errors++;
                                              }
                                            }
                                            if (data.value !== void 0 && func0.call(data, "value")) {
                                              if (data.value !== null) {
                                                const err362 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/21/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                                if (vErrors === null) {
                                                  vErrors = [err362];
                                                } else {
                                                  vErrors.push(err362);
                                                }
                                                errors++;
                                              }
                                            }
                                          } else {
                                            const err363 = { instancePath, schemaPath: "#/oneOf/21/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                            if (vErrors === null) {
                                              vErrors = [err363];
                                            } else {
                                              vErrors.push(err363);
                                            }
                                            errors++;
                                          }
                                          var _valid0 = _errs254 === errors;
                                          if (_valid0 && valid0) {
                                            valid0 = false;
                                            passing0 = [passing0, 21];
                                          } else {
                                            if (_valid0) {
                                              valid0 = true;
                                              passing0 = 21;
                                            }
                                            const _errs262 = errors;
                                            if (data && typeof data == "object" && !Array.isArray(data)) {
                                              if (data.capability === void 0 || !func0.call(data, "capability")) {
                                                const err364 = { instancePath, schemaPath: "#/oneOf/22/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                                if (vErrors === null) {
                                                  vErrors = [err364];
                                                } else {
                                                  vErrors.push(err364);
                                                }
                                                errors++;
                                              }
                                              if (data.method === void 0 || !func0.call(data, "method")) {
                                                const err365 = { instancePath, schemaPath: "#/oneOf/22/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                                if (vErrors === null) {
                                                  vErrors = [err365];
                                                } else {
                                                  vErrors.push(err365);
                                                }
                                                errors++;
                                              }
                                              if (data.direction === void 0 || !func0.call(data, "direction")) {
                                                const err366 = { instancePath, schemaPath: "#/oneOf/22/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                                if (vErrors === null) {
                                                  vErrors = [err366];
                                                } else {
                                                  vErrors.push(err366);
                                                }
                                                errors++;
                                              }
                                              if (data.value === void 0 || !func0.call(data, "value")) {
                                                const err367 = { instancePath, schemaPath: "#/oneOf/22/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                                if (vErrors === null) {
                                                  vErrors = [err367];
                                                } else {
                                                  vErrors.push(err367);
                                                }
                                                errors++;
                                              }
                                              for (const key40 of Object.keys(data)) {
                                                if (!(key40 === "capability" || key40 === "method" || key40 === "direction" || key40 === "value")) {
                                                  const err368 = { instancePath, schemaPath: "#/oneOf/22/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key40 }, message: "must NOT have additional properties" };
                                                  if (vErrors === null) {
                                                    vErrors = [err368];
                                                  } else {
                                                    vErrors.push(err368);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data.capability !== void 0 && func0.call(data, "capability")) {
                                                if ("aplg.fs" !== data.capability) {
                                                  const err369 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/22/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                                  if (vErrors === null) {
                                                    vErrors = [err369];
                                                  } else {
                                                    vErrors.push(err369);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data.method !== void 0 && func0.call(data, "method")) {
                                                if ("rm" !== data.method) {
                                                  const err370 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/22/properties/method/const", keyword: "const", params: { allowedValue: "rm" }, message: "must be equal to constant" };
                                                  if (vErrors === null) {
                                                    vErrors = [err370];
                                                  } else {
                                                    vErrors.push(err370);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data.direction !== void 0 && func0.call(data, "direction")) {
                                                if ("request" !== data.direction) {
                                                  const err371 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/22/properties/direction/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
                                                  if (vErrors === null) {
                                                    vErrors = [err371];
                                                  } else {
                                                    vErrors.push(err371);
                                                  }
                                                  errors++;
                                                }
                                              }
                                              if (data.value !== void 0 && func0.call(data, "value")) {
                                                let data124 = data.value;
                                                if (data124 && typeof data124 == "object" && !Array.isArray(data124)) {
                                                  if (data124.path === void 0 || !func0.call(data124, "path")) {
                                                    const err372 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/22/properties/value/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                                                    if (vErrors === null) {
                                                      vErrors = [err372];
                                                    } else {
                                                      vErrors.push(err372);
                                                    }
                                                    errors++;
                                                  }
                                                  if (data124.recursive === void 0 || !func0.call(data124, "recursive")) {
                                                    const err373 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/22/properties/value/required", keyword: "required", params: { missingProperty: "recursive" }, message: "must have required property 'recursive'" };
                                                    if (vErrors === null) {
                                                      vErrors = [err373];
                                                    } else {
                                                      vErrors.push(err373);
                                                    }
                                                    errors++;
                                                  }
                                                  if (data124.force === void 0 || !func0.call(data124, "force")) {
                                                    const err374 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/22/properties/value/required", keyword: "required", params: { missingProperty: "force" }, message: "must have required property 'force'" };
                                                    if (vErrors === null) {
                                                      vErrors = [err374];
                                                    } else {
                                                      vErrors.push(err374);
                                                    }
                                                    errors++;
                                                  }
                                                  for (const key41 of Object.keys(data124)) {
                                                    if (!(key41 === "path" || key41 === "recursive" || key41 === "force")) {
                                                      const err375 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/22/properties/value/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key41 }, message: "must NOT have additional properties" };
                                                      if (vErrors === null) {
                                                        vErrors = [err375];
                                                      } else {
                                                        vErrors.push(err375);
                                                      }
                                                      errors++;
                                                    }
                                                  }
                                                  if (data124.path !== void 0 && func0.call(data124, "path")) {
                                                    let data125 = data124.path;
                                                    if (typeof data125 === "string") {
                                                      if (func55(data125) > 4096) {
                                                        const err376 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/22/properties/value/properties/path/maxLength", keyword: "maxLength", params: { limit: 4096 }, message: "must NOT have more than 4096 characters" };
                                                        if (vErrors === null) {
                                                          vErrors = [err376];
                                                        } else {
                                                          vErrors.push(err376);
                                                        }
                                                        errors++;
                                                      }
                                                      if (func55(data125) < 1) {
                                                        const err377 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/22/properties/value/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                        if (vErrors === null) {
                                                          vErrors = [err377];
                                                        } else {
                                                          vErrors.push(err377);
                                                        }
                                                        errors++;
                                                      }
                                                    } else {
                                                      const err378 = { instancePath: instancePath + "/value/path", schemaPath: "#/oneOf/22/properties/value/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                      if (vErrors === null) {
                                                        vErrors = [err378];
                                                      } else {
                                                        vErrors.push(err378);
                                                      }
                                                      errors++;
                                                    }
                                                  }
                                                  if (data124.recursive !== void 0 && func0.call(data124, "recursive")) {
                                                    if (typeof data124.recursive !== "boolean") {
                                                      const err379 = { instancePath: instancePath + "/value/recursive", schemaPath: "#/oneOf/22/properties/value/properties/recursive/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                                      if (vErrors === null) {
                                                        vErrors = [err379];
                                                      } else {
                                                        vErrors.push(err379);
                                                      }
                                                      errors++;
                                                    }
                                                  }
                                                  if (data124.force !== void 0 && func0.call(data124, "force")) {
                                                    if (typeof data124.force !== "boolean") {
                                                      const err380 = { instancePath: instancePath + "/value/force", schemaPath: "#/oneOf/22/properties/value/properties/force/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                                      if (vErrors === null) {
                                                        vErrors = [err380];
                                                      } else {
                                                        vErrors.push(err380);
                                                      }
                                                      errors++;
                                                    }
                                                  }
                                                } else {
                                                  const err381 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/22/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                                  if (vErrors === null) {
                                                    vErrors = [err381];
                                                  } else {
                                                    vErrors.push(err381);
                                                  }
                                                  errors++;
                                                }
                                              }
                                            } else {
                                              const err382 = { instancePath, schemaPath: "#/oneOf/22/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                              if (vErrors === null) {
                                                vErrors = [err382];
                                              } else {
                                                vErrors.push(err382);
                                              }
                                              errors++;
                                            }
                                            var _valid0 = _errs262 === errors;
                                            if (_valid0 && valid0) {
                                              valid0 = false;
                                              passing0 = [passing0, 22];
                                            } else {
                                              if (_valid0) {
                                                valid0 = true;
                                                passing0 = 22;
                                              }
                                              const _errs277 = errors;
                                              if (data && typeof data == "object" && !Array.isArray(data)) {
                                                if (data.capability === void 0 || !func0.call(data, "capability")) {
                                                  const err383 = { instancePath, schemaPath: "#/oneOf/23/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
                                                  if (vErrors === null) {
                                                    vErrors = [err383];
                                                  } else {
                                                    vErrors.push(err383);
                                                  }
                                                  errors++;
                                                }
                                                if (data.method === void 0 || !func0.call(data, "method")) {
                                                  const err384 = { instancePath, schemaPath: "#/oneOf/23/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
                                                  if (vErrors === null) {
                                                    vErrors = [err384];
                                                  } else {
                                                    vErrors.push(err384);
                                                  }
                                                  errors++;
                                                }
                                                if (data.direction === void 0 || !func0.call(data, "direction")) {
                                                  const err385 = { instancePath, schemaPath: "#/oneOf/23/required", keyword: "required", params: { missingProperty: "direction" }, message: "must have required property 'direction'" };
                                                  if (vErrors === null) {
                                                    vErrors = [err385];
                                                  } else {
                                                    vErrors.push(err385);
                                                  }
                                                  errors++;
                                                }
                                                if (data.value === void 0 || !func0.call(data, "value")) {
                                                  const err386 = { instancePath, schemaPath: "#/oneOf/23/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                                                  if (vErrors === null) {
                                                    vErrors = [err386];
                                                  } else {
                                                    vErrors.push(err386);
                                                  }
                                                  errors++;
                                                }
                                                for (const key42 of Object.keys(data)) {
                                                  if (!(key42 === "capability" || key42 === "method" || key42 === "direction" || key42 === "value")) {
                                                    const err387 = { instancePath, schemaPath: "#/oneOf/23/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key42 }, message: "must NOT have additional properties" };
                                                    if (vErrors === null) {
                                                      vErrors = [err387];
                                                    } else {
                                                      vErrors.push(err387);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                                if (data.capability !== void 0 && func0.call(data, "capability")) {
                                                  if ("aplg.fs" !== data.capability) {
                                                    const err388 = { instancePath: instancePath + "/capability", schemaPath: "#/oneOf/23/properties/capability/const", keyword: "const", params: { allowedValue: "aplg.fs" }, message: "must be equal to constant" };
                                                    if (vErrors === null) {
                                                      vErrors = [err388];
                                                    } else {
                                                      vErrors.push(err388);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                                if (data.method !== void 0 && func0.call(data, "method")) {
                                                  if ("rm" !== data.method) {
                                                    const err389 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/23/properties/method/const", keyword: "const", params: { allowedValue: "rm" }, message: "must be equal to constant" };
                                                    if (vErrors === null) {
                                                      vErrors = [err389];
                                                    } else {
                                                      vErrors.push(err389);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                                if (data.direction !== void 0 && func0.call(data, "direction")) {
                                                  if ("result" !== data.direction) {
                                                    const err390 = { instancePath: instancePath + "/direction", schemaPath: "#/oneOf/23/properties/direction/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
                                                    if (vErrors === null) {
                                                      vErrors = [err390];
                                                    } else {
                                                      vErrors.push(err390);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                                if (data.value !== void 0 && func0.call(data, "value")) {
                                                  if (data.value !== null) {
                                                    const err391 = { instancePath: instancePath + "/value", schemaPath: "#/oneOf/23/properties/value/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                                    if (vErrors === null) {
                                                      vErrors = [err391];
                                                    } else {
                                                      vErrors.push(err391);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                              } else {
                                                const err392 = { instancePath, schemaPath: "#/oneOf/23/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                                if (vErrors === null) {
                                                  vErrors = [err392];
                                                } else {
                                                  vErrors.push(err392);
                                                }
                                                errors++;
                                              }
                                              var _valid0 = _errs277 === errors;
                                              if (_valid0 && valid0) {
                                                valid0 = false;
                                                passing0 = [passing0, 23];
                                              } else {
                                                if (_valid0) {
                                                  valid0 = true;
                                                  passing0 = 23;
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err393 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err393];
    } else {
      vErrors.push(err393);
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
var validateHostEventSchema = validate15;
var schema14 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/host-event.schema.json", "title": "HostEvent", "oneOf": [{ "type": "object", "additionalProperties": false, "required": ["kind", "sessionId", "subscriptionId", "seq", "payload"], "properties": { "kind": { "const": "capability.event" }, "sessionId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "subscriptionId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "seq": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "payload": { "$ref": "#/definitions/jsonValue" } } }, { "type": "object", "additionalProperties": false, "required": ["kind", "sessionId", "reason"], "properties": { "kind": { "const": "session.closed" }, "sessionId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "reason": { "type": "string", "maxLength": 8192 } } }, { "type": "object", "additionalProperties": false, "required": ["kind", "state"], "properties": { "kind": { "const": "transport.state" }, "state": { "enum": ["connected", "disconnected"] } } }], "definitions": { "jsonValue": { "anyOf": [{ "type": "null" }, { "type": "boolean" }, { "type": "number" }, { "type": "string" }, { "type": "array", "items": { "$ref": "#/definitions/jsonValue" } }, { "type": "object", "additionalProperties": { "$ref": "#/definitions/jsonValue" } }] } } };
var wrapper2 = { validate: validate16 };
function validate16(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
              if (!wrapper2.validate(data[i0], { instancePath: instancePath + "/" + i0, parentData: data, parentDataProperty: i0, rootData })) {
                vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
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
                if (!wrapper2.validate(data[key0], { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data, parentDataProperty: key0, rootData })) {
                  vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
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
  validate16.errors = vErrors;
  return errors === 0;
}
function validate15(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0 || !func0.call(data, "kind")) {
      const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.sessionId === void 0 || !func0.call(data, "sessionId")) {
      const err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.subscriptionId === void 0 || !func0.call(data, "subscriptionId")) {
      const err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "subscriptionId" }, message: "must have required property 'subscriptionId'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.seq === void 0 || !func0.call(data, "seq")) {
      const err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "seq" }, message: "must have required property 'seq'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.payload === void 0 || !func0.call(data, "payload")) {
      const err4 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "payload" }, message: "must have required property 'payload'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "kind" || key0 === "sessionId" || key0 === "subscriptionId" || key0 === "seq" || key0 === "payload")) {
        const err5 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.kind !== void 0 && func0.call(data, "kind")) {
      if ("capability.event" !== data.kind) {
        const err6 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/0/properties/kind/const", keyword: "const", params: { allowedValue: "capability.event" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.sessionId !== void 0 && func0.call(data, "sessionId")) {
      let data1 = data.sessionId;
      if (typeof data1 === "string") {
        if (func55(data1) > 128) {
          const err7 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/0/properties/sessionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (func55(data1) < 1) {
          const err8 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/0/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        if (!pattern0.test(data1)) {
          const err9 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/0/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/0/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.subscriptionId !== void 0 && func0.call(data, "subscriptionId")) {
      let data2 = data.subscriptionId;
      if (typeof data2 === "string") {
        if (func55(data2) > 128) {
          const err11 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/0/properties/subscriptionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
        if (func55(data2) < 1) {
          const err12 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/0/properties/subscriptionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (!pattern0.test(data2)) {
          const err13 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/0/properties/subscriptionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/0/properties/subscriptionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.seq !== void 0 && func0.call(data, "seq")) {
      let data3 = data.seq;
      if (!(typeof data3 == "number" && (!(data3 % 1) && !isNaN(data3)) && isFinite(data3))) {
        const err15 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/0/properties/seq/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (typeof data3 == "number" && isFinite(data3)) {
        if (data3 > 9007199254740991 || isNaN(data3)) {
          const err16 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/0/properties/seq/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (data3 < 1 || isNaN(data3)) {
          const err17 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/0/properties/seq/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      }
    }
    if (data.payload !== void 0 && func0.call(data, "payload")) {
      if (!validate16(data.payload, { instancePath: instancePath + "/payload", parentData: data, parentDataProperty: "payload", rootData })) {
        vErrors = vErrors === null ? validate16.errors : vErrors.concat(validate16.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0 || !func0.call(data, "kind")) {
      const err19 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.sessionId === void 0 || !func0.call(data, "sessionId")) {
      const err20 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    if (data.reason === void 0 || !func0.call(data, "reason")) {
      const err21 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
      if (vErrors === null) {
        vErrors = [err21];
      } else {
        vErrors.push(err21);
      }
      errors++;
    }
    for (const key1 of Object.keys(data)) {
      if (!(key1 === "kind" || key1 === "sessionId" || key1 === "reason")) {
        const err22 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.kind !== void 0 && func0.call(data, "kind")) {
      if ("session.closed" !== data.kind) {
        const err23 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/1/properties/kind/const", keyword: "const", params: { allowedValue: "session.closed" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.sessionId !== void 0 && func0.call(data, "sessionId")) {
      let data6 = data.sessionId;
      if (typeof data6 === "string") {
        if (func55(data6) > 128) {
          const err24 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/1/properties/sessionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        if (func55(data6) < 1) {
          const err25 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/1/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err25];
          } else {
            vErrors.push(err25);
          }
          errors++;
        }
        if (!pattern0.test(data6)) {
          const err26 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/1/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = { instancePath: instancePath + "/sessionId", schemaPath: "#/oneOf/1/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.reason !== void 0 && func0.call(data, "reason")) {
      let data7 = data.reason;
      if (typeof data7 === "string") {
        if (func55(data7) > 8192) {
          const err28 = { instancePath: instancePath + "/reason", schemaPath: "#/oneOf/1/properties/reason/maxLength", keyword: "maxLength", params: { limit: 8192 }, message: "must NOT have more than 8192 characters" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/reason", schemaPath: "#/oneOf/1/properties/reason/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
  } else {
    const err30 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err30];
    } else {
      vErrors.push(err30);
    }
    errors++;
  }
  var _valid0 = _errs12 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs20 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.kind === void 0 || !func0.call(data, "kind")) {
        const err31 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
      if (data.state === void 0 || !func0.call(data, "state")) {
        const err32 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
        if (vErrors === null) {
          vErrors = [err32];
        } else {
          vErrors.push(err32);
        }
        errors++;
      }
      for (const key2 of Object.keys(data)) {
        if (!(key2 === "kind" || key2 === "state")) {
          const err33 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
      }
      if (data.kind !== void 0 && func0.call(data, "kind")) {
        if ("transport.state" !== data.kind) {
          const err34 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/2/properties/kind/const", keyword: "const", params: { allowedValue: "transport.state" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      }
      if (data.state !== void 0 && func0.call(data, "state")) {
        let data9 = data.state;
        if (!(data9 === "connected" || data9 === "disconnected")) {
          const err35 = { instancePath: instancePath + "/state", schemaPath: "#/oneOf/2/properties/state/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[2].properties.state.enum }, message: "must be equal to one of the allowed values" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      }
    } else {
      const err36 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err36];
      } else {
        vErrors.push(err36);
      }
      errors++;
    }
    var _valid0 = _errs20 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
    }
  }
  if (!valid0) {
    const err37 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err37];
    } else {
      vErrors.push(err37);
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
  validate15.errors = vErrors;
  return errors === 0;
}
var validateManifestSchema = validate18;
var schema16 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/manifest.schema.json", "title": "Manifest", "type": "object", "additionalProperties": false, "required": ["manifestVersion", "id", "name", "version", "description", "license", "engines", "entry", "activation", "requires", "optional", "permissions", "contributes"], "properties": { "manifestVersion": { "const": 1 }, "id": { "type": "string", "minLength": 3, "maxLength": 160, "pattern": "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" }, "name": { "type": "string", "minLength": 1, "maxLength": 160 }, "version": { "type": "string", "minLength": 1, "maxLength": 128 }, "description": { "type": "string", "maxLength": 8192 }, "license": { "type": "string", "minLength": 1, "maxLength": 256 }, "engines": { "type": "object", "additionalProperties": false, "required": ["aplg"], "properties": { "aplg": { "$ref": "#/definitions/range" } } }, "entry": { "type": "string", "minLength": 1, "maxLength": 1024 }, "activation": { "const": "view" }, "requires": { "$ref": "#/definitions/capabilityRanges" }, "optional": { "$ref": "#/definitions/capabilityRanges" }, "permissions": { "type": "object", "additionalProperties": false, "required": ["filesystem", "network", "native"], "properties": { "filesystem": { "type": "array", "maxItems": 2, "items": { "type": "object", "additionalProperties": false, "required": ["root", "access"], "properties": { "root": { "enum": ["plugin-data", "user-selected"] }, "access": { "type": "array", "minItems": 1, "maxItems": 2, "uniqueItems": true, "items": { "enum": ["read", "write"] } } } } }, "network": { "type": "array", "maxItems": 64, "items": { "type": "object", "additionalProperties": false, "required": ["origins", "methods"], "properties": { "origins": { "type": "array", "minItems": 1, "maxItems": 64, "uniqueItems": true, "items": { "type": "string", "minLength": 1, "maxLength": 2048 } }, "methods": { "type": "array", "minItems": 1, "maxItems": 9, "uniqueItems": true, "items": { "enum": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"] } } } } }, "native": { "type": "boolean" } } }, "contributes": { "type": "object", "additionalProperties": false, "required": ["views"], "properties": { "views": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object", "additionalProperties": false, "required": ["id", "title"], "properties": { "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" }, "title": { "type": "string", "minLength": 1, "maxLength": 160 } } } } } }, "extensions": { "type": "object", "maxProperties": 64, "propertyNames": { "$ref": "#/definitions/capabilityName" }, "additionalProperties": { "$ref": "#/definitions/jsonValue" } } }, "definitions": { "range": { "type": "string", "minLength": 1, "maxLength": 128 }, "capabilityName": { "type": "string", "minLength": 3, "maxLength": 128, "pattern": "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, "capabilityRanges": { "type": "object", "maxProperties": 128, "propertyNames": { "$ref": "#/definitions/capabilityName" }, "additionalProperties": { "$ref": "#/definitions/range" } }, "jsonValue": { "anyOf": [{ "type": "null" }, { "type": "boolean" }, { "type": "number" }, { "type": "string" }, { "type": "array", "items": { "$ref": "#/definitions/jsonValue" } }, { "type": "object", "additionalProperties": { "$ref": "#/definitions/jsonValue" } }] } } };
var func32 = require_equal().default;
var pattern9 = new RegExp("^[a-z0-9]+(?:[.-][a-z0-9]+)+$", "u");
var pattern11 = new RegExp("^[a-z0-9][a-z0-9-]{0,63}$", "u");
var pattern10 = new RegExp("^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$", "u");
function validate19(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
        if (func55(key0) > 128) {
          const err1 = { instancePath, schemaPath: "#/definitions/capabilityName/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters", propertyName: key0 };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (func55(key0) < 3) {
          const err2 = { instancePath, schemaPath: "#/definitions/capabilityName/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters", propertyName: key0 };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (!pattern10.test(key0)) {
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
        if (func55(data0) > 128) {
          const err6 = { instancePath: instancePath + "/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/range/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (func55(data0) < 1) {
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
  validate19.errors = vErrors;
  return errors === 0;
}
var wrapper4 = { validate: validate22 };
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
              if (!wrapper4.validate(data[i0], { instancePath: instancePath + "/" + i0, parentData: data, parentDataProperty: i0, rootData })) {
                vErrors = vErrors === null ? wrapper4.validate.errors : vErrors.concat(wrapper4.validate.errors);
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
                if (!wrapper4.validate(data[key0], { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data, parentDataProperty: key0, rootData })) {
                  vErrors = vErrors === null ? wrapper4.validate.errors : vErrors.concat(wrapper4.validate.errors);
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
  validate22.errors = vErrors;
  return errors === 0;
}
function validate18(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
      if (!func0.call(schema16.properties, key0)) {
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
        if (func55(data1) > 160) {
          const err15 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (func55(data1) < 3) {
          const err16 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (!pattern9.test(data1)) {
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
        if (func55(data2) > 160) {
          const err19 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        if (func55(data2) < 1) {
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
        if (func55(data3) > 128) {
          const err22 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
        if (func55(data3) < 1) {
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
        if (func55(data4) > 8192) {
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
        if (func55(data5) > 256) {
          const err27 = { instancePath: instancePath + "/license", schemaPath: "#/properties/license/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
          if (vErrors === null) {
            vErrors = [err27];
          } else {
            vErrors.push(err27);
          }
          errors++;
        }
        if (func55(data5) < 1) {
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
            if (func55(data7) > 128) {
              const err32 = { instancePath: instancePath + "/engines/aplg", schemaPath: "#/definitions/range/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err32];
              } else {
                vErrors.push(err32);
              }
              errors++;
            }
            if (func55(data7) < 1) {
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
        if (func55(data8) > 1024) {
          const err36 = { instancePath: instancePath + "/entry", schemaPath: "#/properties/entry/maxLength", keyword: "maxLength", params: { limit: 1024 }, message: "must NOT have more than 1024 characters" };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
        if (func55(data8) < 1) {
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
      if (!validate19(data.requires, { instancePath: instancePath + "/requires", parentData: data, parentDataProperty: "requires", rootData })) {
        vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors);
        errors = vErrors.length;
      }
    }
    if (data.optional !== void 0 && func0.call(data, "optional")) {
      if (!validate19(data.optional, { instancePath: instancePath + "/optional", parentData: data, parentDataProperty: "optional", rootData })) {
        vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors);
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
                    const err48 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/root", schemaPath: "#/properties/permissions/properties/filesystem/items/properties/root/enum", keyword: "enum", params: { allowedValues: schema16.properties.permissions.properties.filesystem.items.properties.root.enum }, message: "must be equal to one of the allowed values" };
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
                        const err51 = { instancePath: instancePath + "/permissions/filesystem/" + i0 + "/access/" + i1, schemaPath: "#/properties/permissions/properties/filesystem/items/properties/access/items/enum", keyword: "enum", params: { allowedValues: schema16.properties.permissions.properties.filesystem.items.properties.access.items.enum }, message: "must be equal to one of the allowed values" };
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
                        if (func55(data21) > 2048) {
                          const err62 = { instancePath: instancePath + "/permissions/network/" + i3 + "/origins/" + i4, schemaPath: "#/properties/permissions/properties/network/items/properties/origins/items/maxLength", keyword: "maxLength", params: { limit: 2048 }, message: "must NOT have more than 2048 characters" };
                          if (vErrors === null) {
                            vErrors = [err62];
                          } else {
                            vErrors.push(err62);
                          }
                          errors++;
                        }
                        if (func55(data21) < 1) {
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
                        const err69 = { instancePath: instancePath + "/permissions/network/" + i3 + "/methods/" + i6, schemaPath: "#/properties/permissions/properties/network/items/properties/methods/items/enum", keyword: "enum", params: { allowedValues: schema16.properties.permissions.properties.network.items.properties.methods.items.enum }, message: "must be equal to one of the allowed values" };
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
                    if (!pattern11.test(data28)) {
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
                    if (func55(data29) > 160) {
                      const err85 = { instancePath: instancePath + "/contributes/views/" + i8 + "/title", schemaPath: "#/properties/contributes/properties/views/items/properties/title/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
                      if (vErrors === null) {
                        vErrors = [err85];
                      } else {
                        vErrors.push(err85);
                      }
                      errors++;
                    }
                    if (func55(data29) < 1) {
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
            if (func55(key7) > 128) {
              const err92 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters", propertyName: key7 };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
            if (func55(key7) < 3) {
              const err93 = { instancePath: instancePath + "/extensions", schemaPath: "#/definitions/capabilityName/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters", propertyName: key7 };
              if (vErrors === null) {
                vErrors = [err93];
              } else {
                vErrors.push(err93);
              }
              errors++;
            }
            if (!pattern10.test(key7)) {
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
          if (!validate22(data30[key8], { instancePath: instancePath + "/extensions/" + key8.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data30, parentDataProperty: key8, rootData })) {
            vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
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
  validate18.errors = vErrors;
  return errors === 0;
}
var validateSessionDescriptorSchema = validate24;
var pattern15 = new RegExp("^[a-f0-9]{64}$", "u");
var pattern17 = new RegExp("^[a-zA-Z][a-zA-Z0-9_.-]*$", "u");
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.sessionId === void 0 || !func0.call(data, "sessionId")) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.manifest === void 0 || !func0.call(data, "manifest")) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "manifest" }, message: "must have required property 'manifest'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.assetUrl === void 0 || !func0.call(data, "assetUrl")) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assetUrl" }, message: "must have required property 'assetUrl'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.info === void 0 || !func0.call(data, "info")) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "info" }, message: "must have required property 'info'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "sessionId" || key0 === "manifest" || key0 === "assetUrl" || key0 === "info")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.sessionId !== void 0 && func0.call(data, "sessionId")) {
      let data0 = data.sessionId;
      if (typeof data0 === "string") {
        if (func55(data0) > 128) {
          const err5 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (func55(data0) < 1) {
          const err6 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (!pattern0.test(data0)) {
          const err7 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.manifest !== void 0 && func0.call(data, "manifest")) {
      if (!validate18(data.manifest, { instancePath: instancePath + "/manifest", parentData: data, parentDataProperty: "manifest", rootData })) {
        vErrors = vErrors === null ? validate18.errors : vErrors.concat(validate18.errors);
        errors = vErrors.length;
      }
    }
    if (data.assetUrl !== void 0 && func0.call(data, "assetUrl")) {
      let data2 = data.assetUrl;
      if (typeof data2 === "string") {
        if (func55(data2) > 8192) {
          const err9 = { instancePath: instancePath + "/assetUrl", schemaPath: "#/properties/assetUrl/maxLength", keyword: "maxLength", params: { limit: 8192 }, message: "must NOT have more than 8192 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (func55(data2) < 1) {
          const err10 = { instancePath: instancePath + "/assetUrl", schemaPath: "#/properties/assetUrl/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/assetUrl", schemaPath: "#/properties/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.info !== void 0 && func0.call(data, "info")) {
      let data3 = data.info;
      if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
        if (data3.protocol === void 0 || !func0.call(data3, "protocol")) {
          const err12 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (data3.apiVersion === void 0 || !func0.call(data3, "apiVersion")) {
          const err13 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/required", keyword: "required", params: { missingProperty: "apiVersion" }, message: "must have required property 'apiVersion'" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data3.plugin === void 0 || !func0.call(data3, "plugin")) {
          const err14 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/required", keyword: "required", params: { missingProperty: "plugin" }, message: "must have required property 'plugin'" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data3.capabilities === void 0 || !func0.call(data3, "capabilities")) {
          const err15 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (data3.limits === void 0 || !func0.call(data3, "limits")) {
          const err16 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/required", keyword: "required", params: { missingProperty: "limits" }, message: "must have required property 'limits'" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        for (const key1 of Object.keys(data3)) {
          if (!(key1 === "protocol" || key1 === "apiVersion" || key1 === "plugin" || key1 === "capabilities" || key1 === "limits")) {
            const err17 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
        if (data3.protocol !== void 0 && func0.call(data3, "protocol")) {
          if ("aplg/1" !== data3.protocol) {
            const err18 = { instancePath: instancePath + "/info/protocol", schemaPath: "#/properties/info/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
        }
        if (data3.apiVersion !== void 0 && func0.call(data3, "apiVersion")) {
          let data5 = data3.apiVersion;
          if (typeof data5 === "string") {
            if (func55(data5) > 128) {
              const err19 = { instancePath: instancePath + "/info/apiVersion", schemaPath: "#/properties/info/properties/apiVersion/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
            if (func55(data5) < 1) {
              const err20 = { instancePath: instancePath + "/info/apiVersion", schemaPath: "#/properties/info/properties/apiVersion/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
          } else {
            const err21 = { instancePath: instancePath + "/info/apiVersion", schemaPath: "#/properties/info/properties/apiVersion/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          }
        }
        if (data3.plugin !== void 0 && func0.call(data3, "plugin")) {
          let data6 = data3.plugin;
          if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
            if (data6.id === void 0 || !func0.call(data6, "id")) {
              const err22 = { instancePath: instancePath + "/info/plugin", schemaPath: "#/properties/info/properties/plugin/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            if (data6.version === void 0 || !func0.call(data6, "version")) {
              const err23 = { instancePath: instancePath + "/info/plugin", schemaPath: "#/properties/info/properties/plugin/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            if (data6.packageSha256 === void 0 || !func0.call(data6, "packageSha256")) {
              const err24 = { instancePath: instancePath + "/info/plugin", schemaPath: "#/properties/info/properties/plugin/required", keyword: "required", params: { missingProperty: "packageSha256" }, message: "must have required property 'packageSha256'" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
            for (const key2 of Object.keys(data6)) {
              if (!(key2 === "id" || key2 === "version" || key2 === "packageSha256")) {
                const err25 = { instancePath: instancePath + "/info/plugin", schemaPath: "#/properties/info/properties/plugin/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
            if (data6.id !== void 0 && func0.call(data6, "id")) {
              let data7 = data6.id;
              if (typeof data7 === "string") {
                if (func55(data7) > 160) {
                  const err26 = { instancePath: instancePath + "/info/plugin/id", schemaPath: "#/properties/info/properties/plugin/properties/id/maxLength", keyword: "maxLength", params: { limit: 160 }, message: "must NOT have more than 160 characters" };
                  if (vErrors === null) {
                    vErrors = [err26];
                  } else {
                    vErrors.push(err26);
                  }
                  errors++;
                }
                if (func55(data7) < 3) {
                  const err27 = { instancePath: instancePath + "/info/plugin/id", schemaPath: "#/properties/info/properties/plugin/properties/id/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters" };
                  if (vErrors === null) {
                    vErrors = [err27];
                  } else {
                    vErrors.push(err27);
                  }
                  errors++;
                }
                if (!pattern9.test(data7)) {
                  const err28 = { instancePath: instancePath + "/info/plugin/id", schemaPath: "#/properties/info/properties/plugin/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" }, message: 'must match pattern "^[a-z0-9]+(?:[.-][a-z0-9]+)+$"' };
                  if (vErrors === null) {
                    vErrors = [err28];
                  } else {
                    vErrors.push(err28);
                  }
                  errors++;
                }
              } else {
                const err29 = { instancePath: instancePath + "/info/plugin/id", schemaPath: "#/properties/info/properties/plugin/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err29];
                } else {
                  vErrors.push(err29);
                }
                errors++;
              }
            }
            if (data6.version !== void 0 && func0.call(data6, "version")) {
              let data8 = data6.version;
              if (typeof data8 === "string") {
                if (func55(data8) > 128) {
                  const err30 = { instancePath: instancePath + "/info/plugin/version", schemaPath: "#/properties/info/properties/plugin/properties/version/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                  if (vErrors === null) {
                    vErrors = [err30];
                  } else {
                    vErrors.push(err30);
                  }
                  errors++;
                }
                if (func55(data8) < 1) {
                  const err31 = { instancePath: instancePath + "/info/plugin/version", schemaPath: "#/properties/info/properties/plugin/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err31];
                  } else {
                    vErrors.push(err31);
                  }
                  errors++;
                }
              } else {
                const err32 = { instancePath: instancePath + "/info/plugin/version", schemaPath: "#/properties/info/properties/plugin/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err32];
                } else {
                  vErrors.push(err32);
                }
                errors++;
              }
            }
            if (data6.packageSha256 !== void 0 && func0.call(data6, "packageSha256")) {
              let data9 = data6.packageSha256;
              if (typeof data9 === "string") {
                if (!pattern15.test(data9)) {
                  const err33 = { instancePath: instancePath + "/info/plugin/packageSha256", schemaPath: "#/properties/info/properties/plugin/properties/packageSha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
                  if (vErrors === null) {
                    vErrors = [err33];
                  } else {
                    vErrors.push(err33);
                  }
                  errors++;
                }
              } else {
                const err34 = { instancePath: instancePath + "/info/plugin/packageSha256", schemaPath: "#/properties/info/properties/plugin/properties/packageSha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err34];
                } else {
                  vErrors.push(err34);
                }
                errors++;
              }
            }
          } else {
            const err35 = { instancePath: instancePath + "/info/plugin", schemaPath: "#/properties/info/properties/plugin/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err35];
            } else {
              vErrors.push(err35);
            }
            errors++;
          }
        }
        if (data3.capabilities !== void 0 && func0.call(data3, "capabilities")) {
          let data10 = data3.capabilities;
          if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
            if (Object.keys(data10).length > 128) {
              const err36 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/maxProperties", keyword: "maxProperties", params: { limit: 128 }, message: "must NOT have more than 128 properties" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            for (const key3 of Object.keys(data10)) {
              const _errs24 = errors;
              if (typeof key3 === "string") {
                if (func55(key3) > 128) {
                  const err37 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/propertyNames/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters", propertyName: key3 };
                  if (vErrors === null) {
                    vErrors = [err37];
                  } else {
                    vErrors.push(err37);
                  }
                  errors++;
                }
                if (func55(key3) < 3) {
                  const err38 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/propertyNames/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters", propertyName: key3 };
                  if (vErrors === null) {
                    vErrors = [err38];
                  } else {
                    vErrors.push(err38);
                  }
                  errors++;
                }
                if (!pattern10.test(key3)) {
                  const err39 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$"', propertyName: key3 };
                  if (vErrors === null) {
                    vErrors = [err39];
                  } else {
                    vErrors.push(err39);
                  }
                  errors++;
                }
              } else {
                const err40 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/propertyNames/type", keyword: "type", params: { type: "string" }, message: "must be string", propertyName: key3 };
                if (vErrors === null) {
                  vErrors = [err40];
                } else {
                  vErrors.push(err40);
                }
                errors++;
              }
              var valid3 = _errs24 === errors;
              if (!valid3) {
                const err41 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/propertyNames", keyword: "propertyNames", params: { propertyName: key3 }, message: "property name must be valid" };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
            for (const key4 of Object.keys(data10)) {
              let data11 = data10[key4];
              if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
                if (data11.version === void 0 || !func0.call(data11, "version")) {
                  const err42 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/info/properties/capabilities/additionalProperties/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                  if (vErrors === null) {
                    vErrors = [err42];
                  } else {
                    vErrors.push(err42);
                  }
                  errors++;
                }
                if (data11.methods === void 0 || !func0.call(data11, "methods")) {
                  const err43 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/info/properties/capabilities/additionalProperties/required", keyword: "required", params: { missingProperty: "methods" }, message: "must have required property 'methods'" };
                  if (vErrors === null) {
                    vErrors = [err43];
                  } else {
                    vErrors.push(err43);
                  }
                  errors++;
                }
                for (const key5 of Object.keys(data11)) {
                  if (!(key5 === "version" || key5 === "methods")) {
                    const err44 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/info/properties/capabilities/additionalProperties/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err44];
                    } else {
                      vErrors.push(err44);
                    }
                    errors++;
                  }
                }
                if (data11.version !== void 0 && func0.call(data11, "version")) {
                  let data12 = data11.version;
                  if (typeof data12 === "string") {
                    if (func55(data12) > 128) {
                      const err45 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/version", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/version/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                      if (vErrors === null) {
                        vErrors = [err45];
                      } else {
                        vErrors.push(err45);
                      }
                      errors++;
                    }
                    if (func55(data12) < 1) {
                      const err46 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/version", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err46];
                      } else {
                        vErrors.push(err46);
                      }
                      errors++;
                    }
                  } else {
                    const err47 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/version", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err47];
                    } else {
                      vErrors.push(err47);
                    }
                    errors++;
                  }
                }
                if (data11.methods !== void 0 && func0.call(data11, "methods")) {
                  let data13 = data11.methods;
                  if (Array.isArray(data13)) {
                    if (data13.length > 128) {
                      const err48 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/maxItems", keyword: "maxItems", params: { limit: 128 }, message: "must NOT have more than 128 items" };
                      if (vErrors === null) {
                        vErrors = [err48];
                      } else {
                        vErrors.push(err48);
                      }
                      errors++;
                    }
                    if (data13.length < 1) {
                      const err49 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                      if (vErrors === null) {
                        vErrors = [err49];
                      } else {
                        vErrors.push(err49);
                      }
                      errors++;
                    }
                    const len0 = data13.length;
                    for (let i0 = 0; i0 < len0; i0++) {
                      let data14 = data13[i0];
                      if (typeof data14 === "string") {
                        if (func55(data14) > 128) {
                          const err50 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods/" + i0, schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/items/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                          if (vErrors === null) {
                            vErrors = [err50];
                          } else {
                            vErrors.push(err50);
                          }
                          errors++;
                        }
                        if (func55(data14) < 1) {
                          const err51 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods/" + i0, schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          if (vErrors === null) {
                            vErrors = [err51];
                          } else {
                            vErrors.push(err51);
                          }
                          errors++;
                        }
                        if (!pattern17.test(data14)) {
                          const err52 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods/" + i0, schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/items/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z][a-zA-Z0-9_.-]*$" }, message: 'must match pattern "^[a-zA-Z][a-zA-Z0-9_.-]*$"' };
                          if (vErrors === null) {
                            vErrors = [err52];
                          } else {
                            vErrors.push(err52);
                          }
                          errors++;
                        }
                      } else {
                        const err53 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods/" + i0, schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err53];
                        } else {
                          vErrors.push(err53);
                        }
                        errors++;
                      }
                    }
                    let i1 = data13.length;
                    let j0;
                    if (i1 > 1) {
                      const indices0 = {};
                      for (; i1--; ) {
                        let item0 = data13[i1];
                        if (typeof item0 !== "string") {
                          continue;
                        }
                        if (typeof indices0[item0] == "number") {
                          j0 = indices0[item0];
                          const err54 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                          if (vErrors === null) {
                            vErrors = [err54];
                          } else {
                            vErrors.push(err54);
                          }
                          errors++;
                          break;
                        }
                        indices0[item0] = i1;
                      }
                    }
                  } else {
                    const err55 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1") + "/methods", schemaPath: "#/properties/info/properties/capabilities/additionalProperties/properties/methods/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    if (vErrors === null) {
                      vErrors = [err55];
                    } else {
                      vErrors.push(err55);
                    }
                    errors++;
                  }
                }
              } else {
                const err56 = { instancePath: instancePath + "/info/capabilities/" + key4.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/info/properties/capabilities/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err56];
                } else {
                  vErrors.push(err56);
                }
                errors++;
              }
            }
          } else {
            const err57 = { instancePath: instancePath + "/info/capabilities", schemaPath: "#/properties/info/properties/capabilities/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err57];
            } else {
              vErrors.push(err57);
            }
            errors++;
          }
        }
        if (data3.limits !== void 0 && func0.call(data3, "limits")) {
          let data15 = data3.limits;
          if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
            if (data15.controlBytes === void 0 || !func0.call(data15, "controlBytes")) {
              const err58 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/required", keyword: "required", params: { missingProperty: "controlBytes" }, message: "must have required property 'controlBytes'" };
              if (vErrors === null) {
                vErrors = [err58];
              } else {
                vErrors.push(err58);
              }
              errors++;
            }
            if (data15.fileChunkBytes === void 0 || !func0.call(data15, "fileChunkBytes")) {
              const err59 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/required", keyword: "required", params: { missingProperty: "fileChunkBytes" }, message: "must have required property 'fileChunkBytes'" };
              if (vErrors === null) {
                vErrors = [err59];
              } else {
                vErrors.push(err59);
              }
              errors++;
            }
            if (data15.fileBytes === void 0 || !func0.call(data15, "fileBytes")) {
              const err60 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/required", keyword: "required", params: { missingProperty: "fileBytes" }, message: "must have required property 'fileBytes'" };
              if (vErrors === null) {
                vErrors = [err60];
              } else {
                vErrors.push(err60);
              }
              errors++;
            }
            if (data15.fileTransfers === void 0 || !func0.call(data15, "fileTransfers")) {
              const err61 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/required", keyword: "required", params: { missingProperty: "fileTransfers" }, message: "must have required property 'fileTransfers'" };
              if (vErrors === null) {
                vErrors = [err61];
              } else {
                vErrors.push(err61);
              }
              errors++;
            }
            for (const key6 of Object.keys(data15)) {
              if (!(key6 === "controlBytes" || key6 === "fileChunkBytes" || key6 === "fileBytes" || key6 === "fileTransfers")) {
                const err62 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err62];
                } else {
                  vErrors.push(err62);
                }
                errors++;
              }
            }
            if (data15.controlBytes !== void 0 && func0.call(data15, "controlBytes")) {
              let data16 = data15.controlBytes;
              if (!(typeof data16 == "number" && (!(data16 % 1) && !isNaN(data16)) && isFinite(data16))) {
                const err63 = { instancePath: instancePath + "/info/limits/controlBytes", schemaPath: "#/properties/info/properties/limits/properties/controlBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err63];
                } else {
                  vErrors.push(err63);
                }
                errors++;
              }
              if (typeof data16 == "number" && isFinite(data16)) {
                if (data16 > 1048576 || isNaN(data16)) {
                  const err64 = { instancePath: instancePath + "/info/limits/controlBytes", schemaPath: "#/properties/info/properties/limits/properties/controlBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1048576 }, message: "must be <= 1048576" };
                  if (vErrors === null) {
                    vErrors = [err64];
                  } else {
                    vErrors.push(err64);
                  }
                  errors++;
                }
                if (data16 < 1 || isNaN(data16)) {
                  const err65 = { instancePath: instancePath + "/info/limits/controlBytes", schemaPath: "#/properties/info/properties/limits/properties/controlBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                  if (vErrors === null) {
                    vErrors = [err65];
                  } else {
                    vErrors.push(err65);
                  }
                  errors++;
                }
              }
            }
            if (data15.fileChunkBytes !== void 0 && func0.call(data15, "fileChunkBytes")) {
              let data17 = data15.fileChunkBytes;
              if (!(typeof data17 == "number" && (!(data17 % 1) && !isNaN(data17)) && isFinite(data17))) {
                const err66 = { instancePath: instancePath + "/info/limits/fileChunkBytes", schemaPath: "#/properties/info/properties/limits/properties/fileChunkBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err66];
                } else {
                  vErrors.push(err66);
                }
                errors++;
              }
              if (typeof data17 == "number" && isFinite(data17)) {
                if (data17 > 262144 || isNaN(data17)) {
                  const err67 = { instancePath: instancePath + "/info/limits/fileChunkBytes", schemaPath: "#/properties/info/properties/limits/properties/fileChunkBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 262144 }, message: "must be <= 262144" };
                  if (vErrors === null) {
                    vErrors = [err67];
                  } else {
                    vErrors.push(err67);
                  }
                  errors++;
                }
                if (data17 < 1 || isNaN(data17)) {
                  const err68 = { instancePath: instancePath + "/info/limits/fileChunkBytes", schemaPath: "#/properties/info/properties/limits/properties/fileChunkBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                  if (vErrors === null) {
                    vErrors = [err68];
                  } else {
                    vErrors.push(err68);
                  }
                  errors++;
                }
              }
            }
            if (data15.fileBytes !== void 0 && func0.call(data15, "fileBytes")) {
              let data18 = data15.fileBytes;
              if (!(typeof data18 == "number" && (!(data18 % 1) && !isNaN(data18)) && isFinite(data18))) {
                const err69 = { instancePath: instancePath + "/info/limits/fileBytes", schemaPath: "#/properties/info/properties/limits/properties/fileBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
              if (typeof data18 == "number" && isFinite(data18)) {
                if (data18 > 8388608 || isNaN(data18)) {
                  const err70 = { instancePath: instancePath + "/info/limits/fileBytes", schemaPath: "#/properties/info/properties/limits/properties/fileBytes/maximum", keyword: "maximum", params: { comparison: "<=", limit: 8388608 }, message: "must be <= 8388608" };
                  if (vErrors === null) {
                    vErrors = [err70];
                  } else {
                    vErrors.push(err70);
                  }
                  errors++;
                }
                if (data18 < 1 || isNaN(data18)) {
                  const err71 = { instancePath: instancePath + "/info/limits/fileBytes", schemaPath: "#/properties/info/properties/limits/properties/fileBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                  if (vErrors === null) {
                    vErrors = [err71];
                  } else {
                    vErrors.push(err71);
                  }
                  errors++;
                }
              }
            }
            if (data15.fileTransfers !== void 0 && func0.call(data15, "fileTransfers")) {
              let data19 = data15.fileTransfers;
              if (!(typeof data19 == "number" && (!(data19 % 1) && !isNaN(data19)) && isFinite(data19))) {
                const err72 = { instancePath: instancePath + "/info/limits/fileTransfers", schemaPath: "#/properties/info/properties/limits/properties/fileTransfers/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err72];
                } else {
                  vErrors.push(err72);
                }
                errors++;
              }
              if (typeof data19 == "number" && isFinite(data19)) {
                if (data19 > 2 || isNaN(data19)) {
                  const err73 = { instancePath: instancePath + "/info/limits/fileTransfers", schemaPath: "#/properties/info/properties/limits/properties/fileTransfers/maximum", keyword: "maximum", params: { comparison: "<=", limit: 2 }, message: "must be <= 2" };
                  if (vErrors === null) {
                    vErrors = [err73];
                  } else {
                    vErrors.push(err73);
                  }
                  errors++;
                }
                if (data19 < 1 || isNaN(data19)) {
                  const err74 = { instancePath: instancePath + "/info/limits/fileTransfers", schemaPath: "#/properties/info/properties/limits/properties/fileTransfers/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                  if (vErrors === null) {
                    vErrors = [err74];
                  } else {
                    vErrors.push(err74);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err75 = { instancePath: instancePath + "/info/limits", schemaPath: "#/properties/info/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
        }
      } else {
        const err76 = { instancePath: instancePath + "/info", schemaPath: "#/properties/info/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err76];
        } else {
          vErrors.push(err76);
        }
        errors++;
      }
    }
  } else {
    const err77 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err77];
    } else {
      vErrors.push(err77);
    }
    errors++;
  }
  validate24.errors = vErrors;
  return errors === 0;
}
var validateWireMessageSchema = validate26;
var schema24 = { "$schema": "http://json-schema.org/draft-07/schema#", "$id": "https://ai-switch.github.io/aplg/schema/v1/wire.schema.json", "title": "WireMessage", "oneOf": [{ "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "operation", "args"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "request" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "operation": { "const": "capability.call" }, "args": { "type": "object", "additionalProperties": false, "required": ["capability", "method", "params"], "properties": { "capability": { "type": "string", "minLength": 3, "maxLength": 128, "pattern": "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, "method": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[a-zA-Z][a-zA-Z0-9_.-]*$" }, "params": { "$ref": "#/definitions/jsonValue" } } } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "operation", "args"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "request" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "operation": { "const": "subscription.open" }, "args": { "type": "object", "additionalProperties": false, "required": ["capability", "topic"], "properties": { "capability": { "type": "string", "minLength": 3, "maxLength": 128, "pattern": "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, "topic": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[a-zA-Z][a-zA-Z0-9_.-]*$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "operation", "args"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "request" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "operation": { "const": "subscription.close" }, "args": { "type": "object", "additionalProperties": false, "required": ["subscriptionId"], "properties": { "subscriptionId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "operation", "args"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "request" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "operation": { "const": "request.cancel" }, "args": { "type": "object", "additionalProperties": false, "required": ["requestId"], "properties": { "requestId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" } } } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "value"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "result" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "value": { "$ref": "#/definitions/jsonValue" } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "id", "error"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "error" }, "id": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "error": { "type": "object", "additionalProperties": false, "required": ["code", "message"], "properties": { "code": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[A-Z][A-Z0-9_]*$" }, "message": { "type": "string", "maxLength": 8192 }, "details": { "$ref": "#/definitions/jsonValue" } } } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "subscriptionId", "seq", "payload"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "event" }, "subscriptionId": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[\\x21-\\x7e]+$" }, "seq": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }, "payload": { "$ref": "#/definitions/jsonValue" } } }, { "type": "object", "additionalProperties": false, "required": ["protocol", "kind", "state"], "properties": { "protocol": { "const": "aplg/1" }, "kind": { "const": "connection" }, "state": { "enum": ["connected", "disconnected", "closed"] } } }], "definitions": { "jsonValue": { "anyOf": [{ "type": "null" }, { "type": "boolean" }, { "type": "number" }, { "type": "string" }, { "type": "array", "items": { "$ref": "#/definitions/jsonValue" } }, { "type": "object", "additionalProperties": { "$ref": "#/definitions/jsonValue" } }] } } };
var pattern30 = new RegExp("^[A-Z][A-Z0-9_]*$", "u");
var wrapper6 = { validate: validate27 };
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
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
              if (!wrapper6.validate(data[i0], { instancePath: instancePath + "/" + i0, parentData: data, parentDataProperty: i0, rootData })) {
                vErrors = vErrors === null ? wrapper6.validate.errors : vErrors.concat(wrapper6.validate.errors);
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
                if (!wrapper6.validate(data[key0], { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data, parentDataProperty: key0, rootData })) {
                  vErrors = vErrors === null ? wrapper6.validate.errors : vErrors.concat(wrapper6.validate.errors);
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
  validate27.errors = vErrors;
  return errors === 0;
}
function validate26(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.protocol === void 0 || !func0.call(data, "protocol")) {
      const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0 || !func0.call(data, "kind")) {
      const err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.id === void 0 || !func0.call(data, "id")) {
      const err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0 || !func0.call(data, "operation")) {
      const err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.args === void 0 || !func0.call(data, "args")) {
      const err4 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "args" }, message: "must have required property 'args'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "protocol" || key0 === "kind" || key0 === "id" || key0 === "operation" || key0 === "args")) {
        const err5 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.protocol !== void 0 && func0.call(data, "protocol")) {
      if ("aplg/1" !== data.protocol) {
        const err6 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/0/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.kind !== void 0 && func0.call(data, "kind")) {
      if ("request" !== data.kind) {
        const err7 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/0/properties/kind/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0 && func0.call(data, "id")) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (func55(data2) > 128) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        if (func55(data2) < 1) {
          const err9 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (!pattern0.test(data2)) {
          const err10 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.operation !== void 0 && func0.call(data, "operation")) {
      if ("capability.call" !== data.operation) {
        const err12 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/0/properties/operation/const", keyword: "const", params: { allowedValue: "capability.call" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.args !== void 0 && func0.call(data, "args")) {
      let data4 = data.args;
      if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
        if (data4.capability === void 0 || !func0.call(data4, "capability")) {
          const err13 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/0/properties/args/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4.method === void 0 || !func0.call(data4, "method")) {
          const err14 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/0/properties/args/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4.params === void 0 || !func0.call(data4, "params")) {
          const err15 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/0/properties/args/required", keyword: "required", params: { missingProperty: "params" }, message: "must have required property 'params'" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        for (const key1 of Object.keys(data4)) {
          if (!(key1 === "capability" || key1 === "method" || key1 === "params")) {
            const err16 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/0/properties/args/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
        if (data4.capability !== void 0 && func0.call(data4, "capability")) {
          let data5 = data4.capability;
          if (typeof data5 === "string") {
            if (func55(data5) > 128) {
              const err17 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/0/properties/args/properties/capability/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err17];
              } else {
                vErrors.push(err17);
              }
              errors++;
            }
            if (func55(data5) < 3) {
              const err18 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/0/properties/args/properties/capability/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters" };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
            if (!pattern10.test(data5)) {
              const err19 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/0/properties/args/properties/capability/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$"' };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          } else {
            const err20 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/0/properties/args/properties/capability/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
        }
        if (data4.method !== void 0 && func0.call(data4, "method")) {
          let data6 = data4.method;
          if (typeof data6 === "string") {
            if (func55(data6) > 128) {
              const err21 = { instancePath: instancePath + "/args/method", schemaPath: "#/oneOf/0/properties/args/properties/method/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
            if (func55(data6) < 1) {
              const err22 = { instancePath: instancePath + "/args/method", schemaPath: "#/oneOf/0/properties/args/properties/method/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            if (!pattern17.test(data6)) {
              const err23 = { instancePath: instancePath + "/args/method", schemaPath: "#/oneOf/0/properties/args/properties/method/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z][a-zA-Z0-9_.-]*$" }, message: 'must match pattern "^[a-zA-Z][a-zA-Z0-9_.-]*$"' };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
          } else {
            const err24 = { instancePath: instancePath + "/args/method", schemaPath: "#/oneOf/0/properties/args/properties/method/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err24];
            } else {
              vErrors.push(err24);
            }
            errors++;
          }
        }
        if (data4.params !== void 0 && func0.call(data4, "params")) {
          if (!validate27(data4.params, { instancePath: instancePath + "/args/params", parentData: data4, parentDataProperty: "params", rootData })) {
            vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err25 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/0/properties/args/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
  } else {
    const err26 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err26];
    } else {
      vErrors.push(err26);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs17 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.protocol === void 0 || !func0.call(data, "protocol")) {
      const err27 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
      if (vErrors === null) {
        vErrors = [err27];
      } else {
        vErrors.push(err27);
      }
      errors++;
    }
    if (data.kind === void 0 || !func0.call(data, "kind")) {
      const err28 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err28];
      } else {
        vErrors.push(err28);
      }
      errors++;
    }
    if (data.id === void 0 || !func0.call(data, "id")) {
      const err29 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err29];
      } else {
        vErrors.push(err29);
      }
      errors++;
    }
    if (data.operation === void 0 || !func0.call(data, "operation")) {
      const err30 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err30];
      } else {
        vErrors.push(err30);
      }
      errors++;
    }
    if (data.args === void 0 || !func0.call(data, "args")) {
      const err31 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "args" }, message: "must have required property 'args'" };
      if (vErrors === null) {
        vErrors = [err31];
      } else {
        vErrors.push(err31);
      }
      errors++;
    }
    for (const key2 of Object.keys(data)) {
      if (!(key2 === "protocol" || key2 === "kind" || key2 === "id" || key2 === "operation" || key2 === "args")) {
        const err32 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err32];
        } else {
          vErrors.push(err32);
        }
        errors++;
      }
    }
    if (data.protocol !== void 0 && func0.call(data, "protocol")) {
      if ("aplg/1" !== data.protocol) {
        const err33 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/1/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.kind !== void 0 && func0.call(data, "kind")) {
      if ("request" !== data.kind) {
        const err34 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/1/properties/kind/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
    if (data.id !== void 0 && func0.call(data, "id")) {
      let data10 = data.id;
      if (typeof data10 === "string") {
        if (func55(data10) > 128) {
          const err35 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
        if (func55(data10) < 1) {
          const err36 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
        if (!pattern0.test(data10)) {
          const err37 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      } else {
        const err38 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
    }
    if (data.operation !== void 0 && func0.call(data, "operation")) {
      if ("subscription.open" !== data.operation) {
        const err39 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/1/properties/operation/const", keyword: "const", params: { allowedValue: "subscription.open" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.args !== void 0 && func0.call(data, "args")) {
      let data12 = data.args;
      if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
        if (data12.capability === void 0 || !func0.call(data12, "capability")) {
          const err40 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/1/properties/args/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
        if (data12.topic === void 0 || !func0.call(data12, "topic")) {
          const err41 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/1/properties/args/required", keyword: "required", params: { missingProperty: "topic" }, message: "must have required property 'topic'" };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
        for (const key3 of Object.keys(data12)) {
          if (!(key3 === "capability" || key3 === "topic")) {
            const err42 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/1/properties/args/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err42];
            } else {
              vErrors.push(err42);
            }
            errors++;
          }
        }
        if (data12.capability !== void 0 && func0.call(data12, "capability")) {
          let data13 = data12.capability;
          if (typeof data13 === "string") {
            if (func55(data13) > 128) {
              const err43 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/1/properties/args/properties/capability/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err43];
              } else {
                vErrors.push(err43);
              }
              errors++;
            }
            if (func55(data13) < 3) {
              const err44 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/1/properties/args/properties/capability/minLength", keyword: "minLength", params: { limit: 3 }, message: "must NOT have fewer than 3 characters" };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
            if (!pattern10.test(data13)) {
              const err45 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/1/properties/args/properties/capability/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$"' };
              if (vErrors === null) {
                vErrors = [err45];
              } else {
                vErrors.push(err45);
              }
              errors++;
            }
          } else {
            const err46 = { instancePath: instancePath + "/args/capability", schemaPath: "#/oneOf/1/properties/args/properties/capability/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err46];
            } else {
              vErrors.push(err46);
            }
            errors++;
          }
        }
        if (data12.topic !== void 0 && func0.call(data12, "topic")) {
          let data14 = data12.topic;
          if (typeof data14 === "string") {
            if (func55(data14) > 128) {
              const err47 = { instancePath: instancePath + "/args/topic", schemaPath: "#/oneOf/1/properties/args/properties/topic/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err47];
              } else {
                vErrors.push(err47);
              }
              errors++;
            }
            if (func55(data14) < 1) {
              const err48 = { instancePath: instancePath + "/args/topic", schemaPath: "#/oneOf/1/properties/args/properties/topic/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
            if (!pattern17.test(data14)) {
              const err49 = { instancePath: instancePath + "/args/topic", schemaPath: "#/oneOf/1/properties/args/properties/topic/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z][a-zA-Z0-9_.-]*$" }, message: 'must match pattern "^[a-zA-Z][a-zA-Z0-9_.-]*$"' };
              if (vErrors === null) {
                vErrors = [err49];
              } else {
                vErrors.push(err49);
              }
              errors++;
            }
          } else {
            const err50 = { instancePath: instancePath + "/args/topic", schemaPath: "#/oneOf/1/properties/args/properties/topic/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
      } else {
        const err51 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/1/properties/args/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
  } else {
    const err52 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err52];
    } else {
      vErrors.push(err52);
    }
    errors++;
  }
  var _valid0 = _errs17 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs32 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.protocol === void 0 || !func0.call(data, "protocol")) {
        const err53 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
        if (vErrors === null) {
          vErrors = [err53];
        } else {
          vErrors.push(err53);
        }
        errors++;
      }
      if (data.kind === void 0 || !func0.call(data, "kind")) {
        const err54 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
      if (data.id === void 0 || !func0.call(data, "id")) {
        const err55 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
        if (vErrors === null) {
          vErrors = [err55];
        } else {
          vErrors.push(err55);
        }
        errors++;
      }
      if (data.operation === void 0 || !func0.call(data, "operation")) {
        const err56 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
        if (vErrors === null) {
          vErrors = [err56];
        } else {
          vErrors.push(err56);
        }
        errors++;
      }
      if (data.args === void 0 || !func0.call(data, "args")) {
        const err57 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "args" }, message: "must have required property 'args'" };
        if (vErrors === null) {
          vErrors = [err57];
        } else {
          vErrors.push(err57);
        }
        errors++;
      }
      for (const key4 of Object.keys(data)) {
        if (!(key4 === "protocol" || key4 === "kind" || key4 === "id" || key4 === "operation" || key4 === "args")) {
          const err58 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
      }
      if (data.protocol !== void 0 && func0.call(data, "protocol")) {
        if ("aplg/1" !== data.protocol) {
          const err59 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/2/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
      }
      if (data.kind !== void 0 && func0.call(data, "kind")) {
        if ("request" !== data.kind) {
          const err60 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/2/properties/kind/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
      }
      if (data.id !== void 0 && func0.call(data, "id")) {
        let data17 = data.id;
        if (typeof data17 === "string") {
          if (func55(data17) > 128) {
            const err61 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
          if (func55(data17) < 1) {
            const err62 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
          if (!pattern0.test(data17)) {
            const err63 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        } else {
          const err64 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      }
      if (data.operation !== void 0 && func0.call(data, "operation")) {
        if ("subscription.close" !== data.operation) {
          const err65 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/2/properties/operation/const", keyword: "const", params: { allowedValue: "subscription.close" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err65];
          } else {
            vErrors.push(err65);
          }
          errors++;
        }
      }
      if (data.args !== void 0 && func0.call(data, "args")) {
        let data19 = data.args;
        if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
          if (data19.subscriptionId === void 0 || !func0.call(data19, "subscriptionId")) {
            const err66 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/2/properties/args/required", keyword: "required", params: { missingProperty: "subscriptionId" }, message: "must have required property 'subscriptionId'" };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
          for (const key5 of Object.keys(data19)) {
            if (!(key5 === "subscriptionId")) {
              const err67 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/2/properties/args/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
          }
          if (data19.subscriptionId !== void 0 && func0.call(data19, "subscriptionId")) {
            let data20 = data19.subscriptionId;
            if (typeof data20 === "string") {
              if (func55(data20) > 128) {
                const err68 = { instancePath: instancePath + "/args/subscriptionId", schemaPath: "#/oneOf/2/properties/args/properties/subscriptionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                if (vErrors === null) {
                  vErrors = [err68];
                } else {
                  vErrors.push(err68);
                }
                errors++;
              }
              if (func55(data20) < 1) {
                const err69 = { instancePath: instancePath + "/args/subscriptionId", schemaPath: "#/oneOf/2/properties/args/properties/subscriptionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err69];
                } else {
                  vErrors.push(err69);
                }
                errors++;
              }
              if (!pattern0.test(data20)) {
                const err70 = { instancePath: instancePath + "/args/subscriptionId", schemaPath: "#/oneOf/2/properties/args/properties/subscriptionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                if (vErrors === null) {
                  vErrors = [err70];
                } else {
                  vErrors.push(err70);
                }
                errors++;
              }
            } else {
              const err71 = { instancePath: instancePath + "/args/subscriptionId", schemaPath: "#/oneOf/2/properties/args/properties/subscriptionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err71];
              } else {
                vErrors.push(err71);
              }
              errors++;
            }
          }
        } else {
          const err72 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/2/properties/args/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err72];
          } else {
            vErrors.push(err72);
          }
          errors++;
        }
      }
    } else {
      const err73 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err73];
      } else {
        vErrors.push(err73);
      }
      errors++;
    }
    var _valid0 = _errs32 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
      const _errs45 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.protocol === void 0 || !func0.call(data, "protocol")) {
          const err74 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
          if (vErrors === null) {
            vErrors = [err74];
          } else {
            vErrors.push(err74);
          }
          errors++;
        }
        if (data.kind === void 0 || !func0.call(data, "kind")) {
          const err75 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          if (vErrors === null) {
            vErrors = [err75];
          } else {
            vErrors.push(err75);
          }
          errors++;
        }
        if (data.id === void 0 || !func0.call(data, "id")) {
          const err76 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          if (vErrors === null) {
            vErrors = [err76];
          } else {
            vErrors.push(err76);
          }
          errors++;
        }
        if (data.operation === void 0 || !func0.call(data, "operation")) {
          const err77 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
          if (vErrors === null) {
            vErrors = [err77];
          } else {
            vErrors.push(err77);
          }
          errors++;
        }
        if (data.args === void 0 || !func0.call(data, "args")) {
          const err78 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "args" }, message: "must have required property 'args'" };
          if (vErrors === null) {
            vErrors = [err78];
          } else {
            vErrors.push(err78);
          }
          errors++;
        }
        for (const key6 of Object.keys(data)) {
          if (!(key6 === "protocol" || key6 === "kind" || key6 === "id" || key6 === "operation" || key6 === "args")) {
            const err79 = { instancePath, schemaPath: "#/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err79];
            } else {
              vErrors.push(err79);
            }
            errors++;
          }
        }
        if (data.protocol !== void 0 && func0.call(data, "protocol")) {
          if ("aplg/1" !== data.protocol) {
            const err80 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/3/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err80];
            } else {
              vErrors.push(err80);
            }
            errors++;
          }
        }
        if (data.kind !== void 0 && func0.call(data, "kind")) {
          if ("request" !== data.kind) {
            const err81 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/3/properties/kind/const", keyword: "const", params: { allowedValue: "request" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err81];
            } else {
              vErrors.push(err81);
            }
            errors++;
          }
        }
        if (data.id !== void 0 && func0.call(data, "id")) {
          let data23 = data.id;
          if (typeof data23 === "string") {
            if (func55(data23) > 128) {
              const err82 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err82];
              } else {
                vErrors.push(err82);
              }
              errors++;
            }
            if (func55(data23) < 1) {
              const err83 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err83];
              } else {
                vErrors.push(err83);
              }
              errors++;
            }
            if (!pattern0.test(data23)) {
              const err84 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
              if (vErrors === null) {
                vErrors = [err84];
              } else {
                vErrors.push(err84);
              }
              errors++;
            }
          } else {
            const err85 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err85];
            } else {
              vErrors.push(err85);
            }
            errors++;
          }
        }
        if (data.operation !== void 0 && func0.call(data, "operation")) {
          if ("request.cancel" !== data.operation) {
            const err86 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/3/properties/operation/const", keyword: "const", params: { allowedValue: "request.cancel" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err86];
            } else {
              vErrors.push(err86);
            }
            errors++;
          }
        }
        if (data.args !== void 0 && func0.call(data, "args")) {
          let data25 = data.args;
          if (data25 && typeof data25 == "object" && !Array.isArray(data25)) {
            if (data25.requestId === void 0 || !func0.call(data25, "requestId")) {
              const err87 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/3/properties/args/required", keyword: "required", params: { missingProperty: "requestId" }, message: "must have required property 'requestId'" };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
            for (const key7 of Object.keys(data25)) {
              if (!(key7 === "requestId")) {
                const err88 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/3/properties/args/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err88];
                } else {
                  vErrors.push(err88);
                }
                errors++;
              }
            }
            if (data25.requestId !== void 0 && func0.call(data25, "requestId")) {
              let data26 = data25.requestId;
              if (typeof data26 === "string") {
                if (func55(data26) > 128) {
                  const err89 = { instancePath: instancePath + "/args/requestId", schemaPath: "#/oneOf/3/properties/args/properties/requestId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                  if (vErrors === null) {
                    vErrors = [err89];
                  } else {
                    vErrors.push(err89);
                  }
                  errors++;
                }
                if (func55(data26) < 1) {
                  const err90 = { instancePath: instancePath + "/args/requestId", schemaPath: "#/oneOf/3/properties/args/properties/requestId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err90];
                  } else {
                    vErrors.push(err90);
                  }
                  errors++;
                }
                if (!pattern0.test(data26)) {
                  const err91 = { instancePath: instancePath + "/args/requestId", schemaPath: "#/oneOf/3/properties/args/properties/requestId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                  if (vErrors === null) {
                    vErrors = [err91];
                  } else {
                    vErrors.push(err91);
                  }
                  errors++;
                }
              } else {
                const err92 = { instancePath: instancePath + "/args/requestId", schemaPath: "#/oneOf/3/properties/args/properties/requestId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err92];
                } else {
                  vErrors.push(err92);
                }
                errors++;
              }
            }
          } else {
            const err93 = { instancePath: instancePath + "/args", schemaPath: "#/oneOf/3/properties/args/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err93];
            } else {
              vErrors.push(err93);
            }
            errors++;
          }
        }
      } else {
        const err94 = { instancePath, schemaPath: "#/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err94];
        } else {
          vErrors.push(err94);
        }
        errors++;
      }
      var _valid0 = _errs45 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
        }
        const _errs58 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.protocol === void 0 || !func0.call(data, "protocol")) {
            const err95 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
            if (vErrors === null) {
              vErrors = [err95];
            } else {
              vErrors.push(err95);
            }
            errors++;
          }
          if (data.kind === void 0 || !func0.call(data, "kind")) {
            const err96 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            if (vErrors === null) {
              vErrors = [err96];
            } else {
              vErrors.push(err96);
            }
            errors++;
          }
          if (data.id === void 0 || !func0.call(data, "id")) {
            const err97 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
            if (vErrors === null) {
              vErrors = [err97];
            } else {
              vErrors.push(err97);
            }
            errors++;
          }
          if (data.value === void 0 || !func0.call(data, "value")) {
            const err98 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
            if (vErrors === null) {
              vErrors = [err98];
            } else {
              vErrors.push(err98);
            }
            errors++;
          }
          for (const key8 of Object.keys(data)) {
            if (!(key8 === "protocol" || key8 === "kind" || key8 === "id" || key8 === "value")) {
              const err99 = { instancePath, schemaPath: "#/oneOf/4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err99];
              } else {
                vErrors.push(err99);
              }
              errors++;
            }
          }
          if (data.protocol !== void 0 && func0.call(data, "protocol")) {
            if ("aplg/1" !== data.protocol) {
              const err100 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/4/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err100];
              } else {
                vErrors.push(err100);
              }
              errors++;
            }
          }
          if (data.kind !== void 0 && func0.call(data, "kind")) {
            if ("result" !== data.kind) {
              const err101 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/4/properties/kind/const", keyword: "const", params: { allowedValue: "result" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err101];
              } else {
                vErrors.push(err101);
              }
              errors++;
            }
          }
          if (data.id !== void 0 && func0.call(data, "id")) {
            let data29 = data.id;
            if (typeof data29 === "string") {
              if (func55(data29) > 128) {
                const err102 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                if (vErrors === null) {
                  vErrors = [err102];
                } else {
                  vErrors.push(err102);
                }
                errors++;
              }
              if (func55(data29) < 1) {
                const err103 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err103];
                } else {
                  vErrors.push(err103);
                }
                errors++;
              }
              if (!pattern0.test(data29)) {
                const err104 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                if (vErrors === null) {
                  vErrors = [err104];
                } else {
                  vErrors.push(err104);
                }
                errors++;
              }
            } else {
              const err105 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err105];
              } else {
                vErrors.push(err105);
              }
              errors++;
            }
          }
          if (data.value !== void 0 && func0.call(data, "value")) {
            if (!validate27(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData })) {
              vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
              errors = vErrors.length;
            }
          }
        } else {
          const err106 = { instancePath, schemaPath: "#/oneOf/4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err106];
          } else {
            vErrors.push(err106);
          }
          errors++;
        }
        var _valid0 = _errs58 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
          }
          const _errs66 = errors;
          if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.protocol === void 0 || !func0.call(data, "protocol")) {
              const err107 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
              if (vErrors === null) {
                vErrors = [err107];
              } else {
                vErrors.push(err107);
              }
              errors++;
            }
            if (data.kind === void 0 || !func0.call(data, "kind")) {
              const err108 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              if (vErrors === null) {
                vErrors = [err108];
              } else {
                vErrors.push(err108);
              }
              errors++;
            }
            if (data.id === void 0 || !func0.call(data, "id")) {
              const err109 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err109];
              } else {
                vErrors.push(err109);
              }
              errors++;
            }
            if (data.error === void 0 || !func0.call(data, "error")) {
              const err110 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "error" }, message: "must have required property 'error'" };
              if (vErrors === null) {
                vErrors = [err110];
              } else {
                vErrors.push(err110);
              }
              errors++;
            }
            for (const key9 of Object.keys(data)) {
              if (!(key9 === "protocol" || key9 === "kind" || key9 === "id" || key9 === "error")) {
                const err111 = { instancePath, schemaPath: "#/oneOf/5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err111];
                } else {
                  vErrors.push(err111);
                }
                errors++;
              }
            }
            if (data.protocol !== void 0 && func0.call(data, "protocol")) {
              if ("aplg/1" !== data.protocol) {
                const err112 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/5/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err112];
                } else {
                  vErrors.push(err112);
                }
                errors++;
              }
            }
            if (data.kind !== void 0 && func0.call(data, "kind")) {
              if ("error" !== data.kind) {
                const err113 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/5/properties/kind/const", keyword: "const", params: { allowedValue: "error" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err113];
                } else {
                  vErrors.push(err113);
                }
                errors++;
              }
            }
            if (data.id !== void 0 && func0.call(data, "id")) {
              let data33 = data.id;
              if (typeof data33 === "string") {
                if (func55(data33) > 128) {
                  const err114 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                  if (vErrors === null) {
                    vErrors = [err114];
                  } else {
                    vErrors.push(err114);
                  }
                  errors++;
                }
                if (func55(data33) < 1) {
                  const err115 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err115];
                  } else {
                    vErrors.push(err115);
                  }
                  errors++;
                }
                if (!pattern0.test(data33)) {
                  const err116 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                  if (vErrors === null) {
                    vErrors = [err116];
                  } else {
                    vErrors.push(err116);
                  }
                  errors++;
                }
              } else {
                const err117 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err117];
                } else {
                  vErrors.push(err117);
                }
                errors++;
              }
            }
            if (data.error !== void 0 && func0.call(data, "error")) {
              let data34 = data.error;
              if (data34 && typeof data34 == "object" && !Array.isArray(data34)) {
                if (data34.code === void 0 || !func0.call(data34, "code")) {
                  const err118 = { instancePath: instancePath + "/error", schemaPath: "#/oneOf/5/properties/error/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
                  if (vErrors === null) {
                    vErrors = [err118];
                  } else {
                    vErrors.push(err118);
                  }
                  errors++;
                }
                if (data34.message === void 0 || !func0.call(data34, "message")) {
                  const err119 = { instancePath: instancePath + "/error", schemaPath: "#/oneOf/5/properties/error/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
                  if (vErrors === null) {
                    vErrors = [err119];
                  } else {
                    vErrors.push(err119);
                  }
                  errors++;
                }
                for (const key10 of Object.keys(data34)) {
                  if (!(key10 === "code" || key10 === "message" || key10 === "details")) {
                    const err120 = { instancePath: instancePath + "/error", schemaPath: "#/oneOf/5/properties/error/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err120];
                    } else {
                      vErrors.push(err120);
                    }
                    errors++;
                  }
                }
                if (data34.code !== void 0 && func0.call(data34, "code")) {
                  let data35 = data34.code;
                  if (typeof data35 === "string") {
                    if (func55(data35) > 128) {
                      const err121 = { instancePath: instancePath + "/error/code", schemaPath: "#/oneOf/5/properties/error/properties/code/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                      if (vErrors === null) {
                        vErrors = [err121];
                      } else {
                        vErrors.push(err121);
                      }
                      errors++;
                    }
                    if (func55(data35) < 1) {
                      const err122 = { instancePath: instancePath + "/error/code", schemaPath: "#/oneOf/5/properties/error/properties/code/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err122];
                      } else {
                        vErrors.push(err122);
                      }
                      errors++;
                    }
                    if (!pattern30.test(data35)) {
                      const err123 = { instancePath: instancePath + "/error/code", schemaPath: "#/oneOf/5/properties/error/properties/code/pattern", keyword: "pattern", params: { pattern: "^[A-Z][A-Z0-9_]*$" }, message: 'must match pattern "^[A-Z][A-Z0-9_]*$"' };
                      if (vErrors === null) {
                        vErrors = [err123];
                      } else {
                        vErrors.push(err123);
                      }
                      errors++;
                    }
                  } else {
                    const err124 = { instancePath: instancePath + "/error/code", schemaPath: "#/oneOf/5/properties/error/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err124];
                    } else {
                      vErrors.push(err124);
                    }
                    errors++;
                  }
                }
                if (data34.message !== void 0 && func0.call(data34, "message")) {
                  let data36 = data34.message;
                  if (typeof data36 === "string") {
                    if (func55(data36) > 8192) {
                      const err125 = { instancePath: instancePath + "/error/message", schemaPath: "#/oneOf/5/properties/error/properties/message/maxLength", keyword: "maxLength", params: { limit: 8192 }, message: "must NOT have more than 8192 characters" };
                      if (vErrors === null) {
                        vErrors = [err125];
                      } else {
                        vErrors.push(err125);
                      }
                      errors++;
                    }
                  } else {
                    const err126 = { instancePath: instancePath + "/error/message", schemaPath: "#/oneOf/5/properties/error/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err126];
                    } else {
                      vErrors.push(err126);
                    }
                    errors++;
                  }
                }
                if (data34.details !== void 0 && func0.call(data34, "details")) {
                  if (!validate27(data34.details, { instancePath: instancePath + "/error/details", parentData: data34, parentDataProperty: "details", rootData })) {
                    vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
                    errors = vErrors.length;
                  }
                }
              } else {
                const err127 = { instancePath: instancePath + "/error", schemaPath: "#/oneOf/5/properties/error/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err127];
                } else {
                  vErrors.push(err127);
                }
                errors++;
              }
            }
          } else {
            const err128 = { instancePath, schemaPath: "#/oneOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err128];
            } else {
              vErrors.push(err128);
            }
            errors++;
          }
          var _valid0 = _errs66 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
            }
            const _errs81 = errors;
            if (data && typeof data == "object" && !Array.isArray(data)) {
              if (data.protocol === void 0 || !func0.call(data, "protocol")) {
                const err129 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
                if (vErrors === null) {
                  vErrors = [err129];
                } else {
                  vErrors.push(err129);
                }
                errors++;
              }
              if (data.kind === void 0 || !func0.call(data, "kind")) {
                const err130 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                if (vErrors === null) {
                  vErrors = [err130];
                } else {
                  vErrors.push(err130);
                }
                errors++;
              }
              if (data.subscriptionId === void 0 || !func0.call(data, "subscriptionId")) {
                const err131 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "subscriptionId" }, message: "must have required property 'subscriptionId'" };
                if (vErrors === null) {
                  vErrors = [err131];
                } else {
                  vErrors.push(err131);
                }
                errors++;
              }
              if (data.seq === void 0 || !func0.call(data, "seq")) {
                const err132 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "seq" }, message: "must have required property 'seq'" };
                if (vErrors === null) {
                  vErrors = [err132];
                } else {
                  vErrors.push(err132);
                }
                errors++;
              }
              if (data.payload === void 0 || !func0.call(data, "payload")) {
                const err133 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "payload" }, message: "must have required property 'payload'" };
                if (vErrors === null) {
                  vErrors = [err133];
                } else {
                  vErrors.push(err133);
                }
                errors++;
              }
              for (const key11 of Object.keys(data)) {
                if (!(key11 === "protocol" || key11 === "kind" || key11 === "subscriptionId" || key11 === "seq" || key11 === "payload")) {
                  const err134 = { instancePath, schemaPath: "#/oneOf/6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err134];
                  } else {
                    vErrors.push(err134);
                  }
                  errors++;
                }
              }
              if (data.protocol !== void 0 && func0.call(data, "protocol")) {
                if ("aplg/1" !== data.protocol) {
                  const err135 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/6/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err135];
                  } else {
                    vErrors.push(err135);
                  }
                  errors++;
                }
              }
              if (data.kind !== void 0 && func0.call(data, "kind")) {
                if ("event" !== data.kind) {
                  const err136 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/6/properties/kind/const", keyword: "const", params: { allowedValue: "event" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err136];
                  } else {
                    vErrors.push(err136);
                  }
                  errors++;
                }
              }
              if (data.subscriptionId !== void 0 && func0.call(data, "subscriptionId")) {
                let data40 = data.subscriptionId;
                if (typeof data40 === "string") {
                  if (func55(data40) > 128) {
                    const err137 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/6/properties/subscriptionId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
                    if (vErrors === null) {
                      vErrors = [err137];
                    } else {
                      vErrors.push(err137);
                    }
                    errors++;
                  }
                  if (func55(data40) < 1) {
                    const err138 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/6/properties/subscriptionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err138];
                    } else {
                      vErrors.push(err138);
                    }
                    errors++;
                  }
                  if (!pattern0.test(data40)) {
                    const err139 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/6/properties/subscriptionId/pattern", keyword: "pattern", params: { pattern: "^[\\x21-\\x7e]+$" }, message: 'must match pattern "^[\\x21-\\x7e]+$"' };
                    if (vErrors === null) {
                      vErrors = [err139];
                    } else {
                      vErrors.push(err139);
                    }
                    errors++;
                  }
                } else {
                  const err140 = { instancePath: instancePath + "/subscriptionId", schemaPath: "#/oneOf/6/properties/subscriptionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err140];
                  } else {
                    vErrors.push(err140);
                  }
                  errors++;
                }
              }
              if (data.seq !== void 0 && func0.call(data, "seq")) {
                let data41 = data.seq;
                if (!(typeof data41 == "number" && (!(data41 % 1) && !isNaN(data41)) && isFinite(data41))) {
                  const err141 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/6/properties/seq/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                  if (vErrors === null) {
                    vErrors = [err141];
                  } else {
                    vErrors.push(err141);
                  }
                  errors++;
                }
                if (typeof data41 == "number" && isFinite(data41)) {
                  if (data41 > 9007199254740991 || isNaN(data41)) {
                    const err142 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/6/properties/seq/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
                    if (vErrors === null) {
                      vErrors = [err142];
                    } else {
                      vErrors.push(err142);
                    }
                    errors++;
                  }
                  if (data41 < 1 || isNaN(data41)) {
                    const err143 = { instancePath: instancePath + "/seq", schemaPath: "#/oneOf/6/properties/seq/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
                    if (vErrors === null) {
                      vErrors = [err143];
                    } else {
                      vErrors.push(err143);
                    }
                    errors++;
                  }
                }
              }
              if (data.payload !== void 0 && func0.call(data, "payload")) {
                if (!validate27(data.payload, { instancePath: instancePath + "/payload", parentData: data, parentDataProperty: "payload", rootData })) {
                  vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
                  errors = vErrors.length;
                }
              }
            } else {
              const err144 = { instancePath, schemaPath: "#/oneOf/6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err144];
              } else {
                vErrors.push(err144);
              }
              errors++;
            }
            var _valid0 = _errs81 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
              }
              const _errs91 = errors;
              if (data && typeof data == "object" && !Array.isArray(data)) {
                if (data.protocol === void 0 || !func0.call(data, "protocol")) {
                  const err145 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "protocol" }, message: "must have required property 'protocol'" };
                  if (vErrors === null) {
                    vErrors = [err145];
                  } else {
                    vErrors.push(err145);
                  }
                  errors++;
                }
                if (data.kind === void 0 || !func0.call(data, "kind")) {
                  const err146 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                  if (vErrors === null) {
                    vErrors = [err146];
                  } else {
                    vErrors.push(err146);
                  }
                  errors++;
                }
                if (data.state === void 0 || !func0.call(data, "state")) {
                  const err147 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
                  if (vErrors === null) {
                    vErrors = [err147];
                  } else {
                    vErrors.push(err147);
                  }
                  errors++;
                }
                for (const key12 of Object.keys(data)) {
                  if (!(key12 === "protocol" || key12 === "kind" || key12 === "state")) {
                    const err148 = { instancePath, schemaPath: "#/oneOf/7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err148];
                    } else {
                      vErrors.push(err148);
                    }
                    errors++;
                  }
                }
                if (data.protocol !== void 0 && func0.call(data, "protocol")) {
                  if ("aplg/1" !== data.protocol) {
                    const err149 = { instancePath: instancePath + "/protocol", schemaPath: "#/oneOf/7/properties/protocol/const", keyword: "const", params: { allowedValue: "aplg/1" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err149];
                    } else {
                      vErrors.push(err149);
                    }
                    errors++;
                  }
                }
                if (data.kind !== void 0 && func0.call(data, "kind")) {
                  if ("connection" !== data.kind) {
                    const err150 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/7/properties/kind/const", keyword: "const", params: { allowedValue: "connection" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err150];
                    } else {
                      vErrors.push(err150);
                    }
                    errors++;
                  }
                }
                if (data.state !== void 0 && func0.call(data, "state")) {
                  let data45 = data.state;
                  if (!(data45 === "connected" || data45 === "disconnected" || data45 === "closed")) {
                    const err151 = { instancePath: instancePath + "/state", schemaPath: "#/oneOf/7/properties/state/enum", keyword: "enum", params: { allowedValues: schema24.oneOf[7].properties.state.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err151];
                    } else {
                      vErrors.push(err151);
                    }
                    errors++;
                  }
                }
              } else {
                const err152 = { instancePath, schemaPath: "#/oneOf/7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err152];
                } else {
                  vErrors.push(err152);
                }
                errors++;
              }
              var _valid0 = _errs91 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err153 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err153];
    } else {
      vErrors.push(err153);
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
  validate26.errors = vErrors;
  return errors === 0;
}
export {
  validateFsCapabilityMessageSchema,
  validateHostEventSchema,
  validateManifestSchema,
  validateSessionDescriptorSchema,
  validateStandardCapabilityMessageSchema,
  validateWireMessageSchema
};
